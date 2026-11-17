import {
  planCardReceivables,
  cardMaxInstallments,
  type CardMachineTerms,
} from '@erp/validators';
import { describe, it, expect } from 'vitest';

/**
 * O que uma venda no cartão gera no financeiro, calculado a partir da
 * maquininha. A API grava exatamente esta lista e a tela de venda mostra a
 * mesma prévia — uma função só para os dois lados (lição do VD-10).
 */

const flow: CardMachineTerms = {
  debitFeePercentage: 1.5,
  debitSettlementDays: 1,
  creditReceiveMode: 'FLOW',
  creditSettlementDays: 30,
  rates: [
    { installments: 1, feePercentage: 3.19 },
    { installments: 2, feePercentage: 4.99 },
    { installments: 3, feePercentage: 4.99 },
  ],
};

const anticipated: CardMachineTerms = {
  ...flow,
  creditReceiveMode: 'ANTICIPATED',
  creditSettlementDays: 1,
  rates: [
    { installments: 1, feePercentage: 4.2 },
    { installments: 3, feePercentage: 8.99 },
  ],
};

const sum = (values: number[]) =>
  values.reduce((acc, v) => acc + Math.round(v * 100), 0) / 100;

describe('planCardReceivables — débito', () => {
  it('gera um título no prazo do débito, com a taxa do débito', () => {
    expect(
      planCardReceivables({ kind: 'DEBIT', amount: 200, installments: 1, terms: flow })
    ).toEqual([
      { installment: 1, totalInstallments: 1, amount: 200, fee: 3, dueInDays: 1 },
    ]);
  });

  it('débito na hora vence no próprio dia', () => {
    const [item] = planCardReceivables({
      kind: 'DEBIT',
      amount: 200,
      installments: 1,
      terms: { ...flow, debitSettlementDays: 0 },
    });

    expect(item.dueInDays).toBe(0);
  });
});

describe('planCardReceivables — crédito no fluxo', () => {
  it('1x vence no prazo do crédito, com a taxa de 1x', () => {
    expect(
      planCardReceivables({ kind: 'CREDIT', amount: 100, installments: 1, terms: flow })
    ).toEqual([
      { installment: 1, totalInstallments: 1, amount: 100, fee: 3.19, dueInDays: 30 },
    ]);
  });

  it('3x gera uma parcela a cada 30 dias, cada uma com sua parte da taxa', () => {
    const plan = planCardReceivables({
      kind: 'CREDIT',
      amount: 300,
      installments: 3,
      terms: flow,
    });

    expect(plan.map((p) => p.dueInDays)).toEqual([30, 60, 90]);
    expect(plan.map((p) => p.amount)).toEqual([100, 100, 100]);
    // 4,99% de 300 = 14,97 → 4,99 por parcela
    expect(plan.map((p) => p.fee)).toEqual([4.99, 4.99, 4.99]);
    expect(plan.every((p) => p.totalInstallments === 3)).toBe(true);
  });

  it('a soma dos valores e das taxas fecha exatamente, com a sobra na última', () => {
    const plan = planCardReceivables({
      kind: 'CREDIT',
      amount: 189.8,
      installments: 3,
      terms: flow,
    });

    expect(plan.map((p) => p.amount)).toEqual([63.27, 63.27, 63.26]);
    expect(sum(plan.map((p) => p.amount))).toBe(189.8);
    // 4,99% de 189,80 = 9,47 (9,47102)
    expect(sum(plan.map((p) => p.fee))).toBe(9.47);
  });

  it('o primeiro repasse segue o prazo do crédito da maquininha', () => {
    const plan = planCardReceivables({
      kind: 'CREDIT',
      amount: 300,
      installments: 3,
      terms: { ...flow, creditSettlementDays: 31 },
    });

    expect(plan.map((p) => p.dueInDays)).toEqual([31, 61, 91]);
  });
});

describe('planCardReceivables — crédito antecipado', () => {
  it('3x cai inteiro de uma vez no prazo, com a taxa total de 3x', () => {
    expect(
      planCardReceivables({
        kind: 'CREDIT',
        amount: 300,
        installments: 3,
        terms: anticipated,
      })
    ).toEqual([
      // 8,99% de 300 = 26,97
      { installment: 1, totalInstallments: 1, amount: 300, fee: 26.97, dueInDays: 1 },
    ]);
  });
});

describe('planCardReceivables — o que não se aceita', () => {
  it('recusa um número de parcelas que a maquininha não tem na tabela', () => {
    expect(() =>
      planCardReceivables({ kind: 'CREDIT', amount: 300, installments: 2, terms: anticipated })
    ).toThrow('2x');
  });

  it('recusa parcelar no débito', () => {
    expect(() =>
      planCardReceivables({ kind: 'DEBIT', amount: 300, installments: 2, terms: flow })
    ).toThrow();
  });
});

describe('cardMaxInstallments', () => {
  it('é a maior linha da tabela de taxas', () => {
    expect(cardMaxInstallments(flow)).toBe(3);
  });

  it('é 1 quando a tabela está vazia', () => {
    expect(cardMaxInstallments({ ...flow, rates: [] })).toBe(1);
  });
});
