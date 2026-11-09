import { ImportError, importProducts } from './import-products';
import type { MappedProductRow } from './map-product-row';

const row = (over: Partial<MappedProductRow> = {}): MappedProductRow => ({
  rowNumber: 2,
  rejected: false,
  sku: 'PRD-000001',
  name: 'CINTA MAX CONTROL PRETO P',
  ean: '7892524980721',
  ncm: '63090010',
  cest: null,
  cfop: '5102',
  costPrice: 25.5,
  salePrice: 69.9,
  status: 'ACTIVE',
  stockQuantity: 2,
  categoryPath: ['Feminino', 'Cinta'],
  metadata: { legacyId: 1, legacyCode: '4749', unit: 'PC', importedFrom: 'planilha' },
  issues: [],
  ...over,
});

function build(opts: { existingSkus?: string[]; warehouse?: boolean; tenant?: boolean } = {}) {
  const { existingSkus = [], warehouse = true, tenant = true } = opts;
  let categorySeq = 0;
  const tx = {
    category: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: { slug: string } }) =>
          Promise.resolve({ id: `cat-${data.slug}-${++categorySeq}` }),
        ),
    },
    product: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { sku: { in: string[] } } }) =>
          Promise.resolve(where.sku.in.map((sku) => ({ id: `id-${sku}`, sku }))),
        ),
    },
    inventoryItem: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    inventoryMovement: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    tenant: { findFirst: jest.fn().mockResolvedValue(tenant ? { id: 'tenant-1' } : null) },
    warehouse: { findFirst: jest.fn().mockResolvedValue(warehouse ? { id: 'wh-1' } : null) },
    category: { findMany: jest.fn().mockResolvedValue([]) },
    product: {
      findMany: jest
        .fn()
        .mockResolvedValue(existingSkus.map((sku) => ({ sku }))),
    },
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx };
}

describe('importProducts', () => {
  it('should write nothing in a dry run, only report what would happen', async () => {
    const { prisma, tx } = build();

    const result = await importProducts(prisma as never, 'tenant-1', [row()], { apply: false });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.product.createMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      applied: false,
      toCreate: 1,
      skippedExisting: 0,
      rejected: 0,
      stockUnits: 2,
    });
  });

  it('should create products scoped to the tenant', async () => {
    const { prisma, tx } = build();

    await importProducts(prisma as never, 'tenant-1', [row()], { apply: true });

    expect(tx.product.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          tenantId: 'tenant-1',
          sku: 'PRD-000001',
          name: 'CINTA MAX CONTROL PRETO P',
          ean: '7892524980721',
          costPrice: 25.5,
          salePrice: 69.9,
          status: 'ACTIVE',
          type: 'SIMPLE',
        }),
      ],
    });
  });

  it('should skip SKUs that already exist, so a second run duplicates nothing', async () => {
    const { prisma, tx } = build({ existingSkus: ['PRD-000001'] });

    const result = await importProducts(
      prisma as never,
      'tenant-1',
      [row(), row({ sku: 'PRD-000002', rowNumber: 3 })],
      { apply: true },
    );

    expect(result).toMatchObject({
      skippedExisting: 1,
      toCreate: 1,
      skippedSkus: ['PRD-000001'],
    });
    const created = (tx.product.createMany.mock.calls[0][0] as { data: { sku: string }[] }).data;
    expect(created.map((p) => p.sku)).toEqual(['PRD-000002']);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-1' }) }),
    );
  });

  it('should not import rejected rows', async () => {
    const { prisma, tx } = build();

    const result = await importProducts(
      prisma as never,
      'tenant-1',
      [row({ rejected: true })],
      { apply: true },
    );

    expect(result.rejected).toBe(1);
    expect(tx.product.createMany).not.toHaveBeenCalled();
  });

  it('should create the category tree root first and reuse existing categories', async () => {
    const { prisma, tx } = build();
    prisma.category.findMany.mockResolvedValue([
      { id: 'cat-existing', slug: 'feminino', parentId: null },
    ]);
    tx.category.findMany.mockResolvedValue([
      { id: 'cat-existing', slug: 'feminino', parentId: null },
    ]);

    await importProducts(prisma as never, 'tenant-1', [row()], { apply: true });

    expect(tx.category.create).toHaveBeenCalledTimes(1);
    expect(tx.category.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          name: 'Cinta',
          slug: 'feminino-cinta',
          parentId: 'cat-existing',
        }),
      }),
    );
    const created = (tx.product.createMany.mock.calls[0][0] as { data: { categoryId: string }[] })
      .data;
    expect(created[0].categoryId).toMatch(/^cat-feminino-cinta/);
  });

  it('should book stock as an INITIAL entry in the default warehouse, at cost', async () => {
    const { prisma, tx } = build();

    await importProducts(prisma as never, 'tenant-1', [row({ stockQuantity: 3 })], {
      apply: true,
    });

    expect(tx.inventoryItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          tenantId: 'tenant-1',
          productId: 'id-PRD-000001',
          warehouseId: 'wh-1',
          quantity: 3,
          available: 3,
          reserved: 0,
          costAverage: 25.5,
        }),
      ],
    });
    expect(tx.inventoryMovement.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          tenantId: 'tenant-1',
          productId: 'id-PRD-000001',
          type: 'ENTRY',
          reason: 'INITIAL',
          quantity: 3,
          unitCost: 25.5,
          toWarehouseId: 'wh-1',
        }),
      ],
    });
  });

  it('should not create stock rows for products without stock', async () => {
    const { prisma, tx } = build();

    await importProducts(prisma as never, 'tenant-1', [row({ stockQuantity: 0 })], {
      apply: true,
    });

    expect(tx.inventoryItem.createMany).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.createMany).not.toHaveBeenCalled();
  });

  it('should refuse when there is stock to book but no default warehouse', async () => {
    const { prisma } = build({ warehouse: false });

    await expect(
      importProducts(prisma as never, 'tenant-1', [row()], { apply: true }),
    ).rejects.toThrow(ImportError);
  });

  it('should refuse an unknown tenant before reading anything else', async () => {
    const { prisma } = build({ tenant: false });

    await expect(
      importProducts(prisma as never, 'ghost', [row()], { apply: true }),
    ).rejects.toThrow(/Empresa não encontrada/);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });

  it('should write everything in one transaction', async () => {
    const { prisma } = build();

    await importProducts(prisma as never, 'tenant-1', [row()], { apply: true });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('should split a large import into chunks', async () => {
    const { prisma, tx } = build();
    const rows = Array.from({ length: 1201 }, (_, i) =>
      row({ sku: `PRD-${String(i + 1).padStart(6, '0')}`, rowNumber: i + 2, stockQuantity: 0 }),
    );

    await importProducts(prisma as never, 'tenant-1', rows, { apply: true });

    expect(tx.product.createMany).toHaveBeenCalledTimes(3);
  });
});
