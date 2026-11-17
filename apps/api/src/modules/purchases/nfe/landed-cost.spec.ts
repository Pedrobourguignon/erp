import { allocateCents, computeLandedCosts } from './landed-cost';
import { NFE_XML } from './nfe-fixture';
import { parseNfeXml } from './nfe-parser';

describe('allocateCents', () => {
  it('splits proportionally to the weights', () => {
    expect(allocateCents(1850, [8500, 10000])).toEqual([850, 1000]);
  });

  it('never loses or invents a cent (largest remainder)', () => {
    const parts = allocateCents(1000, [1, 1, 1]);

    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('is all zeros when there is nothing to split or nothing to weigh by', () => {
    expect(allocateCents(0, [1, 2])).toEqual([0, 0]);
    expect(allocateCents(500, [0, 0])).toEqual([0, 0]);
  });
});

describe('computeLandedCosts', () => {
  const costs = () => computeLandedCosts(parseNfeXml(NFE_XML));

  it('adds freight, IPI and ICMS-ST and subtracts the discount, item by item', () => {
    const [first, second] = costs();

    // item 1: 85,00 − 5,00 (desconto) + 8,50 (frete rateado) + 4,00 (IPI) = 92,50
    expect(first).toMatchObject({ line: 1, totalCents: 9250, unitCost: 9.25 });
    // item 2: 100,00 + 10,00 (frete rateado) + 6,00 (ICMS-ST) = 116,00
    expect(second).toMatchObject({ line: 2, totalCents: 11600, unitCost: 23.2 });
  });

  it('adds up to the invoice total (vNF)', () => {
    const total = costs().reduce((sum, c) => sum + c.totalCents, 0);

    expect(total).toBe(parseNfeXml(NFE_XML).totals.invoiceCents);
  });

  it('shows where the cost came from, so the shop owner can check it', () => {
    expect(costs()[0].breakdown).toEqual({
      grossCents: 8500,
      discountCents: 500,
      freightCents: 850,
      insuranceCents: 0,
      otherCents: 0,
      ipiCents: 400,
      stCents: 0,
    });
  });

  it('rounds the unit cost to 4 decimals', () => {
    const xml = NFE_XML
      .replace('<qCom>10.0000</qCom>', '<qCom>3.0000</qCom>')
      .replace('<vProd>85.00</vProd>', '<vProd>100.00</vProd>');

    const [first] = computeLandedCosts(parseNfeXml(xml));

    // o valor total dividido por 3 não é exato: 4 casas, como a coluna do banco
    expect(String(first.unitCost).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });

  it('uses the item value when the items carry the discount, and the invoice total when they do not', () => {
    // desconto só no total da nota (nenhum item o traz): rateia por valor
    const xml = NFE_XML
      .replace('<vDesc>5.00</vDesc>\n        </prod>', '</prod>')
      .replace(/(<vDesc>)5\.00(<\/vDesc>)/, '$110.00$2')
      .replace('<vNF>208.50</vNF>', '<vNF>203.50</vNF>');
    const parsed = parseNfeXml(xml);

    const [first, second] = computeLandedCosts(parsed);

    // 10,00 de desconto repartido por 85/185 e 100/185 → 4,59 e 5,41
    expect(first.breakdown.discountCents).toBe(459);
    expect(second.breakdown.discountCents).toBe(541);
    expect(first.breakdown.discountCents + second.breakdown.discountCents).toBe(1000);
  });

  it('flags an item whose quantity is not a whole number', () => {
    const xml = NFE_XML.replace('<qCom>10.0000</qCom>', '<qCom>2.5000</qCom>');

    const [first, second] = computeLandedCosts(parseNfeXml(xml));

    expect(first.unitCost).toBeGreaterThan(0);
    expect(first.wholeQuantity).toBe(false);
    expect(second.wholeQuantity).toBe(true);
  });
});
