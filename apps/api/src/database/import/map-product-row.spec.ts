import type { RawProductRow } from './map-product-row';
import { dedupeBarcodes, mapProductRow } from './map-product-row';

const raw = (over: Partial<RawProductRow> = {}): RawProductRow => ({
  rowNumber: 2,
  id: 1,
  name: 'CINTA MAX CONTROL PRETO P',
  code: '4749',
  barcode: 7892524980721,
  ncm: 63090010,
  cfop: 5102,
  cest: null,
  unit: 'PC',
  cost: 25.5,
  sale: 69.9,
  stock: 2,
  group: 'CINTA',
  category: 'FEMININO',
  ...over,
});

const codes = (row: ReturnType<typeof mapProductRow>): string[] => row.issues.map((i) => i.code);

describe('mapProductRow', () => {
  it('should map a clean row without issues', () => {
    const row = mapProductRow(raw());

    expect(row).toMatchObject({
      rejected: false,
      sku: 'PRD-000001',
      name: 'CINTA MAX CONTROL PRETO P',
      ean: '7892524980721',
      ncm: '63090010',
      cfop: '5102',
      costPrice: 25.5,
      salePrice: 69.9,
      status: 'ACTIVE',
      stockQuantity: 2,
      categoryPath: ['Feminino', 'Cinta'],
    });
    expect(row.issues).toEqual([]);
  });

  it('should keep the legacy ids and unit in metadata', () => {
    expect(mapProductRow(raw()).metadata).toEqual({
      legacyId: 1,
      legacyCode: '4749',
      unit: 'PC',
      importedFrom: 'planilha',
    });
  });

  it('should collapse repeated spaces in the name', () => {
    expect(mapProductRow(raw({ name: '  CALCA PAMELA  - BRANCO   M ' })).name).toBe(
      'CALCA PAMELA - BRANCO M',
    );
  });

  it('should reject a row with no name', () => {
    const row = mapProductRow(raw({ name: '   ' }));

    expect(row.rejected).toBe(true);
    expect(codes(row)).toContain('NAME_MISSING');
  });

  describe('price', () => {
    it('should import as DRAFT with a warning when there is no sale price', () => {
      const row = mapProductRow(raw({ sale: null }));

      expect(row.status).toBe('DRAFT');
      expect(row.salePrice).toBe(0);
      expect(codes(row)).toContain('SALE_PRICE_MISSING');
    });

    it('should accept prices written as text with a decimal comma', () => {
      const row = mapProductRow(raw({ cost: 'R$ 25,50', sale: '69,90' }));

      expect(row.costPrice).toBe(25.5);
      expect(row.salePrice).toBe(69.9);
    });

    it('should round to cents', () => {
      expect(mapProductRow(raw({ cost: 10.123456 })).costPrice).toBe(10.12);
    });

    it('should warn, but keep the row, when the sale price is below cost', () => {
      const row = mapProductRow(raw({ cost: 50, sale: 30 }));

      expect(row.status).toBe('ACTIVE');
      expect(codes(row)).toContain('SALE_BELOW_COST');
    });

    it('should treat a missing cost as zero without a warning', () => {
      const row = mapProductRow(raw({ cost: null }));

      expect(row.costPrice).toBe(0);
      expect(codes(row)).not.toContain('SALE_BELOW_COST');
    });
  });

  describe('stock', () => {
    it('should turn negative stock into zero and flag it', () => {
      const row = mapProductRow(raw({ stock: -1 }));

      expect(row.stockQuantity).toBe(0);
      expect(codes(row)).toContain('STOCK_NEGATIVE');
    });

    it('should round fractional stock and flag it', () => {
      const row = mapProductRow(raw({ stock: 1.6 }));

      expect(row.stockQuantity).toBe(2);
      expect(codes(row)).toContain('STOCK_FRACTIONAL');
    });

    it('should accept stock written with a decimal comma', () => {
      expect(mapProductRow(raw({ stock: '3,000' })).stockQuantity).toBe(3);
    });
  });

  describe('barcode', () => {
    it('should drop a barcode that fails the check digit', () => {
      const row = mapProductRow(raw({ barcode: 7892524980720 }));

      expect(row.ean).toBeNull();
      expect(codes(row)).toContain('EAN_INVALID');
    });

    it('should drop a barcode that spreadsheet software turned into scientific notation', () => {
      const row = mapProductRow(raw({ barcode: '7.892524980883E+14' }));

      expect(row.ean).toBeNull();
      expect(codes(row)).toContain('EAN_SCIENTIFIC_NOTATION');
    });

    it('should drop a barcode with non-digit characters', () => {
      const row = mapProductRow(raw({ barcode: '037546#4218261' }));

      expect(row.ean).toBeNull();
      expect(codes(row)).toContain('EAN_INVALID');
    });

    it('should not complain about an empty barcode', () => {
      const row = mapProductRow(raw({ barcode: null }));

      expect(row.ean).toBeNull();
      expect(row.issues).toEqual([]);
    });
  });

  describe('fiscal codes', () => {
    it('should drop an NCM that does not have 8 digits', () => {
      const row = mapProductRow(raw({ ncm: 610822 }));

      expect(row.ncm).toBeNull();
      expect(codes(row)).toContain('NCM_INVALID');
    });

    it('should keep a missing NCM silent but empty', () => {
      const row = mapProductRow(raw({ ncm: null }));

      expect(row.ncm).toBeNull();
      expect(codes(row)).toContain('NCM_MISSING');
    });

    it('should not carry an entry CFOP into a product that is for sale', () => {
      const row = mapProductRow(raw({ cfop: 2102 }));

      expect(row.cfop).toBeNull();
      expect(codes(row)).toContain('CFOP_NOT_SALE');
    });

    it('should drop the placeholder CEST 0000000', () => {
      const row = mapProductRow(raw({ cest: '0000000' }));

      expect(row.cest).toBeNull();
    });

    it('should keep a valid CEST', () => {
      expect(mapProductRow(raw({ cest: '2805900' })).cest).toBe('2805900');
    });
  });

  describe('category path', () => {
    it.each([
      ['FEMININO', 'BABY DOLL', ['Feminino', 'Baby Doll']],
      [null, 'CALCINHA', ['Calcinha']],
      ['MASCULINO', null, ['Masculino']],
      [null, null, []],
    ])('should map category=%s group=%s to %j', (category, group, expected) => {
      expect(mapProductRow(raw({ category, group })).categoryPath).toEqual(expected);
    });
  });

  it('should fall back to the row number for the SKU when there is no id', () => {
    expect(mapProductRow(raw({ id: null, rowNumber: 12 })).sku).toBe('PRD-R000012');
  });
});

describe('dedupeBarcodes', () => {
  it('should keep the barcode on the first row only and flag the others', () => {
    const rows = [
      mapProductRow(raw({ id: 1, barcode: 7892524980721 })),
      mapProductRow(raw({ id: 2, barcode: 7892524980721 })),
      mapProductRow(raw({ id: 3, barcode: 7892524980721 })),
    ];

    const result = dedupeBarcodes(rows);

    expect(result.map((r) => r.ean)).toEqual(['7892524980721', null, null]);
    expect(result[1].issues.map((i) => i.code)).toContain('EAN_DUPLICATE');
    expect(result[0].issues).toEqual([]);
  });

  it('should leave rows with distinct barcodes alone', () => {
    const rows = [
      mapProductRow(raw({ id: 1, barcode: 7892524980721 })),
      mapProductRow(raw({ id: 2, barcode: 7892524980714 })),
    ];

    expect(dedupeBarcodes(rows).map((r) => r.ean)).toEqual(['7892524980721', '7892524980714']);
  });

  it('should reject a row whose SKU repeats an earlier one', () => {
    const rows = [mapProductRow(raw({ id: 5 })), mapProductRow(raw({ id: 5, barcode: null }))];

    const result = dedupeBarcodes(rows);

    expect(result[1].rejected).toBe(true);
    expect(result[1].issues.map((i) => i.code)).toContain('SKU_DUPLICATE');
  });
});
