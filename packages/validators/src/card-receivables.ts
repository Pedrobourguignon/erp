/**
 * What a card sale produces in the financial module, derived from the card
 * machine ("maquininha") the payment method is linked to.
 *
 * The API writes exactly this list (receivables + the acquirer fee of each
 * one) and the sale screen previews the same thing — one function for both
 * sides, the lesson of VD-10.
 *
 * Rates are the *total* the merchant pays for each number of installments, as
 * the machine's app shows it ("Crédito 3x: 8,99%"). When the machine anticipates,
 * that total already includes the anticipation.
 */

import { roundMoney, splitInstallments } from './order-money';

/** FLOW: each installment lands every 30 days. ANTICIPATED: all of it at once. */
export type CardReceiveMode = 'FLOW' | 'ANTICIPATED';

export interface CardMachineRate {
  installments: number;
  feePercentage: number;
}

export interface CardMachineTerms {
  debitFeePercentage: number;
  /** 0 = the money is in the account at the sale. */
  debitSettlementDays: number;
  creditReceiveMode: CardReceiveMode;
  /** Days to the first transfer (FLOW) or to the whole amount (ANTICIPATED). */
  creditSettlementDays: number;
  rates: CardMachineRate[];
}

export interface CardReceivablePlanItem {
  installment: number;
  totalInstallments: number;
  amount: number;
  /** The acquirer's cut of this receivable. */
  fee: number;
  /** Civil days after the sale. */
  dueInDays: number;
}

export interface CardSale {
  kind: 'DEBIT' | 'CREDIT';
  amount: number;
  installments: number;
  terms: CardMachineTerms;
}

/** Interval between installments of a credit sale received in the flow. */
export const CARD_INSTALLMENT_INTERVAL_DAYS = 30;

/** The highest number of installments the machine has a rate for. */
export function cardMaxInstallments(terms: {
  rates: ReadonlyArray<{ installments: number }>;
}): number {
  return terms.rates.reduce((max, r) => Math.max(max, r.installments), 1);
}

/** Cents first, then the percentage: 699,90 × 3,19% in floats is 22.326810000000002. */
function feeOf(amount: number, feePercentage: number): number {
  const cents = Math.round(roundMoney(amount) * 100);
  return Math.round((cents * (Number(feePercentage) || 0)) / 100) / 100;
}

function creditRate(terms: CardMachineTerms, installments: number): number {
  const rate = terms.rates.find((r) => r.installments === installments);
  if (!rate) {
    throw new Error(`A maquininha não tem taxa cadastrada para ${installments}x`);
  }
  return Number(rate.feePercentage);
}

export function planCardReceivables(sale: CardSale): CardReceivablePlanItem[] {
  const amount = roundMoney(sale.amount);
  const installments = Math.max(Math.trunc(sale.installments) || 1, 1);
  const { terms } = sale;

  if (sale.kind === 'DEBIT') {
    if (installments > 1) {
      throw new Error('Débito não pode ser parcelado');
    }
    return [
      {
        installment: 1,
        totalInstallments: 1,
        amount,
        fee: feeOf(amount, terms.debitFeePercentage),
        dueInDays: terms.debitSettlementDays,
      },
    ];
  }

  const fee = feeOf(amount, creditRate(terms, installments));

  if (terms.creditReceiveMode === 'ANTICIPATED' || installments === 1) {
    return [
      {
        installment: 1,
        totalInstallments: 1,
        amount,
        fee,
        dueInDays: terms.creditSettlementDays,
      },
    ];
  }

  // In the flow the acquirer keeps its share of each installment as it pays it.
  const amounts = splitInstallments(amount, installments);
  const fees = splitInstallments(fee, installments);
  return amounts.map((value, i) => ({
    installment: i + 1,
    totalInstallments: installments,
    amount: value,
    fee: fees[i],
    dueInDays: terms.creditSettlementDays + i * CARD_INSTALLMENT_INTERVAL_DAYS,
  }));
}
