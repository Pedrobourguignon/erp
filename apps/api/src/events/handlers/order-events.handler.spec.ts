import { Test, TestingModule } from '@nestjs/testing';
import { OrderEventsHandler } from './order-events.handler';
import { PrismaService } from '../../database/prisma/prisma.service';
import { InventoryService } from '../../modules/inventory/inventory.service';
import {
  OrderCreatedEvent,
  OrderConfirmedEvent,
  OrderShippedEvent,
  OrderCancelledEvent,
  OrderCounterSaleEvent,
} from '../event-types';

// ─── Mock Factories ──────────────────────────────────────────────────────────

function createMockPrisma() {
  const tx = {
    financialAccount: {
      update: jest.fn().mockResolvedValue({ balance: 0 }),
    },
    financialTransaction: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
  return {
    order: {
      findUnique: jest.fn(),
    },
    orderPayment: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    financialTransaction: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    accountsReceivable: {
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    accountsPayable: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    notification: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    _tx: tx,
  };
}

function createMockInventoryService() {
  return {
    reserveStock: jest.fn().mockResolvedValue(undefined),
    releaseStock: jest.fn().mockResolvedValue(undefined),
    fulfillReservedStock: jest.fn().mockResolvedValue(undefined),
    deductStockForSale: jest.fn().mockResolvedValue(undefined),
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-001';
const USER_ID = 'user-uuid-001';
const ORDER_ID = 'order-uuid-001';

const ITEMS = [
  { productId: 'prod-001', variantId: null, quantity: 2, unitPrice: 100, totalPrice: 200 },
  { productId: 'prod-002', variantId: 'var-001', quantity: 1, unitPrice: 50, totalPrice: 50 },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OrderEventsHandler', () => {
  let handler: OrderEventsHandler;
  let prisma: ReturnType<typeof createMockPrisma>;
  let inventoryService: ReturnType<typeof createMockInventoryService>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    inventoryService = createMockInventoryService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderEventsHandler,
        { provide: PrismaService, useValue: prisma },
        { provide: InventoryService, useValue: inventoryService },
      ],
    }).compile();

    handler = module.get<OrderEventsHandler>(OrderEventsHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── handleOrderCreated ───────────────────────────────────────────────
  describe('handleOrderCreated', () => {
    it('should create a notification', async () => {
      prisma.notification.create.mockResolvedValue({});

      const event = new OrderCreatedEvent(ORDER_ID, TENANT_ID, USER_ID, ITEMS);
      await handler.handleOrderCreated(event);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          userId: USER_ID,
          type: 'IN_APP',
          title: 'New order created',
          message: expect.stringContaining(ORDER_ID),
        }),
      });
    });

    it('should NOT reserve stock (stock is reserved on confirmation)', async () => {
      prisma.notification.create.mockResolvedValue({});

      const event = new OrderCreatedEvent(ORDER_ID, TENANT_ID, USER_ID, ITEMS);
      await handler.handleOrderCreated(event);

      expect(inventoryService.reserveStock).not.toHaveBeenCalled();
    });

    it('should not throw when notification creation fails', async () => {
      prisma.notification.create.mockRejectedValue(new Error('DB error'));

      const event = new OrderCreatedEvent(ORDER_ID, TENANT_ID, USER_ID, ITEMS);

      await expect(handler.handleOrderCreated(event)).resolves.toBeUndefined();
    });

    // ─── SCRUM-31: an order-based sale credits the account at creation ────
    describe('order-based sale (origin MANUAL) — account credit', () => {
      const cashPayment = {
        id: 'op-manual-1',
        amount: 250,
        installments: 1,
        financialAccountId: 'acc-1',
        paymentMethodId: 'pm-1',
        paymentMethod: { name: 'Dinheiro', type: 'CASH', defaultAccountId: null },
      };

      beforeEach(() => {
        prisma.notification.create.mockResolvedValue({});
        prisma.order.findUnique.mockResolvedValue({
          id: ORDER_ID,
          tenantId: TENANT_ID,
          orderNumber: 'PED-000001',
          origin: 'MANUAL',
        });
      });

      it('should credit the linked account for an immediate payment', async () => {
        prisma.orderPayment.findMany.mockResolvedValue([cashPayment]);
        prisma._tx.financialAccount.update.mockResolvedValue({ balance: 250 });

        await handler.handleOrderCreated(
          new OrderCreatedEvent(ORDER_ID, TENANT_ID, USER_ID, ITEMS),
        );

        expect(prisma._tx.financialAccount.update).toHaveBeenCalledWith({
          where: { id: 'acc-1' },
          data: { balance: { increment: 250 } },
          select: { balance: true },
        });
        const txArgs = prisma._tx.financialTransaction.create.mock.calls[0][0];
        expect(txArgs.data).toEqual(
          expect.objectContaining({
            accountId: 'acc-1',
            type: 'CREDIT',
            amount: 250,
            balanceAfter: 250,
            referenceType: 'order',
            referenceId: ORDER_ID,
            metadata: { orderPaymentId: 'op-manual-1' },
          }),
        );
      });

      it('should NOT credit twice when the event is replayed (idempotent)', async () => {
        prisma.orderPayment.findMany.mockResolvedValue([cashPayment]);
        // A transaction already exists for this order payment
        prisma.financialTransaction.findFirst.mockResolvedValue({ id: 'ft-existing' });

        await handler.handleOrderCreated(
          new OrderCreatedEvent(ORDER_ID, TENANT_ID, USER_ID, ITEMS),
        );

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('should NOT credit a term payment (boleto) at creation', async () => {
        prisma.orderPayment.findMany.mockResolvedValue([
          {
            ...cashPayment,
            id: 'op-boleto',
            paymentMethod: { name: 'Boleto', type: 'BOLETO', defaultAccountId: 'acc-1' },
          },
        ]);

        await handler.handleOrderCreated(
          new OrderCreatedEvent(ORDER_ID, TENANT_ID, USER_ID, ITEMS),
        );

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('should NOT credit for external origins (marketplace)', async () => {
        prisma.order.findUnique.mockResolvedValue({
          id: ORDER_ID,
          tenantId: TENANT_ID,
          orderNumber: 'PED-000001',
          origin: 'SHOPEE',
        });
        prisma.orderPayment.findMany.mockResolvedValue([cashPayment]);

        await handler.handleOrderCreated(
          new OrderCreatedEvent(ORDER_ID, TENANT_ID, USER_ID, ITEMS),
        );

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });
    });
  });

  // ─── handleOrderConfirmed ─────────────────────────────────────────────
  // ─── FN-15: o dinheiro da venda de balcão cai no caixa da venda ─────────

  describe('cash on a counter sale lands in the drawer that took it (FN-15)', () => {
    // A conciliação de um dia inteiro achou isto: a venda em dinheiro creditava
    // a conta *do método de pagamento* enquanto a sessão de caixa creditava a
    // conta *do caixa*. Com as duas diferentes, a conta do caixa fechava sem a
    // venda e a do método fechava com dinheiro que nunca esteve lá.
    const cashPayment = {
      id: 'op-cash-1',
      amount: 100,
      installments: 1,
      financialAccountId: null,
      paymentMethodId: 'pm-1',
      paymentMethod: { name: 'Dinheiro', type: 'CASH', defaultAccountId: 'acc-method' },
    };

    beforeEach(() => {
      prisma.notification.create.mockResolvedValue({});
      prisma._tx.financialAccount.update.mockResolvedValue({ balance: 100 });
      prisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        tenantId: TENANT_ID,
        orderNumber: 'PED-000001',
        origin: 'BALCAO',
        cashRegisterSession: {
          cashRegister: { financialAccountId: 'acc-drawer' },
        },
      });
      prisma.orderPayment.findMany.mockResolvedValue([cashPayment]);
    });

    it('credits the cash register account, not the payment method default', async () => {
      await handler.handleOrderCounterSale(
        new OrderCounterSaleEvent(ORDER_ID, TENANT_ID, USER_ID, 100, ITEMS),
      );

      expect(prisma._tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-drawer' },
        data: { balance: { increment: 100 } },
        select: { balance: true },
      });
    });

    it('falls back to the method account when the sale has no session', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        tenantId: TENANT_ID,
        orderNumber: 'PED-000001',
        origin: 'MANUAL',
        cashRegisterSession: null,
      });

      await handler.handleOrderCreated(
        new OrderCreatedEvent(ORDER_ID, TENANT_ID, USER_ID, ITEMS),
      );

      expect(prisma._tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-method' },
        data: { balance: { increment: 100 } },
        select: { balance: true },
      });
    });

    it('leaves a PIX payment on the method account — it never touches the drawer', async () => {
      prisma.orderPayment.findMany.mockResolvedValue([
        {
          ...cashPayment,
          paymentMethod: { name: 'PIX', type: 'PIX', defaultAccountId: 'acc-method' },
        },
      ]);

      await handler.handleOrderCounterSale(
        new OrderCounterSaleEvent(ORDER_ID, TENANT_ID, USER_ID, 100, ITEMS),
      );

      expect(prisma._tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-method' },
        data: { balance: { increment: 100 } },
        select: { balance: true },
      });
    });

    it('keeps cash in the drawer even when the payment carries another account', async () => {
      // `financialAccountId` no pagamento é hoje uma cópia do padrão do método,
      // não uma escolha do operador — e dinheiro vivo não vai para outro lugar
      // que não a gaveta onde foi recebido.
      prisma.orderPayment.findMany.mockResolvedValue([
        { ...cashPayment, financialAccountId: 'acc-method' },
      ]);

      await handler.handleOrderCounterSale(
        new OrderCounterSaleEvent(ORDER_ID, TENANT_ID, USER_ID, 100, ITEMS),
      );

      expect(prisma._tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-drawer' },
        data: { balance: { increment: 100 } },
        select: { balance: true },
      });
    });

    it('respects the account chosen on a PIX payment', async () => {
      prisma.orderPayment.findMany.mockResolvedValue([
        {
          ...cashPayment,
          financialAccountId: 'acc-explicit',
          paymentMethod: { name: 'PIX', type: 'PIX', defaultAccountId: 'acc-method' },
        },
      ]);

      await handler.handleOrderCounterSale(
        new OrderCounterSaleEvent(ORDER_ID, TENANT_ID, USER_ID, 100, ITEMS),
      );

      expect(prisma._tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-explicit' },
        data: { balance: { increment: 100 } },
        select: { balance: true },
      });
    });
  });

  describe('handleOrderConfirmed', () => {
    const confirmedItems = [
      { productId: 'prod-001', variantId: null, quantity: 2 },
      { productId: 'prod-002', variantId: 'var-001', quantity: 1 },
    ];

    beforeEach(() => {
      prisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        tenantId: TENANT_ID,
        customerId: 'cust-001',
        totalAmount: 250,
        orderNumber: 'PED-000001',
      });
      prisma.accountsReceivable.create.mockResolvedValue({});
      prisma.notification.create.mockResolvedValue({});
    });

    it('should reserve stock for each item', async () => {
      const event = new OrderConfirmedEvent(ORDER_ID, TENANT_ID, USER_ID, 250, confirmedItems);
      await handler.handleOrderConfirmed(event);

      expect(inventoryService.reserveStock).toHaveBeenCalledTimes(2);
      expect(inventoryService.reserveStock).toHaveBeenCalledWith(TENANT_ID, 'prod-001', null, 2);
      expect(inventoryService.reserveStock).toHaveBeenCalledWith(TENANT_ID, 'prod-002', 'var-001', 1);
    });

    it('should create accounts receivable with correct data', async () => {
      const event = new OrderConfirmedEvent(ORDER_ID, TENANT_ID, USER_ID, 250, confirmedItems);
      await handler.handleOrderConfirmed(event);

      expect(prisma.accountsReceivable.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          orderId: ORDER_ID,
          customerId: 'cust-001',
          amount: 250,
          status: 'PENDING',
          description: expect.stringContaining('PED-000001'),
          dueDate: expect.any(Date),
        }),
      });
    });

    it('should create a notification', async () => {
      const event = new OrderConfirmedEvent(ORDER_ID, TENANT_ID, USER_ID, 250, confirmedItems);
      await handler.handleOrderConfirmed(event);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          userId: USER_ID,
          title: 'Order confirmed',
        }),
      });
    });

    // SCRUM-31: cash on an order-based sale is settled at the sale, so its
    // receivable must not linger as PENDING (it was already credited).
    it('should mark the receivable of an immediate payment as PAID', async () => {
      prisma.orderPayment.findMany.mockResolvedValue([
        {
          id: 'op-1',
          amount: 250,
          installments: 1,
          financialAccountId: 'acc-1',
          paymentMethodId: 'pm-1',
          paymentMethod: { id: 'pm-1', name: 'Dinheiro', type: 'CASH' },
          paymentCondition: null,
        },
      ]);

      await handler.handleOrderConfirmed(
        new OrderConfirmedEvent(ORDER_ID, TENANT_ID, USER_ID, 250, confirmedItems),
      );

      const data = prisma.accountsReceivable.create.mock.calls[0][0].data;
      expect(data.status).toBe('PAID');
      expect(data.paidAmount).toBe(250);
      expect(data.paidAt).toBeInstanceOf(Date);
    });

    it('should keep the receivable of a term payment PENDING', async () => {
      prisma.orderPayment.findMany.mockResolvedValue([
        {
          id: 'op-2',
          amount: 250,
          installments: 1,
          financialAccountId: null,
          paymentMethodId: 'pm-2',
          paymentMethod: { id: 'pm-2', name: 'Boleto', type: 'BOLETO' },
          paymentCondition: null,
        },
      ]);

      await handler.handleOrderConfirmed(
        new OrderConfirmedEvent(ORDER_ID, TENANT_ID, USER_ID, 250, confirmedItems),
      );

      const data = prisma.accountsReceivable.create.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING');
    });

    // VD-05: "3x sem juros" generated one receivable for the full amount
    // because the PDV always sent installments: 1.
    describe('installments (VD-05)', () => {
      const in3x = {
        id: 'op-3',
        amount: 189.8,
        installments: 3,
        financialAccountId: null,
        paymentMethodId: 'pm-3',
        paymentMethod: { id: 'pm-3', name: 'Cartão de Crédito', type: 'CREDIT_CARD' },
        paymentCondition: {
          id: 'pc-3',
          daysBetweenInstallments: 30,
          entryPercentage: 0,
          type: 'INSTALLMENT',
        },
      };

      beforeEach(() => {
        prisma.orderPayment.findMany.mockResolvedValue([in3x]);
      });

      it('should create one receivable per installment', async () => {
        await handler.handleOrderConfirmed(
          new OrderConfirmedEvent(ORDER_ID, TENANT_ID, USER_ID, 189.8, confirmedItems),
        );

        expect(prisma.accountsReceivable.create).toHaveBeenCalledTimes(3);
      });

      it('should split the amount without losing or inventing cents', async () => {
        await handler.handleOrderConfirmed(
          new OrderConfirmedEvent(ORDER_ID, TENANT_ID, USER_ID, 189.8, confirmedItems),
        );

        const amounts = prisma.accountsReceivable.create.mock.calls.map(
          (call: [{ data: { amount: number } }]) => call[0].data.amount,
        );
        expect(amounts).toEqual([63.27, 63.27, 63.26]);
        expect(Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(189.8);
      });

      it('should number the installments and space the due dates by 30 days', async () => {
        await handler.handleOrderConfirmed(
          new OrderConfirmedEvent(ORDER_ID, TENANT_ID, USER_ID, 189.8, confirmedItems),
        );

        const rows = prisma.accountsReceivable.create.mock.calls.map(
          (call: [{ data: Record<string, unknown> }]) => call[0].data,
        );
        expect(rows.map((r) => r.installment)).toEqual([1, 2, 3]);
        expect(rows.every((r) => r.totalInstallments === 3)).toBe(true);
        expect(rows[0].description).toContain('(1/3)');

        const days = (a: Date, b: Date) =>
          Math.round((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
        expect(days(rows[1].dueDate as Date, rows[0].dueDate as Date)).toBe(30);
        expect(days(rows[2].dueDate as Date, rows[1].dueDate as Date)).toBe(30);
      });
    });

    it('should skip receivable creation when order is not found', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      const event = new OrderConfirmedEvent(ORDER_ID, TENANT_ID, USER_ID, 250, confirmedItems);
      await handler.handleOrderConfirmed(event);

      expect(inventoryService.reserveStock).toHaveBeenCalledTimes(2);
      expect(prisma.accountsReceivable.create).not.toHaveBeenCalled();
    });

    it('should not throw when an error occurs', async () => {
      inventoryService.reserveStock.mockRejectedValue(new Error('Stock error'));

      const event = new OrderConfirmedEvent(ORDER_ID, TENANT_ID, USER_ID, 250, confirmedItems);

      await expect(handler.handleOrderConfirmed(event)).resolves.toBeUndefined();
    });
  });

  // ─── handleOrderShipped ───────────────────────────────────────────────
  describe('handleOrderShipped', () => {
    const shippedItems = [
      { productId: 'prod-001', variantId: null, quantity: 2 },
      { productId: 'prod-002', variantId: 'var-001', quantity: 1 },
    ];

    it('should deduct reserved stock for each item on shipment', async () => {
      const event = new OrderShippedEvent(ORDER_ID, TENANT_ID, USER_ID, shippedItems);
      await handler.handleOrderShipped(event);

      expect(inventoryService.fulfillReservedStock).toHaveBeenCalledTimes(2);
      expect(inventoryService.fulfillReservedStock).toHaveBeenCalledWith(TENANT_ID, 'prod-001', null, 2, ORDER_ID);
      expect(inventoryService.fulfillReservedStock).toHaveBeenCalledWith(TENANT_ID, 'prod-002', 'var-001', 1, ORDER_ID);
    });

    it('should NOT reserve stock again on shipment', async () => {
      const event = new OrderShippedEvent(ORDER_ID, TENANT_ID, USER_ID, shippedItems);
      await handler.handleOrderShipped(event);

      expect(inventoryService.reserveStock).not.toHaveBeenCalled();
    });

    it('should not throw when stock deduction fails', async () => {
      inventoryService.fulfillReservedStock.mockRejectedValue(new Error('Stock error'));

      const event = new OrderShippedEvent(ORDER_ID, TENANT_ID, USER_ID, shippedItems);

      await expect(handler.handleOrderShipped(event)).resolves.toBeUndefined();
    });
  });

  // ─── handleOrderCounterSale (balance credit) ──────────────────────────
  describe('handleOrderCounterSale', () => {
    const counterItems = [
      { productId: 'prod-001', variantId: null, quantity: 1 },
    ];

    beforeEach(() => {
      prisma.order.findUnique.mockResolvedValue({
        id: ORDER_ID,
        tenantId: TENANT_ID,
        customerId: 'cust-001',
        totalAmount: 100,
        orderNumber: 'PED-000001',
      });
      prisma.accountsReceivable.create.mockResolvedValue({});
      prisma.notification.create.mockResolvedValue({});
    });

    it('should credit the linked account and record a CREDIT transaction for an immediate payment', async () => {
      prisma.orderPayment.findMany.mockResolvedValue([
        {
          id: 'op-1',
          amount: 100,
          installments: 1,
          financialAccountId: 'acc-1',
          paymentMethodId: 'pm-1',
          paymentMethod: { name: 'Dinheiro', type: 'CASH', defaultAccountId: 'acc-def' },
        },
      ]);
      prisma._tx.financialAccount.update.mockResolvedValue({ balance: 350 });

      const event = new OrderCounterSaleEvent(ORDER_ID, TENANT_ID, USER_ID, 100, counterItems);
      await handler.handleOrderCounterSale(event);

      expect(prisma._tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { balance: { increment: 100 } },
        select: { balance: true },
      });
      const txArgs = prisma._tx.financialTransaction.create.mock.calls[0][0];
      expect(txArgs.data).toEqual(
        expect.objectContaining({
          tenantId: TENANT_ID,
          accountId: 'acc-1',
          type: 'CREDIT',
          amount: 100,
          balanceAfter: 350,
          referenceType: 'order',
          referenceId: ORDER_ID,
        }),
      );
    });

    it('should fall back to the payment method default account when the payment has none', async () => {
      prisma.orderPayment.findMany.mockResolvedValue([
        {
          id: 'op-2',
          amount: 50,
          installments: 1,
          financialAccountId: null,
          paymentMethodId: 'pm-1',
          paymentMethod: { name: 'PIX', type: 'PIX', defaultAccountId: 'acc-def' },
        },
      ]);

      const event = new OrderCounterSaleEvent(ORDER_ID, TENANT_ID, USER_ID, 50, counterItems);
      await handler.handleOrderCounterSale(event);

      expect(prisma._tx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-def' } }),
      );
    });

    it('should skip crediting when no account can be resolved', async () => {
      prisma.orderPayment.findMany.mockResolvedValue([
        {
          id: 'op-3',
          amount: 50,
          installments: 1,
          financialAccountId: null,
          paymentMethodId: 'pm-1',
          paymentMethod: { name: 'PIX', type: 'PIX', defaultAccountId: null },
        },
      ]);

      const event = new OrderCounterSaleEvent(ORDER_ID, TENANT_ID, USER_ID, 50, counterItems);
      await handler.handleOrderCounterSale(event);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    // Taxa e prazo de liquidação do método eram só cadastro: o débito entrava
    // PAID, valor cheio, na hora, e a taxa da maquininha nunca aparecia.
    describe('settlement days and fee of the payment method', () => {
      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-08-10T15:00:00.000Z'));
      });
      afterEach(() => {
        jest.useRealTimers();
      });

      const debit = (overrides: Record<string, unknown> = {}) => ({
        id: 'op-d',
        amount: 449.9,
        installments: 1,
        financialAccountId: 'acc-1',
        paymentMethodId: 'pm-d',
        paymentCondition: null,
        paymentMethod: {
          id: 'pm-d',
          name: 'Cartão de Débito',
          type: 'DEBIT_CARD',
          defaultAccountId: 'acc-1',
          settlementDays: 1,
          feePercentage: 1.5,
          ...overrides,
        },
      });

      const sale = () =>
        handler.handleOrderCounterSale(
          new OrderCounterSaleEvent(ORDER_ID, TENANT_ID, USER_ID, 449.9, counterItems),
        );

      it('should leave a debit sale PENDING until its settlement day', async () => {
        prisma.orderPayment.findMany.mockResolvedValue([debit()]);

        await sale();

        const data = prisma.accountsReceivable.create.mock.calls[0][0].data;
        expect(data.status).toBe('PENDING');
        expect(data.paidAt).toBeNull();
        // D+1 at midnight in America/Sao_Paulo
        expect(data.dueDate).toEqual(new Date('2026-08-11T03:00:00.000Z'));
      });

      it('should NOT credit the account before the money settles', async () => {
        prisma.orderPayment.findMany.mockResolvedValue([debit()]);

        await sale();

        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('should keep a debit with no settlement days PAID and credited', async () => {
        prisma.orderPayment.findMany.mockResolvedValue([
          debit({ settlementDays: null }),
        ]);

        await sale();

        expect(prisma.accountsReceivable.create.mock.calls[0][0].data.status).toBe('PAID');
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      });

      it('should book the fee as a payable, due on the day the money settles', async () => {
        prisma.orderPayment.findMany.mockResolvedValue([debit()]);

        await sale();

        // 449,90 × 1,5% = 6,7485 → 6,75
        expect(prisma.accountsPayable.create).toHaveBeenCalledWith({
          data: {
            tenantId: TENANT_ID,
            description: 'Taxa Cartão de Débito - PED-000001',
            amount: 6.75,
            status: 'PENDING',
            dueDate: new Date('2026-08-11T03:00:00.000Z'),
            paymentMethodId: 'pm-d',
            metadata: {
              kind: 'PAYMENT_FEE',
              orderId: ORDER_ID,
              orderPaymentId: 'op-d',
              feePercentage: 1.5,
            },
          },
        });
      });

      it('should round the fee in cents, not in floats', async () => {
        prisma.orderPayment.findMany.mockResolvedValue([
          { ...debit({ feePercentage: 3.19, settlementDays: 30, type: 'CREDIT_CARD' }), amount: 699.9 },
        ]);

        await sale();

        // 699,90 × 3,19% = 22,32681 → 22,33
        expect(prisma.accountsPayable.create.mock.calls[0][0].data.amount).toBe(22.33);
      });

      it.each([[null], [0], [undefined]])(
        'should not book a fee when the method has none (%s)',
        async (fee) => {
          prisma.orderPayment.findMany.mockResolvedValue([
            debit({ feePercentage: fee }),
          ]);

          await sale();

          expect(prisma.accountsPayable.create).not.toHaveBeenCalled();
        },
      );

      it('should book the fee once for an installment sale, due with the first installment', async () => {
        prisma.orderPayment.findMany.mockResolvedValue([
          {
            ...debit({ type: 'CREDIT_CARD', name: 'Cartão de Crédito', feePercentage: 3, settlementDays: 30 }),
            id: 'op-c',
            amount: 699.9,
            installments: 3,
            paymentCondition: { id: 'c-1', daysBetweenInstallments: 30, entryPercentage: 0, type: 'INSTALLMENT' },
          },
        ]);

        await sale();

        expect(prisma.accountsPayable.create).toHaveBeenCalledTimes(1);
        const payable = prisma.accountsPayable.create.mock.calls[0][0].data;
        expect(payable.amount).toBe(21);
        expect(payable.dueDate).toEqual(
          prisma.accountsReceivable.create.mock.calls[0][0].data.dueDate,
        );
      });
    });

    it('should NOT credit for non-immediate payment types (e.g. BOLETO)', async () => {
      prisma.orderPayment.findMany.mockResolvedValue([
        {
          id: 'op-4',
          amount: 50,
          installments: 1,
          financialAccountId: 'acc-1',
          paymentMethodId: 'pm-1',
          paymentMethod: { name: 'Boleto', type: 'BOLETO', defaultAccountId: 'acc-1' },
        },
      ]);

      const event = new OrderCounterSaleEvent(ORDER_ID, TENANT_ID, USER_ID, 50, counterItems);
      await handler.handleOrderCounterSale(event);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ─── handleOrderCancelled ─────────────────────────────────────────────
  describe('handleOrderCancelled', () => {
    const cancelledItems = [
      { productId: 'prod-001', variantId: null, quantity: 2 },
      { productId: 'prod-002', variantId: 'var-001', quantity: 1 },
    ];
    const reason = 'Customer requested cancellation';

    beforeEach(() => {
      prisma.accountsReceivable.updateMany.mockResolvedValue({ count: 1 });
      prisma.notification.create.mockResolvedValue({});
    });

    it('should release stock when previousStatus is post-confirmation (CONFIRMED)', async () => {
      const event = new OrderCancelledEvent(ORDER_ID, TENANT_ID, USER_ID, cancelledItems, reason, 'CONFIRMED');
      await handler.handleOrderCancelled(event);

      expect(inventoryService.releaseStock).toHaveBeenCalledTimes(2);
      expect(inventoryService.releaseStock).toHaveBeenCalledWith(TENANT_ID, 'prod-001', null, 2);
      expect(inventoryService.releaseStock).toHaveBeenCalledWith(TENANT_ID, 'prod-002', 'var-001', 1);
    });

    it('should release stock when previousStatus is PICKING', async () => {
      const event = new OrderCancelledEvent(ORDER_ID, TENANT_ID, USER_ID, cancelledItems, reason, 'PICKING');
      await handler.handleOrderCancelled(event);

      expect(inventoryService.releaseStock).toHaveBeenCalledTimes(2);
    });

    it('should NOT release stock when previousStatus is PENDING', async () => {
      const event = new OrderCancelledEvent(ORDER_ID, TENANT_ID, USER_ID, cancelledItems, reason, 'PENDING');
      await handler.handleOrderCancelled(event);

      expect(inventoryService.releaseStock).not.toHaveBeenCalled();
    });

    it('should NOT release stock when previousStatus is DRAFT', async () => {
      const event = new OrderCancelledEvent(ORDER_ID, TENANT_ID, USER_ID, cancelledItems, reason, 'DRAFT');
      await handler.handleOrderCancelled(event);

      expect(inventoryService.releaseStock).not.toHaveBeenCalled();
    });

    it('should NOT release stock when previousStatus is undefined', async () => {
      const event = new OrderCancelledEvent(ORDER_ID, TENANT_ID, USER_ID, cancelledItems, reason, undefined);
      await handler.handleOrderCancelled(event);

      expect(inventoryService.releaseStock).not.toHaveBeenCalled();
    });

    it('should cancel pending and partially paid receivables', async () => {
      const event = new OrderCancelledEvent(ORDER_ID, TENANT_ID, USER_ID, cancelledItems, reason, 'CONFIRMED');
      await handler.handleOrderCancelled(event);

      expect(prisma.accountsReceivable.updateMany).toHaveBeenCalledWith({
        where: {
          orderId: ORDER_ID,
          tenantId: TENANT_ID,
          status: { in: ['PENDING', 'PARTIALLY_PAID'] },
        },
        data: { status: 'CANCELLED' },
      });
    });

    it('should cancel the pending payment-fee payables of the order', async () => {
      const event = new OrderCancelledEvent(ORDER_ID, TENANT_ID, USER_ID, cancelledItems, reason, 'CONFIRMED');
      await handler.handleOrderCancelled(event);

      expect(prisma.accountsPayable.updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          status: { in: ['PENDING', 'PARTIALLY_PAID'] },
          AND: [
            { metadata: { path: ['kind'], equals: 'PAYMENT_FEE' } },
            { metadata: { path: ['orderId'], equals: ORDER_ID } },
          ],
        },
        data: { status: 'CANCELLED' },
      });
    });

    it('should create a notification with cancellation reason', async () => {
      const event = new OrderCancelledEvent(ORDER_ID, TENANT_ID, USER_ID, cancelledItems, reason, 'CONFIRMED');
      await handler.handleOrderCancelled(event);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          userId: USER_ID,
          title: 'Order cancelled',
          message: expect.stringContaining(reason),
        }),
      });
    });

    it('should not throw when an error occurs', async () => {
      prisma.accountsReceivable.updateMany.mockRejectedValue(new Error('DB error'));

      const event = new OrderCancelledEvent(ORDER_ID, TENANT_ID, USER_ID, cancelledItems, reason, 'CONFIRMED');

      await expect(handler.handleOrderCancelled(event)).resolves.toBeUndefined();
    });
  });
});
