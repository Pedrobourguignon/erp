import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdjustOrderItemUseCase } from './adjust-order-item.use-case';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { FinancialSettlementsService } from '../../financial/financial-settlements.service';
import { OrderAdjustmentFinance } from './order-adjustment.finance';

const TENANT_A = 'tenant-aaa-111';
const ORDER_ID = 'order-1';
const USER_ID = 'user-1';

function createMockTx() {
  return {
    inventoryItem: {
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue({ id: 'inv-old' }),
      create: jest.fn().mockResolvedValue({}),
    },
    inventoryMovement: { create: jest.fn().mockResolvedValue({}) },
    orderItem: {
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: 'item-new' }),
    },
    order: { update: jest.fn().mockResolvedValue({}) },
    orderAdjustment: {
      create: jest.fn().mockResolvedValue({ id: 'adj-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    accountsReceivable: {
      create: jest.fn().mockResolvedValue({ id: 'ar-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    accountsPayable: { create: jest.fn().mockResolvedValue({ id: 'ap-1' }) },
    orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  };
}

type MockTx = ReturnType<typeof createMockTx>;

function createMockPrisma(tx: MockTx) {
  return {
    order: { findFirst: jest.fn() },
    product: { findFirst: jest.fn() },
    productVariant: { findFirst: jest.fn() },
    warehouse: { findFirst: jest.fn().mockResolvedValue({ id: 'wh-1' }) },
    inventoryItem: {
      findFirst: jest.fn().mockResolvedValue({ id: 'inv-new', warehouseId: 'wh-1' }),
    },
    paymentMethod: { findFirst: jest.fn() },
    cashRegisterSession: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((cb: (t: MockTx) => Promise<unknown>) => cb(tx)),
  };
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    productId: 'prod-old',
    variantId: 'var-m',
    sku: 'CAM-M',
    name: 'Camiseta M',
    quantity: 2,
    unitPrice: 100,
    discount: 0,
    totalPrice: 200,
    ncm: null,
    cfop: null,
    ...overrides,
  };
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    tenantId: TENANT_A,
    orderNumber: 'PED-000001',
    status: 'COMPLETED',
    origin: 'BALCAO',
    customerId: 'cust-1',
    cashRegisterSessionId: 'sess-1',
    discount: 0,
    shippingCost: 0,
    items: [makeItem()],
    ...overrides,
  };
}

describe('AdjustOrderItemUseCase', () => {
  let useCase: AdjustOrderItemUseCase;
  let prisma: ReturnType<typeof createMockPrisma>;
  let tx: MockTx;
  let settlements: { settleWithin: jest.Mock };

  beforeEach(async () => {
    tx = createMockTx();
    prisma = createMockPrisma(tx);
    settlements = {
      settleWithin: jest.fn().mockResolvedValue({ status: 'PAID', accountId: 'acc-drawer' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdjustOrderItemUseCase,
        OrderAdjustmentFinance,
        { provide: PrismaService, useValue: prisma },
        { provide: FinancialSettlementsService, useValue: settlements },
      ],
    }).compile();

    useCase = module.get(AdjustOrderItemUseCase);
  });

  afterEach(() => jest.clearAllMocks());

  function primeProduct(salePrice: number, productId = 'prod-new') {
    prisma.product.findFirst.mockResolvedValue({
      id: productId,
      sku: 'SKU-NEW',
      name: 'Produto Novo',
      salePrice,
      ncm: null,
    });
  }

  describe('quando a troca é permitida', () => {
    it('busca o pedido sempre escopado pelo tenant', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(
        useCase.execute(TENANT_A, ORDER_ID, USER_ID, { orderItemId: 'item-1', reason: 'x' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.order.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: ORDER_ID, tenantId: TENANT_A }),
        }),
      );
    });

    it.each(['PENDING', 'CONFIRMED', 'SHIPPED', 'CANCELLED', 'RETURNED'])(
      'recusa pedido %s',
      async (status) => {
        prisma.order.findFirst.mockResolvedValue(makeOrder({ status }));

        await expect(
          useCase.execute(TENANT_A, ORDER_ID, USER_ID, { orderItemId: 'item-1', reason: 'x' }),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it.each(['COMPLETED', 'DELIVERED'])('aceita pedido %s', async (status) => {
      prisma.order.findFirst.mockResolvedValue(makeOrder({ status }));

      await useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
        orderItemId: 'item-1',
        quantity: 1,
        reason: 'Não serviu',
      });

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('recusa quantidade maior que a do item', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());

      await expect(
        useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
          orderItemId: 'item-1',
          quantity: 3,
          reason: 'x',
        }),
      ).rejects.toThrow('de 1 a 2');
    });

    it('recusa item que não é do pedido', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());

      await expect(
        useCase.execute(TENANT_A, ORDER_ID, USER_ID, { orderItemId: 'outro', reason: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('troca por outro produto', () => {
    const exchange = {
      orderItemId: 'item-1',
      quantity: 1,
      replacement: { productId: 'prod-new' },
    };

    it('troca parcial: reduz a linha original e cria uma nova, sem perder unidades', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      primeProduct(130);

      await useCase.execute(TENANT_A, ORDER_ID, USER_ID, exchange);

      expect(tx.orderItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { quantity: 1, totalPrice: 100, discount: 0 },
      });
      expect(tx.orderItem.delete).not.toHaveBeenCalled();
      expect(tx.orderItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: ORDER_ID,
          productId: 'prod-new',
          quantity: 1,
          unitPrice: 130,
          totalPrice: 130,
        }),
        select: { id: true },
      });
    });

    it('baixa o novo e devolve o antigo ao estoque', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      primeProduct(130);

      await useCase.execute(TENANT_A, ORDER_ID, USER_ID, exchange);

      const movements = tx.inventoryMovement.create.mock.calls.map((c) => [
        c[0].data.type,
        c[0].data.productId,
        c[0].data.quantity,
      ]);
      expect(movements).toEqual([
        ['EXIT', 'prod-new', 1],
        ['RETURN', 'prod-old', 1],
      ]);
    });

    it('recusa quando o produto novo não tem estoque', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      primeProduct(130);
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(useCase.execute(TENANT_A, ORDER_ID, USER_ID, exchange)).rejects.toThrow(
        'Estoque insuficiente',
      );
    });

    it('diferença positiva vira título a receber vinculado ao pedido', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      primeProduct(130);

      const result = await useCase.execute(TENANT_A, ORDER_ID, USER_ID, exchange);

      expect(result.difference).toBe(30);
      expect(tx.accountsReceivable.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_A,
            orderId: ORDER_ID,
            customerId: 'cust-1',
            amount: 30,
            status: 'PENDING',
          }),
        }),
      );
      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 230, discount: 0, totalAmount: 230 }),
        }),
      );
    });

    it('registra o ajuste com o que saiu e o que entrou', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      primeProduct(130);

      await useCase.execute(TENANT_A, ORDER_ID, USER_ID, exchange);

      expect(tx.orderAdjustment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_A,
          orderId: ORDER_ID,
          type: 'EXCHANGE',
          quantity: 1,
          orderItemId: 'item-1',
          returnedProductId: 'prod-old',
          returnedValue: 100,
          newProductId: 'prod-new',
          newValue: 130,
          difference: 30,
          createdById: USER_ID,
        }),
        select: { id: true },
      });
    });
  });

  describe('troca de tamanho (mesmo produto, outra variante)', () => {
    it('mantém o preço pago e não gera título', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      // Preço de tabela mudou desde a venda — não importa numa troca de tamanho.
      primeProduct(150, 'prod-old');
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'var-g',
        sku: 'CAM-G',
        name: 'Camiseta G',
        salePrice: 160,
      });

      const result = await useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
        orderItemId: 'item-1',
        quantity: 1,
        replacement: { productId: 'prod-old', variantId: 'var-g' },
      });

      expect(result.difference).toBe(0);
      expect(tx.orderItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          variantId: 'var-g',
          sku: 'CAM-G',
          unitPrice: 100,
          totalPrice: 100,
        }),
        select: { id: true },
      });
      expect(tx.accountsReceivable.create).not.toHaveBeenCalled();
      expect(tx.accountsPayable.create).not.toHaveBeenCalled();
    });

    it('recusa trocar pela mesma variante', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      primeProduct(100, 'prod-old');
      prisma.productVariant.findFirst.mockResolvedValue({
        id: 'var-m',
        sku: 'CAM-M',
        name: 'Camiseta M',
        salePrice: null,
      });

      await expect(
        useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
          orderItemId: 'item-1',
          replacement: { productId: 'prod-old', variantId: 'var-m' },
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('devolução sem troca', () => {
    it('devolve o valor proporcional ao desconto do pedido', async () => {
      prisma.order.findFirst.mockResolvedValue(
        makeOrder({
          discount: 20,
          items: [
            makeItem({ quantity: 1, totalPrice: 100 }),
            makeItem({ id: 'item-2', productId: 'prod-2', quantity: 1, totalPrice: 100 }),
          ],
        }),
      );

      const result = await useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
        orderItemId: 'item-1',
        reason: 'Defeito',
      });

      expect(result.difference).toBe(-90);
      expect(tx.orderItem.delete).toHaveBeenCalledWith({ where: { id: 'item-1' } });
      expect(tx.accountsPayable.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 90 }) }),
      );
      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ subtotal: 100, discount: 10, totalAmount: 90 }),
        }),
      );
    });

    it('abate primeiro o que o cliente ainda deve; só o excedente vira reembolso', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder({ status: 'DELIVERED' }));
      // Boleto de R$ 200 com R$ 50 já pagos.
      tx.accountsReceivable.findMany.mockResolvedValue([
        { id: 'ar-boleto', amount: 200, paidAmount: 50, status: 'PARTIALLY_PAID' },
      ]);

      const result = await useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
        orderItemId: 'item-1',
        quantity: 2,
        reason: 'Desistiu',
      });

      // Deve 150; devolveu 200 → abate 150 e reembolsa os 50 pagos.
      expect(tx.accountsReceivable.update).toHaveBeenCalledWith({
        where: { id: 'ar-boleto' },
        data: { amount: 50, status: 'PAID', paidAt: expect.any(Date) },
      });
      expect(tx.accountsPayable.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 50 }) }),
      );
      expect(result.abatedAmount).toBe(150);
      expect(result.refundAmount).toBe(50);
    });

    it('título sem nada pago e totalmente abatido é cancelado', async () => {
      prisma.order.findFirst.mockResolvedValue(
        makeOrder({
          status: 'DELIVERED',
          items: [
            makeItem({ quantity: 1, totalPrice: 100 }),
            makeItem({ id: 'item-2', productId: 'prod-2', quantity: 1, totalPrice: 100 }),
          ],
        }),
      );
      tx.accountsReceivable.findMany.mockResolvedValue([
        { id: 'ar-2', amount: 100, paidAmount: 0, status: 'PENDING' },
        { id: 'ar-1', amount: 100, paidAmount: 0, status: 'PENDING' },
      ]);

      const result = await useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
        orderItemId: 'item-1',
        reason: 'x',
      });

      expect(tx.accountsReceivable.update).toHaveBeenCalledTimes(1);
      expect(tx.accountsReceivable.update).toHaveBeenCalledWith({
        where: { id: 'ar-2' },
        data: { status: 'CANCELLED' },
      });
      expect(tx.accountsPayable.create).not.toHaveBeenCalled();
      expect(result.refundAmount).toBe(0);
    });

    it('devolver o último item marca o pedido como devolvido', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());

      await useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
        orderItemId: 'item-1',
        reason: 'Desistiu',
      });

      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RETURNED', totalAmount: 0 }),
        }),
      );
      expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ fromStatus: 'COMPLETED', toStatus: 'RETURNED' }),
      });
    });
  });

  describe('baixa no ato', () => {
    function primeCash() {
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-cash',
        name: 'Dinheiro',
        type: 'CASH',
        settlementDays: 0,
        defaultAccountId: 'acc-bank',
      });
    }

    it('dinheiro sai da gaveta do caixa da venda, na mesma transação', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      primeCash();
      prisma.cashRegisterSession.findFirst.mockResolvedValue({
        id: 'sess-1',
        cashRegister: { financialAccountId: 'acc-drawer' },
      });

      const result = await useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
        orderItemId: 'item-1',
        quantity: 1,
        reason: 'x',
        settlement: { paymentMethodId: 'pm-cash' },
      });

      expect(settlements.settleWithin).toHaveBeenCalledWith(
        tx,
        TENANT_A,
        'ap-1',
        { kind: 'PAYABLE', accountId: 'acc-drawer' },
        USER_ID,
      );
      expect(result.settled).toBe(true);
    });

    it('caixa da venda fechado e um único caixa aberto: usa o aberto', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      primeCash();
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);
      prisma.cashRegisterSession.findMany.mockResolvedValue([
        { id: 'sess-2', cashRegister: { financialAccountId: 'acc-drawer-2' } },
      ]);

      await useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
        orderItemId: 'item-1',
        quantity: 1,
        reason: 'x',
        settlement: { paymentMethodId: 'pm-cash' },
      });

      expect(settlements.settleWithin).toHaveBeenCalledWith(
        tx,
        TENANT_A,
        'ap-1',
        { kind: 'PAYABLE', accountId: 'acc-drawer-2' },
        USER_ID,
      );
    });

    it('recusa dinheiro sem caixa aberto, antes de mexer em qualquer coisa', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      primeCash();
      prisma.cashRegisterSession.findFirst.mockResolvedValue(null);
      prisma.cashRegisterSession.findMany.mockResolvedValue([]);

      await expect(
        useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
          orderItemId: 'item-1',
          quantity: 1,
          reason: 'x',
          settlement: { paymentMethodId: 'pm-cash' },
        }),
      ).rejects.toThrow('caixa aberto');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('PIX liquida na conta da forma de pagamento', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      primeProduct(130);
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-pix',
        name: 'PIX',
        type: 'PIX',
        settlementDays: 0,
        defaultAccountId: 'acc-bank',
      });

      await useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
        orderItemId: 'item-1',
        quantity: 1,
        replacement: { productId: 'prod-new' },
        settlement: { paymentMethodId: 'pm-pix' },
      });

      expect(settlements.settleWithin).toHaveBeenCalledWith(
        tx,
        TENANT_A,
        'ar-1',
        { kind: 'RECEIVABLE', accountId: 'acc-bank' },
        USER_ID,
      );
    });

    it('cartão de crédito deixa o título em aberto, vinculado à forma', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      primeProduct(130);
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-cc',
        name: 'Crédito',
        type: 'CREDIT_CARD',
        settlementDays: 30,
        defaultAccountId: 'acc-bank',
      });

      const result = await useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
        orderItemId: 'item-1',
        quantity: 1,
        replacement: { productId: 'prod-new' },
        settlement: { paymentMethodId: 'pm-cc' },
      });

      expect(settlements.settleWithin).not.toHaveBeenCalled();
      expect(tx.accountsReceivable.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentMethodId: 'pm-cc', status: 'PENDING' }),
        }),
      );
      expect(result.settled).toBe(false);
    });

    it('recusa forma de pagamento de outro tenant', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder());
      prisma.paymentMethod.findFirst.mockResolvedValue(null);

      await expect(
        useCase.execute(TENANT_A, ORDER_ID, USER_ID, {
          orderItemId: 'item-1',
          reason: 'x',
          settlement: { paymentMethodId: 'pm-de-outro' },
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.paymentMethod.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'pm-de-outro', tenantId: TENANT_A }),
        }),
      );
    });
  });
});
