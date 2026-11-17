import { describe, it, expect } from 'vitest';

import { cardMachineSchema, fillRateRange, resizeRates } from './card-machine-form';

const rates = (...fees: number[]) =>
  fees.map((feePercentage, i) => ({ installments: i + 1, feePercentage }));

describe('resizeRates', () => {
  it('grows the table to the new maximum, repeating the last rate', () => {
    expect(resizeRates(rates(3.19, 4.99), 4)).toEqual(rates(3.19, 4.99, 4.99, 4.99));
  });

  it('shrinks the table, keeping the rates already typed', () => {
    expect(resizeRates(rates(3.19, 4.99, 5.5), 2)).toEqual(rates(3.19, 4.99));
  });

  it('starts an empty table at 0%', () => {
    expect(resizeRates([], 2)).toEqual(rates(0, 0));
  });

  it('empties the table when the machine takes no credit', () => {
    expect(resizeRates(rates(3.19), 0)).toEqual([]);
  });
});

describe('fillRateRange', () => {
  it('fills 2x to 6x with the same rate and leaves the rest alone', () => {
    expect(fillRateRange(rates(3, 0, 0, 0, 0, 0, 0), 2, 6, 4.99)).toEqual(
      rates(3, 4.99, 4.99, 4.99, 4.99, 4.99, 0)
    );
  });

  it('accepts the range typed backwards', () => {
    expect(fillRateRange(rates(0, 0, 0), 3, 2, 5)).toEqual(rates(0, 5, 5));
  });

  it('ignores the part of the range beyond the table', () => {
    expect(fillRateRange(rates(0, 0), 2, 12, 5)).toEqual(rates(0, 5));
  });
});

describe('cardMachineSchema', () => {
  const valid = {
    name: 'Stone Loja Centro',
    provider: 'Stone',
    debitFeePercentage: 1.5,
    debitSettlementDays: 1,
    acceptsCredit: true,
    creditReceiveMode: 'FLOW',
    creditSettlementDays: 30,
    maxInstallments: 2,
    rates: rates(3.19, 4.99),
  };

  it('accepts a complete machine', () => {
    expect(cardMachineSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['name', '', 'Informe o nome da maquininha'],
    ['debitFeePercentage', -1, 'A taxa não pode ser negativa'],
    ['debitFeePercentage', 101, 'A taxa não pode passar de 100%'],
    ['debitSettlementDays', 1.5, 'Informe um número inteiro de dias'],
    ['maxInstallments', 25, 'O máximo é 24 parcelas'],
  ])('refuses %s = %s, in Portuguese', (field, value, message) => {
    const result = cardMachineSchema.safeParse({ ...valid, [field]: value });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain(message);
  });

  it('refuses a negative rate on a line of the table', () => {
    const result = cardMachineSchema.safeParse({ ...valid, rates: rates(3.19, -2) });

    expect(result.success).toBe(false);
  });

  it('accepts a debit-only machine without a rate table', () => {
    const result = cardMachineSchema.safeParse({
      ...valid,
      acceptsCredit: false,
      rates: [],
    });

    expect(result.success).toBe(true);
  });
});
