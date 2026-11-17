import { matchItem, normalizeText, type CatalogEntry, type KnownCode } from './product-matcher';
import type { NfeItem } from './nfe-parser';

const entry = (overrides: Partial<CatalogEntry> & { productId: string }): CatalogEntry => ({
  variantId: null,
  sku: 'SKU',
  name: 'Produto',
  ean: null,
  ncm: null,
  ...overrides,
});

const item = (overrides: Partial<NfeItem> = {}): NfeItem => ({
  line: 1,
  code: 'CAL-001',
  ean: null,
  description: 'CALCINHA ALGODAO TRADICIONAL M',
  ncm: '61081100',
  cfop: '5102',
  unit: 'UN',
  quantity: 10,
  listUnitPrice: 8.5,
  grossCents: 8500,
  discountCents: 0,
  freightCents: 0,
  insuranceCents: 0,
  otherCents: 0,
  ipiCents: 0,
  stCents: 0,
  ...overrides,
});

describe('normalizeText', () => {
  it('ignores case, accents, punctuation and filler words', () => {
    expect(normalizeText('Calcinha  Nany, de Algodão (Tradicional)')).toEqual([
      'calcinha', 'nany', 'algodao', 'tradicional',
    ]);
  });
});

describe('matchItem', () => {
  const catalog: CatalogEntry[] = [
    entry({ productId: 'p-cal', sku: 'NANY-ALG', name: 'Calcinha Nany Algodão Tradicional - M', ean: '7891234567895', ncm: '61081100' }),
    entry({ productId: 'p-cal-g', sku: 'NANY-ALG-G', name: 'Calcinha Nany Algodão Tradicional - G', ean: '7891234567987' }),
    entry({ productId: 'p-cam', sku: 'CAM-BAS', name: 'Camiseta Básica Gola V P' }),
  ];

  it('is MATCHED by the code this supplier already used (remembered de-para)', () => {
    const known: KnownCode[] = [{ supplierCode: 'CAL-001', productId: 'p-cam', variantId: null }];

    const result = matchItem(item(), catalog, known);

    expect(result.status).toBe('MATCHED');
    expect(result.candidates[0]).toMatchObject({ productId: 'p-cam', kind: 'SUPPLIER_CODE', score: 1 });
  });

  it('is MATCHED by an EAN that points to a single product', () => {
    const result = matchItem(item({ ean: '7891234567895', description: 'qualquer coisa' }), catalog, []);

    expect(result.status).toBe('MATCHED');
    expect(result.candidates[0]).toMatchObject({ productId: 'p-cal', kind: 'EAN', score: 1 });
  });

  it('is only SUGGESTED when the EAN belongs to more than one product', () => {
    const twins = [
      entry({ productId: 'a', ean: '7891234567895', name: 'A' }),
      entry({ productId: 'b', ean: '7891234567895', name: 'B' }),
    ];

    const result = matchItem(item({ ean: '7891234567895' }), twins, []);

    expect(result.status).toBe('SUGGESTED');
    expect(result.candidates.map((c) => c.productId).sort()).toEqual(['a', 'b']);
  });

  it('only SUGGESTS a SKU that equals the supplier code — a coincidence is not proof', () => {
    const result = matchItem(item({ code: 'cam-bas', description: 'xyz' }), catalog, []);

    expect(result.status).toBe('SUGGESTED');
    expect(result.candidates[0]).toMatchObject({ productId: 'p-cam', kind: 'SKU' });
  });

  it('SUGGESTS products with a similar name, best first', () => {
    const result = matchItem(item(), catalog, []);

    expect(result.status).toBe('SUGGESTED');
    expect(result.candidates[0]).toMatchObject({ productId: 'p-cal', kind: 'NAME' });
    expect(result.candidates[0].score).toBeGreaterThan(0.8);
    // o mesmo produto em outro tamanho aparece, mas depois
    expect(result.candidates.map((c) => c.productId)).toContain('p-cal-g');
    expect(result.candidates[0].score).toBeGreaterThanOrEqual(result.candidates[1].score);
  });

  it('is NEW when nothing resembles the item', () => {
    const result = matchItem(
      item({ code: 'XYZ-9', description: 'MEIA SOQUETE ESPORTIVA', ncm: '61159500' }),
      catalog,
      [],
    );

    expect(result).toEqual({ status: 'NEW', candidates: [] });
  });

  it('ignores a "SEM GTIN" item (no EAN) instead of matching every product with no EAN', () => {
    const noEan = [entry({ productId: 'x', ean: null, name: 'Outra coisa' })];

    const result = matchItem(item({ ean: null, description: 'MEIA SOQUETE' }), noEan, []);

    expect(result.status).toBe('NEW');
  });

  it('lists a product once, with its best reason', () => {
    const result = matchItem(item({ ean: '7891234567895' }), catalog, []);

    expect(result.candidates.filter((c) => c.productId === 'p-cal')).toHaveLength(1);
  });

  it('matches a variant by its own EAN and keeps the variant', () => {
    const withVariant = [
      entry({ productId: 'p-1', variantId: 'v-m', sku: 'P1-M', name: 'Calcinha - M', ean: '7891234567895' }),
      entry({ productId: 'p-1', variantId: 'v-g', sku: 'P1-G', name: 'Calcinha - G', ean: '7891234567987' }),
    ];

    const result = matchItem(item({ ean: '7891234567987' }), withVariant, []);

    expect(result.candidates[0]).toMatchObject({ productId: 'p-1', variantId: 'v-g', kind: 'EAN' });
  });

  it('ignores a remembered code whose product is gone from the catalog', () => {
    const known: KnownCode[] = [{ supplierCode: 'CAL-001', productId: 'apagado', variantId: null }];

    const result = matchItem(item({ description: 'MEIA SOQUETE' }), catalog, known);

    expect(result.status).toBe('NEW');
  });

  // O EAN confere, mas o nome não tem nada a ver: a tela precisa avisar. Um EAN
  // digitado errado ou reaproveitado entre produtos já aconteceu.
  it('reports how much the name resembles the item, even when the EAN is what matched', () => {
    const wrongProduct = [entry({ productId: 'x', ean: '7891234567895', name: 'Capinha iPhone 15 Pro' })];

    const result = matchItem(item({ ean: '7891234567895' }), wrongProduct, []);

    expect(result.status).toBe('MATCHED');
    expect(result.candidates[0].nameSimilarity).toBe(0);
  });

  it('gives a high name similarity to the right product', () => {
    const result = matchItem(item({ ean: '7891234567895' }), catalog, []);

    expect(result.candidates[0].nameSimilarity).toBeGreaterThan(0.8);
  });

  it('caps the suggestions at five', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      entry({ productId: `p-${i}`, name: `Calcinha Algodão Tradicional modelo ${i}` }),
    );

    expect(matchItem(item(), many, []).candidates.length).toBeLessThanOrEqual(5);
  });
});
