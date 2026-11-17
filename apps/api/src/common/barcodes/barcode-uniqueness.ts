import { ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { onlyDigits } from '@erp/validators';

/** PrismaService or a transaction client: the checks run inside writes too. */
type Db = Pick<PrismaClient, 'product' | 'productVariant' | '$queryRaw'> | Prisma.TransactionClient;

export interface BarcodeOwner {
  productId: string;
  variantId: string | null;
  name: string;
  sku: string;
}

export interface BarcodeDuplicate {
  ean: string;
  owners: BarcodeOwner[];
}

/**
 * One barcode, one product (or one size/colour) per company.
 *
 * The reader looks a code up by equality; two registrations on the same code
 * make the read ambiguous and the counter stops. Products and variants share
 * the same code space, so the check spans both tables — a database index can
 * only cover the products one (variants carry no tenant), hence this check on
 * every path that writes an EAN: registration, spreadsheet import, purchase
 * receipt.
 */
export async function assertBarcodesFree(
  db: Db,
  tenantId: string,
  rawCodes: ReadonlyArray<string | null | undefined>,
  exclude: { productId?: string } = {},
): Promise<void> {
  const codes = rawCodes.map((code) => onlyDigits(code)).filter((code) => code.length > 0);

  const seen = new Set<string>();
  for (const code of codes) {
    if (seen.has(code)) {
      throw new ConflictException(`O código ${code} aparece mais de uma vez neste cadastro`);
    }
    seen.add(code);
  }

  for (const code of codes) {
    const product = await db.product.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        ean: code,
        ...(exclude.productId ? { id: { not: exclude.productId } } : {}),
      },
      select: { name: true, sku: true },
    });
    if (product) {
      throw new ConflictException(`O código ${code} já está em ${product.name} (${product.sku})`);
    }
    const variant = await db.productVariant.findFirst({
      where: { ean: code, product: { tenantId, deletedAt: null } },
      select: { name: true, sku: true, product: { select: { name: true } } },
    });
    if (variant) {
      throw new ConflictException(
        `O código ${code} já está em ${variant.product.name} — ${variant.name} (${variant.sku})`,
      );
    }
  }
}

/** The codes registered more than once today, for the store to fix. */
export async function findBarcodeDuplicates(db: Db, tenantId: string): Promise<BarcodeDuplicate[]> {
  const rows = await db.$queryRaw<Array<BarcodeOwner & { ean: string }>>`
    WITH codes AS (
      SELECT p.ean, p.id AS "productId", NULL::text AS "variantId", p.name, p.sku
        FROM products p
       WHERE p."tenantId" = ${tenantId} AND p."deletedAt" IS NULL AND p.ean IS NOT NULL AND p.ean <> ''
      UNION ALL
      SELECT v.ean, p.id, v.id, p.name || ' — ' || v.name, v.sku
        FROM product_variants v
        JOIN products p ON p.id = v."productId"
       WHERE p."tenantId" = ${tenantId} AND p."deletedAt" IS NULL AND v.ean IS NOT NULL AND v.ean <> ''
    )
    SELECT c.* FROM codes c
     WHERE c.ean IN (SELECT ean FROM codes GROUP BY ean HAVING COUNT(*) > 1)
     ORDER BY c.ean, c.name`;

  const groups = new Map<string, BarcodeOwner[]>();
  for (const { ean, ...owner } of rows) {
    groups.set(ean, [...(groups.get(ean) ?? []), owner]);
  }
  return [...groups].map(([ean, owners]) => ({ ean, owners }));
}
