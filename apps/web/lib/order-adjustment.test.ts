import { describe, it, expect } from 'vitest';

import {
  adjustmentSuccessMessage,
  buildAdjustItemSchema,
  previewAdjustment,
  settlementOptions,
  toAdjustmentRequest,
  type AdjustItemValues,
} from './order-adjustment';

const item = { id: 'i1', quantity: 2, unitPrice: 100, discount: 0, totalPrice: 200 };
const order = { subtotal: 200, discount: 0, receivables: [] };

const base: AdjustItemValues = {
  mode: 'return',
  quantity: 1,
  productId: '',
  variantId: '',
  reason: 'Defeito',
  settleNow: false,
  paymentMethodId: '',
  cashRegisterSessionId: '',
};

describe('previewAdjustment', () => {
  it('devolução: loja devolve o valor da linha', () => {
    const preview = previewAdjustment({ order, item, quantity: 1, mode: 'return' });

    expect(preview).toMatchObject({ difference: -100, abated: 0, refund: 100, charge: 0 });
  });

  it('troca de tamanho: sem diferença, mesmo que o preço de tabela tenha mudado', () => {
    const preview = previewAdjustment({
      order,
      item,
      quantity: 1,
      mode: 'size',
      newUnitPrice: 150,
    });

    expect(preview?.difference).toBe(0);
  });

  it('troca por produto mais caro: cliente paga a diferença', () => {
    const preview = previewAdjustment({
      order,
      item,
      quantity: 1,
      mode: 'product',
      newUnitPrice: 130,
    });

    expect(preview).toMatchObject({ difference: 30, charge: 30, refund: 0 });
  });

  it('troca por produto sem preço escolhido ainda: sem prévia', () => {
    expect(previewAdjustment({ order, item, quantity: 1, mode: 'product' })).toBeNull();
  });

  it('abate primeiro o que o cliente ainda deve, igual à API', () => {
    const preview = previewAdjustment({
      order: {
        ...order,
        receivables: [
          { amount: 200, paidAmount: 50, status: 'PARTIALLY_PAID' },
          { amount: 99, paidAmount: 99, status: 'PAID' },
          { amount: 10, paidAmount: 0, status: 'CANCELLED' },
        ],
      },
      item,
      quantity: 2,
      mode: 'return',
    });

    expect(preview).toMatchObject({ difference: -200, abated: 150, refund: 50 });
  });

  it('quantidade fora do intervalo não quebra a tela: sem prévia', () => {
    expect(previewAdjustment({ order, item, quantity: 5, mode: 'return' })).toBeNull();
  });
});

describe('buildAdjustItemSchema', () => {
  const schema = buildAdjustItemSchema({ maxQuantity: 2, sessionRequiredFor: () => false });

  it('aceita uma devolução completa', () => {
    expect(schema.safeParse(base).success).toBe(true);
  });

  it('exige motivo na devolução', () => {
    const result = schema.safeParse({ ...base, reason: '  ' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ['reason'] });
  });

  it('recusa quantidade acima da vendida, com a mensagem em pt-BR', () => {
    const result = schema.safeParse({ ...base, quantity: 3 });
    expect(result.error?.issues[0].message).toMatch(/no máximo 2/);
  });

  it('exige o produto na troca por outro produto', () => {
    const result = schema.safeParse({ ...base, mode: 'product', reason: '' });
    expect(result.error?.issues[0]).toMatchObject({ path: ['productId'] });
  });

  it('exige a variante na troca de tamanho', () => {
    const result = schema.safeParse({ ...base, mode: 'size', reason: '' });
    expect(result.error?.issues[0]).toMatchObject({ path: ['variantId'] });
  });

  it('acertar agora exige a forma de pagamento', () => {
    const result = schema.safeParse({ ...base, settleNow: true });
    expect(result.error?.issues[0]).toMatchObject({ path: ['paymentMethodId'] });
  });

  it('sem dinheiro a movimentar, "acertar agora" marcado não bloqueia o envio', () => {
    // Troca de tamanho ou devolução toda abatida: a seção de pagamento nem
    // aparece, então exigir a forma travava o botão sem mensagem visível.
    const nothingMoves = buildAdjustItemSchema({
      maxQuantity: 2,
      sessionRequiredFor: () => true,
      settlementApplies: () => false,
    });
    const result = nothingMoves.safeParse({ ...base, mode: 'size', variantId: 'v-g', settleNow: true });
    expect(result.success).toBe(true);
  });

  it('dinheiro com vários caixas abertos exige escolher o caixa', () => {
    const strict = buildAdjustItemSchema({
      maxQuantity: 2,
      sessionRequiredFor: (id) => id === 'pm-cash',
    });
    const result = strict.safeParse({ ...base, settleNow: true, paymentMethodId: 'pm-cash' });
    expect(result.error?.issues[0]).toMatchObject({ path: ['cashRegisterSessionId'] });
  });
});

describe('toAdjustmentRequest', () => {
  it('troca de tamanho envia o mesmo produto com a variante nova', () => {
    const request = toAdjustmentRequest(
      { ...base, mode: 'size', variantId: 'v-g', reason: '' },
      { orderId: 'o1', item: { ...item, productId: 'p1' }, hasDifference: false },
    );

    expect(request).toEqual({
      kind: 'exchange',
      payload: { id: 'o1', orderItemId: 'i1', quantity: 1, newProductId: 'p1', newVariantId: 'v-g' },
    });
  });

  it('só envia a baixa quando há diferença e o operador pediu', () => {
    const values = { ...base, settleNow: true, paymentMethodId: 'pm-pix' };
    const ctx = { orderId: 'o1', item: { ...item, productId: 'p1' } };

    expect(toAdjustmentRequest(values, { ...ctx, hasDifference: true }).payload).toMatchObject({
      settlement: { paymentMethodId: 'pm-pix' },
    });
    expect(
      toAdjustmentRequest(values, { ...ctx, hasDifference: false }).payload,
    ).not.toHaveProperty('settlement');
  });
});

describe('adjustmentSuccessMessage', () => {
  const result = { type: 'EXCHANGE' as const, difference: 0, refundAmount: 0, abatedAmount: 0, settled: false };

  it.each([
    [{ ...result }, 'Troca registrada. Sem diferença de valor.'],
    [{ ...result, difference: 30, settled: true }, 'Troca registrada. Recebido R$ 30,00 do cliente.'],
    [{ ...result, difference: 30 }, 'Troca registrada. R$ 30,00 a receber ficou em aberto no financeiro.'],
    [
      { ...result, type: 'RETURN' as const, difference: -90, refundAmount: 90, settled: true },
      'Devolução registrada. Devolvido R$ 90,00 ao cliente.',
    ],
    [
      { ...result, type: 'RETURN' as const, difference: -90, refundAmount: 90 },
      'Devolução registrada. Reembolso de R$ 90,00 ficou em aberto no financeiro.',
    ],
    [
      { ...result, type: 'RETURN' as const, difference: -90, abatedAmount: 90 },
      'Devolução registrada. R$ 90,00 abatidos do que o cliente devia.',
    ],
  ])('%#', (input, expected) => {
    expect(adjustmentSuccessMessage(input).replace(/ /g, ' ')).toBe(expected);
  });
});

describe('settlementOptions', () => {
  const methods = [
    { id: 'pm-cash', type: 'CASH' },
    { id: 'pm-pix', type: 'PIX' },
    { id: 'pm-store', type: 'STORE_CREDIT' },
    { id: 'pm-off', type: 'PIX', isActive: false },
  ];

  it('esconde crédito na loja e formas inativas', () => {
    const { methods: offered } = settlementOptions({ methods, openSessions: [] });
    expect(offered.map((m) => m.id)).toEqual(['pm-cash', 'pm-pix']);
  });

  it('pede o caixa só para dinheiro, com vários abertos e o da venda fechado', () => {
    const two = [{ id: 's1' }, { id: 's2' }];
    expect(settlementOptions({ methods, openSessions: two }).sessionRequiredFor('pm-cash')).toBe(true);
    expect(settlementOptions({ methods, openSessions: two }).sessionRequiredFor('pm-pix')).toBe(false);
    expect(
      settlementOptions({ methods, openSessions: two, orderSessionId: 's2' }).sessionRequiredFor('pm-cash'),
    ).toBe(false);
    expect(
      settlementOptions({ methods, openSessions: [{ id: 's1' }] }).sessionRequiredFor('pm-cash'),
    ).toBe(false);
  });
});
