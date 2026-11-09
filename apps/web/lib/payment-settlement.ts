import { roundMoney } from "@erp/validators";

/**
 * Splits what the customer handed over from what is actually charged to the
 * sale.
 *
 * VD-08: the PDV forced the received value back to the order total, so a cash
 * payment of R$ 250,00 for a R$ 199,80 sale showed "Troco: R$ 50,20" and then
 * silently refused to submit — the schema demanded an exact match. Cash may
 * exceed the total; the excess is change, never revenue, and is not sent to the
 * API.
 */
export interface PaymentDraft {
  amount: number;
  /** Only cash can be handed over in excess. */
  isCash: boolean;
}

export interface PaymentSettlement {
  /** Amount of each line to send to the API, in the same order. */
  applied: number[];
  /** Cash handed over beyond the total. */
  change: number;
  /** Still missing to cover the total. */
  missing: number;
  /** True when the payments cover the total exactly, change aside. */
  isSettled: boolean;
}

export function settlePayments(
  payments: PaymentDraft[],
  orderTotal: number
): PaymentSettlement {
  const total = roundMoney(orderTotal);
  const applied = payments.map(() => 0);

  // Non-cash lines are charged in full: a card or boleto is not handed over in
  // excess, and an overshoot there is a data-entry error, not change.
  let remaining = total;
  payments.forEach((payment, index) => {
    if (payment.isCash) {
      return;
    }
    const value = roundMoney(payment.amount);
    applied[index] = value;
    remaining = roundMoney(remaining - value);
  });

  let change = 0;
  payments.forEach((payment, index) => {
    if (!payment.isCash) {
      return;
    }
    const received = roundMoney(payment.amount);
    const charged = roundMoney(Math.max(Math.min(received, remaining), 0));
    applied[index] = charged;
    remaining = roundMoney(remaining - charged);
    change = roundMoney(change + (received - charged));
  });

  return {
    applied,
    change,
    missing: roundMoney(Math.max(remaining, 0)),
    // A negative remainder means non-cash lines overshot the total.
    isSettled: Math.abs(remaining) < 0.01,
  };
}

/**
 * A line the seller added but never gave a method to still carries the amount
 * the form pre-filled, so the totals read "Pagamento completo" for a sale that
 * has no way of being paid. The progress bar must not celebrate it.
 */
export function hasLineWithoutMethod(
  payments: ReadonlyArray<{ paymentMethodId?: string }> | undefined
): boolean {
  return (payments ?? []).some((p) => !p.paymentMethodId);
}
