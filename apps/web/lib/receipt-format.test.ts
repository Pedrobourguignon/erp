import { describe, expect, it } from 'vitest';

import { copyLabel, installmentsLabel, pxToMm, receiptPageCss } from './receipt-format';

describe('installmentsLabel', () => {
  it('is empty for a single payment', () => {
    expect(installmentsLabel([100])).toBe('');
  });

  it('says "3x de" when every installment is the same', () => {
    expect(installmentsLabel([50, 50, 50])).toMatch(/^3x de R\$\s50,00$/);
  });

  // R$ 100,00 em 3x: a última parcela leva o centavo que sobra.
  it('groups the installments that differ, in the order they are due', () => {
    expect(installmentsLabel([33.33, 33.33, 33.34])).toMatch(
      /^2x de R\$\s33,33 \+ 1x de R\$\s33,34$/
    );
  });
});

describe('copyLabel', () => {
  it('prints nothing on the original', () => {
    expect(copyLabel(1)).toBeNull();
  });

  it.each([
    [2, '2ª VIA'],
    [3, '3ª VIA'],
  ])('marks copy %i as "%s"', (copy, label) => {
    expect(copyLabel(copy)).toBe(label);
  });
});

describe('receiptPageCss', () => {
  // "size: 80mm auto" não é CSS válido: o Chrome descartava a regra e a prévia
  // saía numa folha A4 com o recibo estreito no canto.
  it.each([
    ['THERMAL_80', 'size: 80mm 149mm'],
    ['THERMAL_58', 'size: 58mm 149mm'],
  ] as const)('sizes the thermal roll of %s to the receipt plus a blank feed, in two lengths', (format, size) => {
    const css = receiptPageCss(format, 142.3);

    expect(css).toContain(size);
    expect(css).not.toContain('auto');
  });

  it('never makes a thermal page shorter than a minimal receipt', () => {
    expect(receiptPageCss('THERMAL_80', 0)).toContain('size: 80mm 50mm');
  });

  it('removes the margins of the thermal paper', () => {
    expect(receiptPageCss('THERMAL_80', 100)).toContain('margin: 0');
  });

  it('prints A4 as a regular sheet, whatever the receipt height', () => {
    expect(receiptPageCss('A4', 100)).toContain('size: A4');
  });
});

describe('pxToMm', () => {
  it('converts CSS pixels (96 per inch) to millimetres', () => {
    expect(pxToMm(96)).toBeCloseTo(25.4);
  });
});
