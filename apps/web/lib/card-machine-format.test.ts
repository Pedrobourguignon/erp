import { describe, it, expect } from 'vitest';

import {
  describeCreditReceipt,
  describeDebitReceipt,
  summarizeRates,
} from './card-machine-format';

const rates = (...fees: number[]) =>
  fees.map((feePercentage, i) => ({ installments: i + 1, feePercentage }));

describe('summarizeRates', () => {
  it('groups consecutive installments with the same rate into a range', () => {
    expect(summarizeRates(rates(3.19, 4.99, 4.99, 4.99, 5.99, 5.99))).toBe(
      '1x 3,19% · 2–4x 4,99% · 5–6x 5,99%'
    );
  });

  it('shows a single row as is', () => {
    expect(summarizeRates(rates(3))).toBe('1x 3%');
  });

  it('says when the machine takes no credit', () => {
    expect(summarizeRates([])).toBe('Não aceita crédito');
  });
});

describe('describeDebitReceipt', () => {
  it.each([
    [0, 'Cai na hora'],
    [1, 'Cai em 1 dia'],
    [2, 'Cai em 2 dias'],
  ])('%i dias → %s', (days, text) => {
    expect(describeDebitReceipt(days)).toBe(text);
  });
});

describe('describeCreditReceipt', () => {
  it('in the flow, one installment per month from the first transfer', () => {
    expect(describeCreditReceipt('FLOW', 30)).toBe(
      'Parcela a parcela · 1º repasse em 30 dias'
    );
  });

  it('anticipated, everything at once', () => {
    expect(describeCreditReceipt('ANTICIPATED', 1)).toBe('Antecipado · tudo em 1 dia');
    expect(describeCreditReceipt('ANTICIPATED', 0)).toBe('Antecipado · tudo na hora');
  });
});
