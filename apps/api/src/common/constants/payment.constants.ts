import { PaymentMethodType } from '@prisma/client';

/**
 * Payment types whose money lands in the bank account at the moment of the sale.
 * Everything else (boleto, credit card, check…) settles later, through the
 * receivable — so the account is only resolved and credited at settlement.
 */
export const IMMEDIATE_PAYMENT_TYPES: readonly PaymentMethodType[] = [
  'CASH',
  'PIX',
  'DEBIT_CARD',
];

export function isImmediatePayment(type: PaymentMethodType | string): boolean {
  return (IMMEDIATE_PAYMENT_TYPES as readonly string[]).includes(type);
}

/**
 * Whether the money is already in the account when the sale is rung.
 *
 * The type alone is not enough: a debit card is "immediate" by nature, but the
 * method can say the acquirer pays D+1 — and then the account must not be
 * credited, nor the receivable closed, at the sale. It settles on its day,
 * through the financial-settlements endpoint, like any other term payment.
 */
export function settlesAtSale(
  type: PaymentMethodType | string,
  settlementDays?: number | null,
): boolean {
  return isImmediatePayment(type) && !(settlementDays && settlementDays > 0);
}

/**
 * Same question for a method that may be linked to a card machine: the
 * machine's terms win over whatever is left on the method. Only a debit on the
 * spot (D+0) settles at the sale; a credit sale always settles through its
 * receivables, even when it is anticipated.
 */
export function methodSettlesAtSale(method: {
  type: PaymentMethodType | string;
  settlementDays?: number | null;
  cardMachine?: { debitSettlementDays: number } | null;
}): boolean {
  if (method.cardMachine && isCardMethod(method.type)) {
    return method.type === 'DEBIT_CARD' && method.cardMachine.debitSettlementDays === 0;
  }
  return settlesAtSale(method.type, method.settlementDays);
}

export function isCardMethod(type: PaymentMethodType | string): boolean {
  return type === 'CREDIT_CARD' || type === 'DEBIT_CARD';
}

/** Marks an AccountsPayable as the acquirer fee of a sale payment. */
export const PAYMENT_FEE_KIND = 'PAYMENT_FEE';
