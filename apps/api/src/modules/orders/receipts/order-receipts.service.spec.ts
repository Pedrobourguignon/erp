import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { TenantsService } from '../../tenants/tenants.service';
import { OrderReceiptsService } from './order-receipts.service';

const TENANT_ID = 'tenant-uuid-001';
const OTHER_TENANT_ID = 'tenant-uuid-999';
const USER_ID = 'user-uuid-001';
const ORDER_ID = 'order-uuid-001';
const ADJUSTMENT_ID = 'adj-uuid-001';

const D = (value: string) => new Prisma.Decimal(value);

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    status: 'COMPLETED',
    orderNumber: 'PED-000042',
    createdAt: new Date('2026-11-17T18:00:00.000Z'),
    subtotal: D('100.00'),
    discount: D('0'),
    shippingCost: D('0'),
    totalAmount: D('100.00'),
    customer: { name: 'Maria Souza', document: '52998224725' },
    seller: { name: 'João Vendedor' },
    cashRegisterSession: null,
    items: [
      { name: 'Camiseta', sku: 'CAM-01', quantity: 1, unitPrice: D('100.00'), discount: D('0'), totalPrice: D('100.00') },
    ],
    payments: [
      { paymentMethod: { name: 'Dinheiro' }, amount: D('100.00'), installments: 1, amountTendered: D('150.00') },
    ],
    ...overrides,
  };
}

const store = {
  name: 'Loja Exemplo LTDA',
  document: '12345678000195',
  phone: null,
  addressStreet: null,
  addressNumber: null,
  addressComplement: null,
  addressNeighborhood: null,
  addressCity: null,
  addressState: null,
  addressZipCode: null,
  receiptFormat: 'A4',
  receiptFooter: null,
  // Fields the receipt must never carry.
  settings: { secret: true },
  maxUsers: 5,
};

describe('OrderReceiptsService', () => {
  let service: OrderReceiptsService;
  let prisma: {
    order: { findFirst: jest.Mock; update: jest.Mock };
    orderAdjustment: { findFirst: jest.Mock; update: jest.Mock };
  };
  let audit: { record: jest.Mock };
  let tenants: { findById: jest.Mock };

  beforeEach(async () => {
    prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(makeOrder()),
        update: jest.fn().mockResolvedValue({ receiptPrintCount: 1 }),
      },
      orderAdjustment: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ receiptPrintCount: 1 }),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    tenants = { findById: jest.fn().mockResolvedValue(store) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderReceiptsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: TenantsService, useValue: tenants },
      ],
    }).compile();

    service = module.get(OrderReceiptsService);
  });

  describe('printSale', () => {
    it('reads the order only inside the caller tenant', async () => {
      await service.printSale(TENANT_ID, USER_ID, ORDER_ID);

      expect(prisma.order.findFirst.mock.calls[0][0].where).toMatchObject({
        id: ORDER_ID,
        tenantId: TENANT_ID,
        deletedAt: null,
      });
      expect(tenants.findById).toHaveBeenCalledWith(TENANT_ID);
    });

    it('answers 404 for an order of another tenant', async () => {
      prisma.order.findFirst.mockResolvedValue(null);

      await expect(service.printSale(OTHER_TENANT_ID, USER_ID, ORDER_ID)).rejects.toThrow(
        new NotFoundException('Pedido não encontrado'),
      );
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('refuses a cancelled order: there was no sale to prove', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder({ status: 'CANCELLED' }));

      await expect(service.printSale(TENANT_ID, USER_ID, ORDER_ID)).rejects.toThrow(
        new BadRequestException('Pedido cancelado não tem recibo'),
      );
    });

    it('counts the print and returns the copy number', async () => {
      prisma.order.update.mockResolvedValue({ receiptPrintCount: 2 });

      const receipt = await service.printSale(TENANT_ID, USER_ID, ORDER_ID);

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: ORDER_ID },
        data: { receiptPrintCount: { increment: 1 } },
        select: { receiptPrintCount: true },
      });
      expect(receipt.copy).toBe(2);
    });

    it('leaves a trail of who printed which copy', async () => {
      prisma.order.update.mockResolvedValue({ receiptPrintCount: 3 });

      await service.printSale(TENANT_ID, USER_ID, ORDER_ID);

      expect(audit.record).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        userId: USER_ID,
        entity: 'Order',
        entityId: ORDER_ID,
        action: 'EXPORT',
        metadata: { document: 'SALE_RECEIPT', copy: 3 },
      });
    });

    it('builds the receipt in the store format, with the change', async () => {
      const receipt = await service.printSale(TENANT_ID, USER_ID, ORDER_ID);

      expect(receipt.format).toBe('A4');
      expect(receipt.payments[0]).toMatchObject({ tendered: 150, change: 50 });
      expect(receipt.customer?.document).toBe('CPF ***.982.247-**');
    });

    it('carries nothing from the tenant beyond the receipt header', async () => {
      const receipt = await service.printSale(TENANT_ID, USER_ID, ORDER_ID);

      expect(JSON.stringify(receipt)).not.toContain('secret');
      expect(JSON.stringify(receipt)).not.toContain('maxUsers');
    });
  });

  describe('printAdjustment', () => {
    const adjustment = {
      type: 'EXCHANGE',
      quantity: 1,
      createdAt: new Date('2026-11-20T15:00:00.000Z'),
      returnedName: 'Camiseta P',
      returnedSku: 'CAM-P',
      returnedValue: D('95.00'),
      newName: 'Camiseta M',
      newSku: 'CAM-M',
      newValue: D('120.00'),
      difference: D('25.00'),
      abatedAmount: D('0'),
      reason: null,
    };

    beforeEach(() => {
      prisma.orderAdjustment.findFirst.mockResolvedValue(adjustment);
    });

    it('reads the exchange only inside the caller tenant and order', async () => {
      await service.printAdjustment(TENANT_ID, USER_ID, ORDER_ID, ADJUSTMENT_ID);

      expect(prisma.orderAdjustment.findFirst.mock.calls[0][0].where).toEqual({
        id: ADJUSTMENT_ID,
        orderId: ORDER_ID,
        tenantId: TENANT_ID,
      });
    });

    it('answers 404 for an exchange that is not in this order', async () => {
      prisma.orderAdjustment.findFirst.mockResolvedValue(null);

      await expect(
        service.printAdjustment(TENANT_ID, USER_ID, ORDER_ID, ADJUSTMENT_ID),
      ).rejects.toThrow(new NotFoundException('Troca ou devolução não encontrada'));
    });

    it('counts its own copies, apart from the sale receipt', async () => {
      prisma.orderAdjustment.update.mockResolvedValue({ receiptPrintCount: 2 });

      const receipt = await service.printAdjustment(TENANT_ID, USER_ID, ORDER_ID, ADJUSTMENT_ID);

      expect(prisma.orderAdjustment.update).toHaveBeenCalledWith({
        where: { id: ADJUSTMENT_ID },
        data: { receiptPrintCount: { increment: 1 } },
        select: { receiptPrintCount: true },
      });
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(receipt.copy).toBe(2);
      expect(receipt.kind).toBe('EXCHANGE');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'OrderAdjustment',
          entityId: ADJUSTMENT_ID,
          metadata: { document: 'EXCHANGE_RECEIPT', copy: 2 },
        }),
      );
    });

    it('prints the exchange of a cancelled order too: the exchange happened', async () => {
      prisma.order.findFirst.mockResolvedValue(makeOrder({ status: 'CANCELLED' }));

      await expect(
        service.printAdjustment(TENANT_ID, USER_ID, ORDER_ID, ADJUSTMENT_ID),
      ).resolves.toMatchObject({ kind: 'EXCHANGE' });
    });
  });
});
