import type { Prisma, PrismaClient } from '@prisma/client';

import type { MappedProductRow } from './map-product-row';

const CHUNK_SIZE = 500;
const TRANSACTION_TIMEOUT_MS = 5 * 60 * 1000;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ImportOptions {
  /** `false` (the default of the CLI) only reports; nothing is written. */
  apply: boolean;
}

export interface ImportResult {
  applied: boolean;
  toCreate: number;
  skippedExisting: number;
  rejected: number;
  categoriesToCreate: number;
  /** Units that will be booked as opening stock. */
  stockUnits: number;
  /** SKUs that already existed and were left untouched. */
  skippedSkus: string[];
}

interface CategoryRef {
  id: string;
  slug: string;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** One slug per tree level: `['Feminino', 'Cinta']` → `feminino`, `feminino-cinta`. */
function levelSlugs(path: string[]): string[] {
  return path.map((_, i) => slugify(path.slice(0, i + 1).join(' ')));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function existingCategories(
  client: Pick<PrismaClient, 'category'>,
  tenantId: string,
  slugs: string[],
): Promise<CategoryRef[]> {
  if (slugs.length === 0) {
    return [];
  }
  return client.category.findMany({
    where: { tenantId, slug: { in: slugs } },
    select: { id: true, slug: true },
  });
}

async function ensureCategories(
  tx: Prisma.TransactionClient,
  tenantId: string,
  rows: MappedProductRow[],
): Promise<Map<string, string>> {
  const idBySlug = new Map<string, string>();
  const paths = rows.map((r) => r.categoryPath).filter((p) => p.length > 0);
  const allSlugs = [...new Set(paths.flatMap(levelSlugs))];
  for (const found of await existingCategories(tx, tenantId, allSlugs)) {
    idBySlug.set(found.slug, found.id);
  }

  // Root levels first, so a child always finds its parent.
  const maxDepth = Math.max(0, ...paths.map((p) => p.length));
  for (let depth = 0; depth < maxDepth; depth++) {
    for (const path of paths) {
      if (path.length <= depth) {
        continue;
      }
      const slug = levelSlugs(path)[depth];
      if (idBySlug.has(slug)) {
        continue;
      }
      const parentSlug = depth > 0 ? levelSlugs(path)[depth - 1] : null;
      const created = await tx.category.create({
        data: {
          tenantId,
          name: path[depth],
          slug,
          parentId: parentSlug ? (idBySlug.get(parentSlug) ?? null) : null,
        },
        select: { id: true },
      });
      idBySlug.set(slug, created.id);
    }
  }
  return idBySlug;
}

function productData(
  tenantId: string,
  row: MappedProductRow,
  categoryId: string | null,
): Prisma.ProductCreateManyInput {
  return {
    tenantId,
    sku: row.sku,
    name: row.name,
    type: 'SIMPLE',
    status: row.status,
    ean: row.ean,
    ncm: row.ncm,
    cest: row.cest,
    cfop: row.cfop,
    costPrice: row.costPrice,
    salePrice: row.salePrice,
    categoryId,
    metadata: row.metadata,
  };
}

async function bookOpeningStock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  warehouseId: string,
  rows: MappedProductRow[],
): Promise<void> {
  const withStock = rows.filter((r) => r.stockQuantity > 0);
  const idBySku = new Map<string, string>();
  for (const part of chunk(withStock, CHUNK_SIZE)) {
    const found = await tx.product.findMany({
      where: { tenantId, sku: { in: part.map((r) => r.sku) } },
      select: { id: true, sku: true },
    });
    found.forEach((p) => idBySku.set(p.sku, p.id));
  }

  for (const part of chunk(withStock, CHUNK_SIZE)) {
    await tx.inventoryItem.createMany({
      data: part.map((r) => ({
        tenantId,
        productId: idBySku.get(r.sku) as string,
        warehouseId,
        quantity: r.stockQuantity,
        available: r.stockQuantity,
        reserved: 0,
        costAverage: r.costPrice,
      })),
    });
    await tx.inventoryMovement.createMany({
      data: part.map((r) => ({
        tenantId,
        productId: idBySku.get(r.sku) as string,
        type: 'ENTRY' as const,
        reason: 'INITIAL' as const,
        quantity: r.stockQuantity,
        unitCost: r.costPrice,
        totalCost: Math.round(r.costPrice * r.stockQuantity * 100) / 100,
        toWarehouseId: warehouseId,
        referenceType: 'import',
        notes: 'Saldo inicial importado da planilha',
      })),
    });
  }
}

/**
 * Loads mapped spreadsheet rows into one tenant.
 *
 * Idempotent by SKU: a product that already exists is skipped, and its stock is
 * not booked again — re-running after a partial fix cannot double the stock.
 * Everything is one transaction, so a failure leaves nothing behind.
 */
export async function importProducts(
  prisma: PrismaClient,
  tenantId: string,
  rows: MappedProductRow[],
  options: ImportOptions,
): Promise<ImportResult> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!tenant) {
    throw new ImportError('Empresa não encontrada.');
  }

  const importable = rows.filter((r) => !r.rejected);
  const existing = new Set<string>();
  for (const part of chunk(importable, CHUNK_SIZE)) {
    const found = await prisma.product.findMany({
      where: { tenantId, sku: { in: part.map((r) => r.sku) } },
      select: { sku: true },
    });
    found.forEach((p) => existing.add(p.sku));
  }
  const fresh = importable.filter((r) => !existing.has(r.sku));
  const stockUnits = fresh.reduce((sum, r) => sum + r.stockQuantity, 0);

  const warehouse = await prisma.warehouse.findFirst({
    where: { tenantId, isDefault: true, isActive: true },
    select: { id: true },
  });
  if (stockUnits > 0 && !warehouse) {
    throw new ImportError(
      'A empresa não tem depósito padrão ativo para receber o saldo inicial de estoque.',
    );
  }

  const wanted = [...new Set(fresh.flatMap((r) => levelSlugs(r.categoryPath)))];
  const known = new Set((await existingCategories(prisma, tenantId, wanted)).map((c) => c.slug));

  const result: ImportResult = {
    applied: options.apply,
    toCreate: fresh.length,
    skippedExisting: importable.length - fresh.length,
    rejected: rows.length - importable.length,
    categoriesToCreate: wanted.filter((slug) => !known.has(slug)).length,
    stockUnits,
    skippedSkus: importable.filter((r) => existing.has(r.sku)).map((r) => r.sku),
  };
  if (!options.apply || fresh.length === 0) {
    return result;
  }

  await prisma.$transaction(
    async (tx) => {
      const categories = await ensureCategories(tx, tenantId, fresh);
      for (const part of chunk(fresh, CHUNK_SIZE)) {
        await tx.product.createMany({
          data: part.map((r) => {
            const slugs = levelSlugs(r.categoryPath);
            const leaf = slugs.length > 0 ? slugs[slugs.length - 1] : null;
            return productData(tenantId, r, leaf ? (categories.get(leaf) ?? null) : null);
          }),
        });
      }
      if (warehouse && stockUnits > 0) {
        await bookOpeningStock(tx, tenantId, warehouse.id, fresh);
      }
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 30_000 },
  );

  return result;
}
