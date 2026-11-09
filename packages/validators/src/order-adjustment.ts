/**
 * Troca e devolução de um item de pedido já vendido.
 *
 * Fica aqui, ao lado de `order-money`, porque o diálogo de troca mostra a
 * diferença antes de confirmar: se o front fizesse a própria conta, os dois
 * números iam divergir no primeiro desconto rateado (mesma lição do VD-10).
 *
 * Toda a aritmética é feita em centavos inteiros.
 *
 * Regras:
 * - As unidades que saem levam a parte proporcional do total da linha (o
 *   desconto do item já está dentro dele) e a parte proporcional do desconto
 *   do pedido. O cliente recebe de volta o que efetivamente pagou.
 * - Numa troca, o desconto rateado acompanha o produto novo até o valor dele:
 *   trocar por um item do mesmo preço não gera diferença, mesmo com desconto.
 * - Devolver o que sobrou do pedido leva exatamente o desconto restante, para
 *   que os centavos do rateio fechem em zero.
 */

export interface ItemAdjustmentInput {
  /** Linha como está hoje no pedido. `totalPrice` já descontado. */
  item: { quantity: number; totalPrice: number; discount: number };
  /** Unidades que o cliente está devolvendo. */
  quantity: number;
  /** Valores atuais do pedido. */
  order: { subtotal: number; discount: number };
  /**
   * Produto que entra no lugar. Ausente = devolução sem troca.
   * `keepPrice`: troca de tamanho/cor do mesmo produto — o novo item herda
   * exatamente o valor pago pelas unidades devolvidas, sem diferença.
   */
  replacement?: { unitPrice: number } | { keepPrice: true } | null;
}

export interface ItemAdjustmentResult {
  /** Valor da linha correspondente às unidades devolvidas. */
  returnedGross: number;
  /** Parte do desconto do pedido que pertencia a essas unidades. */
  discountShare: number;
  /** O que o cliente pagou por elas: `returnedGross − discountShare`. */
  returnedValue: number;
  /** Desconto do próprio item correspondente às unidades devolvidas. */
  returnedItemDiscount: number;
  /** Valor da linha nova: preço × quantidade, ou o valor devolvido no keepPrice. */
  newValue: number;
  /** Desconto de item da linha nova (só no keepPrice, herdado da original). */
  newItemDiscount: number;
  /** Desconto que o produto novo herda (até o valor dele). */
  carriedDiscount: number;
  /** O que o cliente passa a pagar pelo produto novo. */
  newNetValue: number;
  /** > 0: cliente paga. < 0: loja devolve. */
  difference: number;
  /** A linha original depois da saída das unidades (quantity 0 = sai do pedido). */
  remainingItem: { quantity: number; totalPrice: number; discount: number };
  /** Subtotal e desconto do pedido depois do ajuste. */
  order: { subtotal: number; discount: number };
}

const toCents = (value: number): number => Math.round((Number(value) || 0) * 100);
const fromCents = (cents: number): number => cents / 100;

function proportional(totalCents: number, part: number, whole: number): number {
  if (whole <= 0 || part >= whole) return totalCents;
  return Math.round((totalCents * part) / whole);
}

export function calculateItemAdjustment(input: ItemAdjustmentInput): ItemAdjustmentResult {
  const { item, quantity, order, replacement } = input;

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > item.quantity) {
    throw new RangeError(
      `Quantidade inválida: informe de 1 a ${item.quantity} unidade(s).`,
    );
  }

  const lineTotal = toCents(item.totalPrice);
  const lineDiscount = toCents(item.discount);
  const subtotal = toCents(order.subtotal);
  const orderDiscount = Math.min(toCents(order.discount), subtotal);

  const returnedGross = proportional(lineTotal, quantity, item.quantity);
  const returnedItemDiscount = proportional(lineDiscount, quantity, item.quantity);

  const discountShare =
    returnedGross >= subtotal
      ? orderDiscount
      : Math.min(proportional(orderDiscount, returnedGross, subtotal), orderDiscount);
  const returnedValue = returnedGross - discountShare;

  const keepPrice = !!replacement && 'keepPrice' in replacement;
  const newValue = !replacement
    ? 0
    : 'keepPrice' in replacement
      ? returnedGross
      : toCents(replacement.unitPrice) * quantity;
  const newItemDiscount = keepPrice ? returnedItemDiscount : 0;
  const carriedDiscount = Math.min(discountShare, newValue);
  const newNetValue = newValue - carriedDiscount;

  return {
    returnedGross: fromCents(returnedGross),
    discountShare: fromCents(discountShare),
    returnedValue: fromCents(returnedValue),
    returnedItemDiscount: fromCents(returnedItemDiscount),
    newValue: fromCents(newValue),
    newItemDiscount: fromCents(newItemDiscount),
    carriedDiscount: fromCents(carriedDiscount),
    newNetValue: fromCents(newNetValue),
    difference: fromCents(newNetValue - returnedValue),
    remainingItem: {
      quantity: item.quantity - quantity,
      totalPrice: fromCents(lineTotal - returnedGross),
      discount: fromCents(lineDiscount - returnedItemDiscount),
    },
    order: {
      subtotal: fromCents(subtotal - returnedGross + newValue),
      discount: fromCents(orderDiscount - discountShare + carriedDiscount),
    },
  };
}
