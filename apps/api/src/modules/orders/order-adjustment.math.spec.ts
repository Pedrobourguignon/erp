import { calculateItemAdjustment } from '@erp/validators';

/**
 * Troca/devolução de item: o cálculo é compartilhado com o front
 * (`@erp/validators`) para o diálogo mostrar exatamente o que a API vai cobrar
 * ou devolver.
 */
describe('calculateItemAdjustment', () => {
  const singleItemOrder = {
    item: { quantity: 2, totalPrice: 200, discount: 0 },
    order: { subtotal: 200, discount: 0 },
  };

  describe('devolução (sem produto novo)', () => {
    it('devolve o valor da linha quando não há desconto', () => {
      const result = calculateItemAdjustment({ ...singleItemOrder, quantity: 1 });

      expect(result.returnedGross).toBe(100);
      expect(result.discountShare).toBe(0);
      expect(result.returnedValue).toBe(100);
      expect(result.difference).toBe(-100);
      expect(result.remainingItem).toEqual({ quantity: 1, totalPrice: 100, discount: 0 });
      expect(result.order).toEqual({ subtotal: 100, discount: 0 });
    });

    it('rateia o desconto do pedido: R$ 20 em R$ 200, item de R$ 100 devolve R$ 90', () => {
      const result = calculateItemAdjustment({
        item: { quantity: 1, totalPrice: 100, discount: 0 },
        quantity: 1,
        order: { subtotal: 200, discount: 20 },
      });

      expect(result.discountShare).toBe(10);
      expect(result.returnedValue).toBe(90);
      expect(result.difference).toBe(-90);
      // O restante do pedido mantém a mesma proporção de desconto.
      expect(result.order).toEqual({ subtotal: 100, discount: 10 });
      expect(result.remainingItem.quantity).toBe(0);
    });

    it('rateia o desconto do próprio item pelas unidades devolvidas', () => {
      // 3 x R$ 50 com R$ 15 de desconto no item = R$ 135.
      const result = calculateItemAdjustment({
        item: { quantity: 3, totalPrice: 135, discount: 15 },
        quantity: 1,
        order: { subtotal: 135, discount: 0 },
      });

      expect(result.returnedGross).toBe(45);
      expect(result.remainingItem).toEqual({ quantity: 2, totalPrice: 90, discount: 10 });
      expect(result.difference).toBe(-45);
    });

    it('fecha os centavos: devolver tudo leva exatamente o desconto que sobrou', () => {
      // R$ 10 de desconto em 3 itens de R$ 33,33 — rateio dá dízima.
      const order = { subtotal: 99.99, discount: 10 };
      const first = calculateItemAdjustment({
        item: { quantity: 1, totalPrice: 33.33, discount: 0 },
        quantity: 1,
        order,
      });
      const second = calculateItemAdjustment({
        item: { quantity: 1, totalPrice: 33.33, discount: 0 },
        quantity: 1,
        order: first.order,
      });
      const third = calculateItemAdjustment({
        item: { quantity: 1, totalPrice: 33.33, discount: 0 },
        quantity: 1,
        order: second.order,
      });

      expect(third.order).toEqual({ subtotal: 0, discount: 0 });
      const refunded =
        first.returnedValue + second.returnedValue + third.returnedValue;
      expect(Math.round(refunded * 100)).toBe(8999);
    });

    it('não devolve mais do que foi pago numa linha de valor zero', () => {
      const result = calculateItemAdjustment({
        item: { quantity: 1, totalPrice: 0, discount: 50 },
        quantity: 1,
        order: { subtotal: 0, discount: 0 },
      });

      expect(result.returnedValue).toBe(0);
      expect(result.difference).toBe(0);
    });
  });

  describe('troca por outro produto', () => {
    it('cobra a diferença quando o novo é mais caro', () => {
      const result = calculateItemAdjustment({
        ...singleItemOrder,
        quantity: 1,
        replacement: { unitPrice: 130 },
      });

      expect(result.newValue).toBe(130);
      expect(result.difference).toBe(30);
      expect(result.order).toEqual({ subtotal: 230, discount: 0 });
    });

    it('devolve a diferença quando o novo é mais barato', () => {
      const result = calculateItemAdjustment({
        ...singleItemOrder,
        quantity: 2,
        replacement: { unitPrice: 80 },
      });

      expect(result.newValue).toBe(160);
      expect(result.difference).toBe(-40);
    });

    it('o desconto rateado acompanha o item novo: preços iguais não geram diferença', () => {
      const result = calculateItemAdjustment({
        item: { quantity: 1, totalPrice: 100, discount: 0 },
        quantity: 1,
        order: { subtotal: 200, discount: 20 },
        replacement: { unitPrice: 100 },
      });

      expect(result.carriedDiscount).toBe(10);
      expect(result.difference).toBe(0);
      expect(result.order).toEqual({ subtotal: 200, discount: 20 });
    });

    it('com desconto, cobra só a diferença de preço de tabela', () => {
      const result = calculateItemAdjustment({
        item: { quantity: 1, totalPrice: 100, discount: 0 },
        quantity: 1,
        order: { subtotal: 200, discount: 20 },
        replacement: { unitPrice: 150 },
      });

      expect(result.difference).toBe(50);
      expect(result.order).toEqual({ subtotal: 250, discount: 20 });
    });

    it('produto novo mais barato que o desconto rateado: devolve no máximo o que foi pago', () => {
      const result = calculateItemAdjustment({
        item: { quantity: 1, totalPrice: 100, discount: 0 },
        quantity: 1,
        order: { subtotal: 100, discount: 50 },
        replacement: { unitPrice: 30 },
      });

      // Pagou R$ 50 pelo item; leva um de R$ 30 que absorve R$ 30 do desconto.
      expect(result.carriedDiscount).toBe(30);
      expect(result.newNetValue).toBe(0);
      expect(result.difference).toBe(-50);
      expect(result.order).toEqual({ subtotal: 30, discount: 30 });
    });

    it('mantém a identidade: total depois = total antes + diferença', () => {
      const before = { subtotal: 347.9, discount: 33.33 };
      const result = calculateItemAdjustment({
        item: { quantity: 3, totalPrice: 149.7, discount: 0 },
        quantity: 2,
        order: before,
        replacement: { unitPrice: 79.9 },
      });

      const totalBefore = Math.round((before.subtotal - before.discount) * 100);
      const totalAfter = Math.round(
        (result.order.subtotal - result.order.discount) * 100,
      );
      expect(totalAfter - totalBefore).toBe(Math.round(result.difference * 100));
    });
  });

  describe('troca de tamanho (keepPrice)', () => {
    it('mantém o valor pago pela linha: diferença zero mesmo com descontos', () => {
      // 3 x R$ 50 com R$ 15 de desconto no item; pedido com R$ 13,50 de desconto.
      const result = calculateItemAdjustment({
        item: { quantity: 3, totalPrice: 135, discount: 15 },
        quantity: 1,
        order: { subtotal: 135, discount: 13.5 },
        replacement: { keepPrice: true },
      });

      expect(result.newValue).toBe(45);
      expect(result.newItemDiscount).toBe(5);
      expect(result.difference).toBe(0);
      expect(result.order).toEqual({ subtotal: 135, discount: 13.5 });
    });
  });

  it.each([0, -1, 3, 1.5])('recusa quantidade inválida (%p)', (quantity) => {
    expect(() =>
      calculateItemAdjustment({ ...singleItemOrder, quantity }),
    ).toThrow(RangeError);
  });
});
