import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { AdjustOrderItemUseCase } from './use-cases/adjust-order-item.use-case';
import { ReverseSaleUseCase } from './use-cases/reverse-sale.use-case';
import { PrismaService } from '../../database/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';

// ─── Mock OrdersService ──────────────────────────────────────────────────────

function createMockOrdersService() {
  return {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    updateStatus: jest.fn(),
    cancel: jest.fn(),
    getTimeline: jest.fn(),
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-001';
const USER_ID = 'user-uuid-001';

function makeOrder() {
  return {
    id: 'order-uuid-001',
    tenantId: TENANT_ID,
    orderNumber: 'PED-000001',
    status: 'PENDING',
    totalAmount: 250,
    items: [{ id: 'item-001', productId: 'prod-001', quantity: 2 }],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OrdersController', () => {
  let controller: OrdersController;
  let ordersService: ReturnType<typeof createMockOrdersService>;
  let reverseSale: { execute: jest.Mock };
  let adjustOrderItem: { execute: jest.Mock };

  beforeEach(async () => {
    ordersService = createMockOrdersService();
    reverseSale = { execute: jest.fn().mockResolvedValue({ orderId: 'order-uuid-001' }) };
    adjustOrderItem = { execute: jest.fn().mockResolvedValue({ adjustmentId: 'adj-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: ordersService },
        { provide: AdjustOrderItemUseCase, useValue: adjustOrderItem },
        { provide: ReverseSaleUseCase, useValue: reverseSale },
        { provide: PrismaService, useValue: {} },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OrdersController>(OrdersController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── findAll ──────────────────────────────────────────────────────────
  describe('GET /orders', () => {
    it('should call service.findAll with tenantId and query', async () => {
      const paginatedResult = { data: [makeOrder()], meta: { total: 1, page: 1, limit: 20, totalPages: 1, hasMore: false } };
      ordersService.findAll.mockResolvedValue(paginatedResult);

      const query = { page: 1, limit: 20 };
      const result = await controller.findAll(TENANT_ID, query as any);

      expect(ordersService.findAll).toHaveBeenCalledWith(TENANT_ID, query);
      expect(result).toEqual(paginatedResult);
    });

    it('should require orders:read permission', () => {
      const metadata = Reflect.getMetadata(PERMISSIONS_KEY, controller.findAll);
      expect(metadata).toEqual(['orders:read']);
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────
  describe('GET /orders/:id', () => {
    it('should return order wrapped in success response', async () => {
      const order = makeOrder();
      ordersService.findOne.mockResolvedValue(order);

      const result = await controller.findOne(TENANT_ID, 'order-uuid-001');

      expect(ordersService.findOne).toHaveBeenCalledWith(TENANT_ID, 'order-uuid-001');
      expect(result).toEqual({ success: true, data: order });
    });

    it('should require orders:read permission', () => {
      const metadata = Reflect.getMetadata(PERMISSIONS_KEY, controller.findOne);
      expect(metadata).toEqual(['orders:read']);
    });
  });

  // ─── create ───────────────────────────────────────────────────────────
  describe('POST /orders', () => {
    it('should pass tenantId, userId, and dto to service.create', async () => {
      const dto = { customerId: 'cust-001', items: [{ productId: 'prod-001', quantity: 2, unitPrice: 100 }] };
      const createdOrder = makeOrder();
      ordersService.create.mockResolvedValue(createdOrder);

      const result = await controller.create(TENANT_ID, USER_ID, dto as any);

      expect(ordersService.create).toHaveBeenCalledWith(TENANT_ID, USER_ID, dto);
      expect(result).toEqual({ success: true, data: createdOrder });
    });

    it('should require orders:create permission', () => {
      const metadata = Reflect.getMetadata(PERMISSIONS_KEY, controller.create);
      expect(metadata).toEqual(['orders:create']);
    });
  });

  // ─── updateStatus ─────────────────────────────────────────────────────
  describe('PATCH /orders/:id/status', () => {
    it('should pass tenantId, userId, id, and dto to service.updateStatus', async () => {
      const dto = { status: 'CONFIRMED' };
      const updatedOrder = { ...makeOrder(), status: 'CONFIRMED' };
      ordersService.updateStatus.mockResolvedValue(updatedOrder);

      const result = await controller.updateStatus(TENANT_ID, USER_ID, 'order-uuid-001', dto as any);

      expect(ordersService.updateStatus).toHaveBeenCalledWith(TENANT_ID, 'order-uuid-001', USER_ID, dto);
      expect(result).toEqual({ success: true, data: updatedOrder });
    });

    it('should require orders:update permission', () => {
      const metadata = Reflect.getMetadata(PERMISSIONS_KEY, controller.updateStatus);
      expect(metadata).toEqual(['orders:update']);
    });
  });

  // ─── cancel ───────────────────────────────────────────────────────────
  describe('PATCH /orders/:id/cancel', () => {
    it('should pass tenantId, userId, id, and dto to service.cancel', async () => {
      const dto = { reason: 'Customer request' };
      const cancelledOrder = { ...makeOrder(), status: 'CANCELLED' };
      ordersService.cancel.mockResolvedValue(cancelledOrder);

      const result = await controller.cancel(TENANT_ID, USER_ID, 'order-uuid-001', dto as any);

      expect(ordersService.cancel).toHaveBeenCalledWith(TENANT_ID, 'order-uuid-001', USER_ID, dto);
      expect(result).toEqual({ success: true, data: cancelledOrder });
    });

    it('should require orders:update permission', () => {
      const metadata = Reflect.getMetadata(PERMISSIONS_KEY, controller.cancel);
      expect(metadata).toEqual(['orders:update']);
    });
  });

  // ─── reverse (VD-14) ──────────────────────────────────────────────────
  describe('POST /orders/:id/reverse', () => {
    it('should pass tenantId, userId, id and dto to the use case', async () => {
      const dto = { reason: 'Cliente desistiu' };
      const reversal = { orderId: 'order-uuid-001', status: 'RETURNED' };
      reverseSale.execute.mockResolvedValue(reversal);

      const result = await controller.reverse(
        TENANT_ID,
        USER_ID,
        'order-uuid-001',
        dto as any,
      );

      expect(reverseSale.execute).toHaveBeenCalledWith(
        TENANT_ID,
        'order-uuid-001',
        USER_ID,
        dto,
      );
      expect(result).toEqual({ success: true, data: reversal });
    });

    it('should require orders:update permission', () => {
      const metadata = Reflect.getMetadata(PERMISSIONS_KEY, controller.reverse);
      expect(metadata).toEqual(['orders:update']);
    });
  });

  // ─── getTimeline ──────────────────────────────────────────────────────
  describe('GET /orders/:id/timeline', () => {
    it('should return timeline wrapped in success response', async () => {
      const timeline = [
        { id: 'h1', toStatus: 'PENDING', createdAt: new Date() },
        { id: 'h2', toStatus: 'CONFIRMED', createdAt: new Date() },
      ];
      ordersService.getTimeline.mockResolvedValue(timeline);

      const result = await controller.getTimeline(TENANT_ID, 'order-uuid-001');

      expect(ordersService.getTimeline).toHaveBeenCalledWith(TENANT_ID, 'order-uuid-001');
      expect(result).toEqual({ success: true, data: timeline });
    });

    it('should require orders:read permission', () => {
      const metadata = Reflect.getMetadata(PERMISSIONS_KEY, controller.getTimeline);
      expect(metadata).toEqual(['orders:read']);
    });
  });
  // ─── troca / devolução de item ────────────────────────────────────────
  describe('POST /orders/:id/exchange', () => {
    it('traduz o DTO no comando de troca, com o produto novo como replacement', async () => {
      const settlement = { paymentMethodId: 'pm-cash' };
      await controller.exchange(TENANT_ID, USER_ID, 'order-uuid-001', {
        orderItemId: 'item-001',
        newProductId: 'prod-002',
        newVariantId: 'var-g',
        quantity: 1,
        reason: 'Ficou pequena',
        settlement,
      });

      expect(adjustOrderItem.execute).toHaveBeenCalledWith(TENANT_ID, 'order-uuid-001', USER_ID, {
        orderItemId: 'item-001',
        quantity: 1,
        replacement: { productId: 'prod-002', variantId: 'var-g' },
        reason: 'Ficou pequena',
        settlement,
      });
    });

    it('should require orders:update permission', () => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.exchange)).toEqual(['orders:update']);
    });
  });

  describe('POST /orders/:id/return-item', () => {
    it('devolve sem replacement', async () => {
      const dto = { orderItemId: 'item-001', quantity: 1, reason: 'Defeito' };
      const result = await controller.returnItem(TENANT_ID, USER_ID, 'order-uuid-001', dto);

      expect(adjustOrderItem.execute).toHaveBeenCalledWith(TENANT_ID, 'order-uuid-001', USER_ID, dto);
      expect(result).toEqual({ success: true, data: { adjustmentId: 'adj-1' } });
    });

    it('should require orders:update permission', () => {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.returnItem)).toEqual(['orders:update']);
    });
  });
});
