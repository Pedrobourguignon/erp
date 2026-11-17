import { ConflictException } from '@nestjs/common';
import { assertBarcodesFree, findBarcodeDuplicates } from './barcode-uniqueness';

const TENANT_ID = 'tenant-1';

function makeDb() {
  return {
    product: { findFirst: jest.fn().mockResolvedValue(null) },
    productVariant: { findFirst: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
}

describe('assertBarcodesFree', () => {
  it('lets a code nobody uses through', async () => {
    const db = makeDb();

    await expect(assertBarcodesFree(db as never, TENANT_ID, ['7891234567895'])).resolves.toBeUndefined();
  });

  it('refuses a code already on another product, naming it', async () => {
    const db = makeDb();
    db.product.findFirst.mockResolvedValue({ name: 'Boné', sku: 'BON-01' });

    await expect(assertBarcodesFree(db as never, TENANT_ID, ['7891234567895'])).rejects.toThrow(
      new ConflictException('O código 7891234567895 já está em Boné (BON-01)'),
    );
    expect(db.product.findFirst.mock.calls[0][0].where).toEqual({
      tenantId: TENANT_ID,
      deletedAt: null,
      ean: '7891234567895',
    });
  });

  it('refuses a code already on a variant of any product of the tenant', async () => {
    const db = makeDb();
    db.productVariant.findFirst.mockResolvedValue({ name: 'M', sku: 'CAM-M', product: { name: 'Camiseta' } });

    await expect(assertBarcodesFree(db as never, TENANT_ID, ['7891234567895'])).rejects.toThrow(
      new ConflictException('O código 7891234567895 já está em Camiseta — M (CAM-M)'),
    );
    expect(db.productVariant.findFirst.mock.calls[0][0].where).toEqual({
      ean: '7891234567895',
      product: { tenantId: TENANT_ID, deletedAt: null },
    });
  });

  it('does not count the product being edited against itself', async () => {
    const db = makeDb();

    await assertBarcodesFree(db as never, TENANT_ID, ['7891234567895'], { productId: 'prod-1' });

    expect(db.product.findFirst.mock.calls[0][0].where.id).toEqual({ not: 'prod-1' });
  });

  it('refuses the same code twice in one registration (product and its size)', async () => {
    const db = makeDb();

    await expect(
      assertBarcodesFree(db as never, TENANT_ID, ['7891234567895', '789.1234.567895']),
    ).rejects.toThrow(new ConflictException('O código 7891234567895 aparece mais de uma vez neste cadastro'));
  });

  it('compares digits only, as they are stored', async () => {
    const db = makeDb();

    await assertBarcodesFree(db as never, TENANT_ID, [' 789 1234 567895 ']);

    expect(db.product.findFirst.mock.calls[0][0].where.ean).toBe('7891234567895');
  });

  it('ignores empty codes', async () => {
    const db = makeDb();

    await assertBarcodesFree(db as never, TENANT_ID, [null, undefined, '']);

    expect(db.product.findFirst).not.toHaveBeenCalled();
  });
});

describe('findBarcodeDuplicates', () => {
  it('groups the products and variants that share a code', async () => {
    const db = makeDb();
    db.$queryRaw.mockResolvedValue([
      { ean: '7891234567895', productId: 'p1', variantId: null, name: 'Boné', sku: 'BON-01' },
      { ean: '7891234567895', productId: 'p2', variantId: 'v2', name: 'Camiseta — M', sku: 'CAM-M' },
    ]);

    await expect(findBarcodeDuplicates(db as never, TENANT_ID)).resolves.toEqual([
      {
        ean: '7891234567895',
        owners: [
          { productId: 'p1', variantId: null, name: 'Boné', sku: 'BON-01' },
          { productId: 'p2', variantId: 'v2', name: 'Camiseta — M', sku: 'CAM-M' },
        ],
      },
    ]);
  });
});
