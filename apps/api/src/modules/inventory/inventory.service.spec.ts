import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  CreateMovementDto,
  TransferStockDto,
  AdjustStockDto,
  UpdateWarehouseDto,
} from './dto/inventory.dto';

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT_A = 'tenant-aaa-111';
const TENANT_B = 'tenant-bbb-222';
const USER_ID = 'user-001';
const PRODUCT_ID = 'prod-001';
const VARIANT_ID = 'var-001';
const WAREHOUSE_A = 'wh-aaa';
const WAREHOUSE_B = 'wh-bbb';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInventoryItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ii-001',
    tenantId: TENANT_A,
    productId: PRODUCT_ID,
    variantId: null,
    warehouseId: WAREHOUSE_A,
    quantity: 100,
    reserved: 10,
    available: 90,
    minStock: 20,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeMovement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mov-001',
    tenantId: TENANT_A,
    productId: PRODUCT_ID,
    variantId: null,
    type: 'ENTRY',
    reason: 'PURCHASE',
    quantity: 10,
    fromWarehouseId: null,
    toWarehouseId: WAREHOUSE_A,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ─── Mock Factory ─────────────────────────────────────────────────────────────

function createMockPrisma() {
  const mockTx = {
    product: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ defaultMinStock: 0, name: 'Widget A', sku: 'SKU-001' }),
      // ADR 0004: toda entrada reprecifica o custo de cadastro do produto.
      update: jest.fn().mockResolvedValue({}),
    },
    // AE-12a: as mensagens de estoque dizem o depósito, então precisam lê-lo.
    warehouse: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Depósito Principal' }),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    inventoryItem: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
    inventoryMovement: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    stockAlert: {
      deleteMany: jest.fn(),
    },
  };

  return {
    product: {
      findFirst: jest.fn(),
    },
    inventoryItem: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      deleteMany: jest.fn(),
    },
    inventoryMovement: {
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    warehouse: {
      findFirst: jest.fn().mockResolvedValue({ name: 'Depósito Principal' }),
      findUnique: jest.fn().mockResolvedValue({ name: 'Depósito Principal' }),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    stockAlert: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    _tx: mockTx, // expose for test assertions
  };
}

function createMockEventEmitter() {
  return {
    emit: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    off: jest.fn(),
  };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('InventoryService', () => {
  let service: InventoryService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let eventEmitter: ReturnType<typeof createMockEventEmitter>;

  beforeEach(async () => {
    prisma = createMockPrisma();
    eventEmitter = createMockEventEmitter();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── findAll (getStock) ─────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return inventory items for tenant', async () => {
      const items = [makeInventoryItem()];
      prisma.inventoryItem.findMany.mockResolvedValue(items);
      prisma.inventoryItem.count.mockResolvedValue(1);

      const result = await service.findAll(TENANT_A, { page: 1, limit: 20 });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);

      const whereArg = prisma.inventoryItem.findMany.mock.calls[0][0].where;
      expect(whereArg.tenantId).toBe(TENANT_A);
    });

    it('should filter by warehouseId', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      prisma.inventoryItem.count.mockResolvedValue(0);

      await service.findAll(TENANT_A, { page: 1, limit: 20, warehouseId: WAREHOUSE_A });

      const whereArg = prisma.inventoryItem.findMany.mock.calls[0][0].where;
      expect(whereArg.warehouseId).toBe(WAREHOUSE_A);
    });

    it('should filter by productId', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      prisma.inventoryItem.count.mockResolvedValue(0);

      await service.findAll(TENANT_A, { page: 1, limit: 20, productId: PRODUCT_ID });

      const whereArg = prisma.inventoryItem.findMany.mock.calls[0][0].where;
      expect(whereArg.productId).toBe(PRODUCT_ID);
    });

    it('should search by product name or SKU', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      prisma.inventoryItem.count.mockResolvedValue(0);

      await service.findAll(TENANT_A, { page: 1, limit: 20, search: 'Widget' });

      const whereArg = prisma.inventoryItem.findMany.mock.calls[0][0].where;
      expect(whereArg.product).toBeDefined();
      expect(whereArg.product.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: { contains: 'Widget', mode: 'insensitive' } }),
          expect.objectContaining({ sku: { contains: 'Widget', mode: 'insensitive' } }),
        ]),
      );
    });

    it('should include product info via include', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      prisma.inventoryItem.count.mockResolvedValue(0);

      await service.findAll(TENANT_A, { page: 1, limit: 20 });

      const includeArg = prisma.inventoryItem.findMany.mock.calls[0][0].include;
      expect(includeArg.product).toBeDefined();
      expect(includeArg.warehouse).toBeDefined();
    });

    it('should NOT return items from other tenants', async () => {
      prisma.inventoryItem.findMany.mockResolvedValue([]);
      prisma.inventoryItem.count.mockResolvedValue(0);

      await service.findAll(TENANT_A, { page: 1, limit: 20 });

      const whereArg = prisma.inventoryItem.findMany.mock.calls[0][0].where;
      expect(whereArg.tenantId).toBe(TENANT_A);
      expect(whereArg.tenantId).not.toBe(TENANT_B);
    });
  });

  // ─── createMovement ─────────────────────────────────────────────────────

  describe('createMovement', () => {
    const tx = () => prisma._tx;

    beforeEach(() => {
      prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, sku: 'PRD-001', name: 'Widget' });
      // Default mock for checkAndUpdateAlerts after movement
      prisma.inventoryItem.findFirst.mockResolvedValue(makeInventoryItem({ available: 90, minStock: 20 }));
      prisma.stockAlert.updateMany.mockResolvedValue({ count: 0 });
    });

    it('ENTRY: should increase quantity and available', async () => {
      const existingItem = makeInventoryItem({ quantity: 100, available: 90 });
      tx().inventoryItem.findFirst.mockResolvedValue(existingItem);
      tx().inventoryItem.update.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement());

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'ENTRY',
        reason: 'PURCHASE',
        quantity: 20,
        toWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      expect(tx().inventoryMovement.create).toHaveBeenCalledTimes(1);
      const updateArgs = tx().inventoryItem.update.mock.calls[0][0];
      expect(updateArgs.data.quantity).toBe(120); // 100 + 20
      expect(updateArgs.data.available).toBe(110); // 90 + 20
    });

    // ─── Custo médio ────────────────────────────────────────────────────
    //
    // `costAverage` existia no schema e era exibido na tela do produto, mas
    // nenhum caminho de escrita o atualizava: a coluna "Custo Médio" mostrava
    // R$ 0,00 para todo produto, sempre.

    it('ENTRY: should compute the weighted average cost with the entry unit cost', async () => {
      // 100 un. a R$ 10,00 + 20 un. a R$ 16,00 = R$ 11,00 por unidade
      const existingItem = makeInventoryItem({
        quantity: 100,
        available: 90,
        costAverage: 10,
      });
      tx().inventoryItem.findFirst.mockResolvedValue(existingItem);
      tx().inventoryItem.update.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement());

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'ENTRY',
        reason: 'PURCHASE',
        quantity: 20,
        unitCost: 16,
        toWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      const updateArgs = tx().inventoryItem.update.mock.calls[0][0];
      expect(Number(updateArgs.data.costAverage)).toBe(11);
    });

    it('ENTRY: should fall back to the product cost price when the entry has no unit cost', async () => {
      tx().product.findUnique.mockResolvedValue({
        defaultMinStock: 0,
        name: 'Widget A',
        sku: 'SKU-001',
        costPrice: 25,
      });
      const existingItem = makeInventoryItem({
        quantity: 0,
        available: 0,
        costAverage: 0,
      });
      tx().inventoryItem.findFirst.mockResolvedValue(existingItem);
      tx().inventoryItem.update.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement());

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'ENTRY',
        reason: 'PURCHASE',
        quantity: 10,
        toWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      const updateArgs = tx().inventoryItem.update.mock.calls[0][0];
      expect(Number(updateArgs.data.costAverage)).toBe(25);
    });

    it('ENTRY: should seed the average cost of an item created by the first entry', async () => {
      tx().product.findUnique.mockResolvedValue({
        defaultMinStock: 5,
        name: 'Widget A',
        sku: 'SKU-001',
        costPrice: 0,
      });
      tx().inventoryItem.findFirst.mockResolvedValue(null);
      tx().inventoryItem.create.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement());

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'ENTRY',
        reason: 'PURCHASE',
        quantity: 8,
        unitCost: 12.5,
        toWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      const createArgs = tx().inventoryItem.create.mock.calls[0][0];
      expect(Number(createArgs.data.costAverage)).toBe(12.5);
    });

    it('EXIT: should keep the average cost untouched — a sale does not reprice the stock', async () => {
      const existingItem = makeInventoryItem({
        quantity: 100,
        available: 90,
        costAverage: 10,
      });
      tx().inventoryItem.findFirst.mockResolvedValue(existingItem);
      tx().inventoryItem.update.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'EXIT' }));

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'EXIT',
        reason: 'SALE',
        quantity: 10,
        fromWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      const updateArgs = tx().inventoryItem.update.mock.calls[0][0];
      expect(updateArgs.data.costAverage).toBeUndefined();
    });

    it('ENTRY: should not divide by zero when the entry costs nothing and the item is empty', async () => {
      tx().product.findUnique.mockResolvedValue({
        defaultMinStock: 0,
        name: 'Widget A',
        sku: 'SKU-001',
        costPrice: 0,
      });
      const existingItem = makeInventoryItem({
        quantity: 0,
        available: 0,
        costAverage: 0,
      });
      tx().inventoryItem.findFirst.mockResolvedValue(existingItem);
      tx().inventoryItem.update.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement());

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'ENTRY',
        reason: 'PURCHASE',
        quantity: 5,
        unitCost: 0,
        toWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      const updateArgs = tx().inventoryItem.update.mock.calls[0][0];
      expect(Number(updateArgs.data.costAverage)).toBe(0);
    });

    it('EXIT: should decrease quantity and available', async () => {
      const existingItem = makeInventoryItem({ quantity: 100, available: 90 });
      tx().inventoryItem.findFirst.mockResolvedValue(existingItem);
      tx().inventoryItem.update.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'EXIT' }));

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'EXIT',
        reason: 'SALE',
        quantity: 10,
        fromWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      const updateArgs = tx().inventoryItem.update.mock.calls[0][0];
      expect(updateArgs.data.quantity).toBe(90);  // 100 - 10
      expect(updateArgs.data.available).toBe(80); // 90 - 10
    });

    it('EXIT: should raise an out-of-stock alert when available reaches zero (minStock 0)', async () => {
      const existingItem = makeInventoryItem({ quantity: 10, available: 10, minStock: 0 });
      tx().inventoryItem.findFirst.mockResolvedValue(existingItem);
      tx().inventoryItem.update.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'EXIT' }));
      // checkAndUpdateAlerts reads the (non-tx) item after the movement: now zeroed
      prisma.inventoryItem.findFirst.mockResolvedValue(
        makeInventoryItem({ quantity: 0, available: 0, minStock: 0 }),
      );
      prisma.stockAlert.findFirst.mockResolvedValue(null);
      prisma.stockAlert.create.mockResolvedValue({});

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'EXIT',
        reason: 'SALE',
        quantity: 10,
        fromWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      expect(prisma.stockAlert.create).toHaveBeenCalledTimes(1);
      const alertArgs = prisma.stockAlert.create.mock.calls[0][0];
      expect(alertArgs.data.currentQty).toBe(0);
    });

    it('EXIT: should throw BadRequestException when insufficient stock', async () => {
      const existingItem = makeInventoryItem({ quantity: 5, available: 5 });
      tx().inventoryItem.findFirst.mockResolvedValue(existingItem);
      tx().inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'EXIT' }));

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'EXIT',
        reason: 'SALE',
        quantity: 10,
        fromWarehouseId: WAREHOUSE_A,
      };

      await expect(service.createMovement(TENANT_A, USER_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ADJUSTMENT: should apply positive delta when toWarehouseId is given', async () => {
      const existingItem = makeInventoryItem({ quantity: 50, available: 40 });
      tx().inventoryItem.findFirst.mockResolvedValue(existingItem);
      tx().inventoryItem.update.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'ADJUSTMENT' }));

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'ADJUSTMENT',
        reason: 'COUNT',
        quantity: 10,
        toWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      const updateArgs = tx().inventoryItem.update.mock.calls[0][0];
      expect(updateArgs.data.quantity).toBe(60); // 50 + 10
      expect(updateArgs.data.available).toBe(50); // 40 + 10
    });

    it('ADJUSTMENT: should apply negative delta when fromWarehouseId is given', async () => {
      const existingItem = makeInventoryItem({ quantity: 50, available: 40 });
      tx().inventoryItem.findFirst.mockResolvedValue(existingItem);
      tx().inventoryItem.update.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'ADJUSTMENT' }));

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'ADJUSTMENT',
        reason: 'ADJUSTMENT',
        quantity: 5,
        fromWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      const updateArgs = tx().inventoryItem.update.mock.calls[0][0];
      expect(updateArgs.data.quantity).toBe(45); // 50 - 5
      expect(updateArgs.data.available).toBe(35); // 40 - 5
    });

    it('should create InventoryMovement record', async () => {
      tx().inventoryItem.findFirst.mockResolvedValue(makeInventoryItem());
      tx().inventoryItem.update.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement());

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'ENTRY',
        reason: 'PURCHASE',
        quantity: 5,
        toWarehouseId: WAREHOUSE_A,
        unitCost: 10,
        notes: 'Test entry',
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      const createArgs = tx().inventoryMovement.create.mock.calls[0][0];
      expect(createArgs.data.tenantId).toBe(TENANT_A);
      expect(createArgs.data.productId).toBe(PRODUCT_ID);
      expect(createArgs.data.type).toBe('ENTRY');
      expect(createArgs.data.quantity).toBe(5);
      expect(createArgs.data.unitCost).toBe(10);
      expect(createArgs.data.totalCost).toBe(50); // 10 * 5
      expect(createArgs.data.userId).toBe(USER_ID);
    });

    it('should upsert InventoryItem if not exists', async () => {
      tx().inventoryItem.findFirst.mockResolvedValue(null); // No existing item
      tx().inventoryItem.create.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement());

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'ENTRY',
        reason: 'INITIAL',
        quantity: 25,
        toWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      expect(tx().inventoryItem.create).toHaveBeenCalledTimes(1);
      const createArgs = tx().inventoryItem.create.mock.calls[0][0];
      expect(createArgs.data.quantity).toBe(25);
      expect(createArgs.data.available).toBe(25);
      expect(createArgs.data.reserved).toBe(0);
      expect(createArgs.data.tenantId).toBe(TENANT_A);
    });

    // SCRUM-37: minStock lives on the item, but the product carries the default
    it('should seed the new item minStock from the product defaultMinStock', async () => {
      tx().product.findUnique.mockResolvedValue({ defaultMinStock: 15 });
      tx().inventoryItem.findFirst.mockResolvedValue(null);
      tx().inventoryItem.create.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement());

      await service.createMovement(TENANT_A, USER_ID, {
        productId: PRODUCT_ID,
        type: 'ENTRY',
        reason: 'INITIAL',
        quantity: 25,
        toWarehouseId: WAREHOUSE_A,
      } as CreateMovementDto);

      const createArgs = tx().inventoryItem.create.mock.calls[0][0];
      expect(createArgs.data.minStock).toBe(15);
    });

    it('should seed minStock as 0 when the product has no default', async () => {
      tx().product.findUnique.mockResolvedValue({ defaultMinStock: 0 });
      tx().inventoryItem.findFirst.mockResolvedValue(null);
      tx().inventoryItem.create.mockResolvedValue({});
      tx().inventoryMovement.create.mockResolvedValue(makeMovement());

      await service.createMovement(TENANT_A, USER_ID, {
        productId: PRODUCT_ID,
        type: 'ENTRY',
        reason: 'INITIAL',
        quantity: 25,
        toWarehouseId: WAREHOUSE_A,
      } as CreateMovementDto);

      const createArgs = tx().inventoryItem.create.mock.calls[0][0];
      expect(createArgs.data.minStock).toBe(0);
    });

    it('should throw NotFoundException when product not found', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      const dto: CreateMovementDto = {
        productId: 'non-existent',
        type: 'ENTRY',
        reason: 'PURCHASE',
        quantity: 10,
        toWarehouseId: WAREHOUSE_A,
      };

      await expect(service.createMovement(TENANT_A, USER_ID, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when creating item with negative quantity', async () => {
      tx().inventoryItem.findFirst.mockResolvedValue(null); // No existing item
      tx().inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'EXIT' }));

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'EXIT',
        reason: 'SALE',
        quantity: 10,
        fromWarehouseId: WAREHOUSE_A,
      };

      await expect(service.createMovement(TENANT_A, USER_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ENTRY: should throw BadRequestException when toWarehouseId is missing', async () => {
      tx().inventoryMovement.create.mockResolvedValue(makeMovement());

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'ENTRY',
        reason: 'PURCHASE',
        quantity: 10,
        // toWarehouseId intentionally missing
      };

      await expect(service.createMovement(TENANT_A, USER_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('EXIT: should throw BadRequestException when fromWarehouseId is missing', async () => {
      tx().inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'EXIT' }));

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'EXIT',
        reason: 'SALE',
        quantity: 10,
        // fromWarehouseId intentionally missing
      };

      await expect(service.createMovement(TENANT_A, USER_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── findMovements ──────────────────────────────────────────────────────

  // ─── SCRUM-36: movements must carry product, user and warehouse names ────
  describe('findMovements — flat DTO (SCRUM-36)', () => {
    /** Prisma row as returned with the relations included. */
    function makeRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'mov-1',
        productId: PRODUCT_ID,
        variantId: null,
        type: 'ENTRY',
        reason: 'PURCHASE',
        quantity: 10,
        notes: 'compra',
        userId: 'user-1',
        createdAt: new Date('2026-07-10'),
        product: { id: PRODUCT_ID, name: 'Widget', sku: 'SKU-001' },
        user: { id: 'user-1', name: 'Maria' },
        fromWarehouse: null,
        toWarehouse: { id: WAREHOUSE_A, name: 'Principal', code: 'W1' },
        ...overrides,
      };
    }

    beforeEach(() => {
      prisma.inventoryMovement.count.mockResolvedValue(1);
    });

    it('should include the product relation in the query', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([]);
      prisma.inventoryMovement.count.mockResolvedValue(0);

      await service.findMovements(TENANT_A, { page: 1, limit: 20 });

      const include = prisma.inventoryMovement.findMany.mock.calls[0][0].include;
      expect(include.product).toBeDefined();
    });

    it('should flatten product name and SKU', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([makeRow()]);

      const result = await service.findMovements(TENANT_A, { page: 1, limit: 20 });

      expect(result.data[0]).toMatchObject({
        productId: PRODUCT_ID,
        productName: 'Widget',
        productSku: 'SKU-001',
      });
    });

    it('should flatten the user name', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([makeRow()]);

      const result = await service.findMovements(TENANT_A, { page: 1, limit: 20 });

      expect(result.data[0]).toMatchObject({ userId: 'user-1', userName: 'Maria' });
    });

    it('should fall back to "Sistema" when the movement has no user (sale)', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([
        makeRow({ userId: null, user: null, reason: 'SALE', type: 'EXIT' }),
      ]);

      const result = await service.findMovements(TENANT_A, { page: 1, limit: 20 });

      expect(result.data[0]).toMatchObject({ userName: 'Sistema' });
    });

    it('should use the destination warehouse for an ENTRY', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([makeRow()]);

      const result = await service.findMovements(TENANT_A, { page: 1, limit: 20 });

      expect(result.data[0]).toMatchObject({
        warehouseId: WAREHOUSE_A,
        warehouseName: 'Principal',
      });
    });

    it('should use the origin warehouse for an EXIT', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([
        makeRow({
          type: 'EXIT',
          reason: 'SALE',
          toWarehouse: null,
          fromWarehouse: { id: WAREHOUSE_B, name: 'Filial', code: 'W2' },
        }),
      ]);

      const result = await service.findMovements(TENANT_A, { page: 1, limit: 20 });

      expect(result.data[0]).toMatchObject({
        warehouseId: WAREHOUSE_B,
        warehouseName: 'Filial',
      });
    });

    it('should filter by reason end to end', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([]);
      prisma.inventoryMovement.count.mockResolvedValue(0);

      await service.findMovements(TENANT_A, { page: 1, limit: 20, reason: 'SALE' });

      const whereArg = prisma.inventoryMovement.findMany.mock.calls[0][0].where;
      expect(whereArg.reason).toBe('SALE');
    });
  });

  describe('findMovements', () => {
    it('should return paginated movement history', async () => {
      const movements = [makeMovement()];
      prisma.inventoryMovement.findMany.mockResolvedValue(movements);
      prisma.inventoryMovement.count.mockResolvedValue(1);

      const result = await service.findMovements(TENANT_A, { page: 1, limit: 20 });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);

      const whereArg = prisma.inventoryMovement.findMany.mock.calls[0][0].where;
      expect(whereArg.tenantId).toBe(TENANT_A);
    });

    it('should filter by type', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([]);
      prisma.inventoryMovement.count.mockResolvedValue(0);

      await service.findMovements(TENANT_A, { page: 1, limit: 20, type: 'EXIT' });

      const whereArg = prisma.inventoryMovement.findMany.mock.calls[0][0].where;
      expect(whereArg.type).toBe('EXIT');
    });

    it('should filter by warehouseId (from or to)', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([]);
      prisma.inventoryMovement.count.mockResolvedValue(0);

      await service.findMovements(TENANT_A, { page: 1, limit: 20, warehouseId: WAREHOUSE_A });

      const whereArg = prisma.inventoryMovement.findMany.mock.calls[0][0].where;
      expect(whereArg.OR).toEqual([
        { fromWarehouseId: WAREHOUSE_A },
        { toWarehouseId: WAREHOUSE_A },
      ]);
    });

    it('should filter by date range', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([]);
      prisma.inventoryMovement.count.mockResolvedValue(0);

      await service.findMovements(TENANT_A, {
        page: 1,
        limit: 20,
        dateFrom: '2026-01-01',
        dateTo: '2026-03-31',
      });

      // Whole civil days in the tenant timezone: `new Date('2026-03-31')` is
      // midnight *starting* the last day, which dropped it from the range.
      const whereArg = prisma.inventoryMovement.findMany.mock.calls[0][0].where;
      expect(whereArg.createdAt.gte).toEqual(new Date('2026-01-01T03:00:00.000Z'));
      expect(whereArg.createdAt.lte).toEqual(new Date('2026-04-01T02:59:59.999Z'));
    });

    it('should include a movement made late in the evening of the last day', async () => {
      prisma.inventoryMovement.findMany.mockResolvedValue([]);
      prisma.inventoryMovement.count.mockResolvedValue(0);

      await service.findMovements(TENANT_A, {
        page: 1,
        limit: 20,
        dateFrom: '2026-07-31',
        dateTo: '2026-07-31',
      });

      const { gte, lte } = prisma.inventoryMovement.findMany.mock.calls[0][0].where.createdAt;
      const lateMovement = new Date('2026-08-01T02:50:00.000Z'); // 23:50 of 31/07 in -03

      expect(lateMovement >= gte && lateMovement <= lte).toBe(true);
    });
  });

  // ─── reserveStock ───────────────────────────────────────────────────────

  describe('reserveStock', () => {
    it('should increase reserved and decrease available', async () => {
      const item = makeInventoryItem({ available: 90, reserved: 10, minStock: 0 });
      prisma.inventoryItem.findFirst.mockResolvedValue(item);
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.inventoryItem.findUnique.mockResolvedValue({ ...item, available: 80, reserved: 20, minStock: 0 });

      await service.reserveStock(TENANT_A, PRODUCT_ID, null, 10);

      expect(prisma.inventoryItem.update).toHaveBeenCalledWith({
        where: { id: 'ii-001' },
        data: {
          reserved: { increment: 10 },
          available: { decrement: 10 },
        },
      });
    });

    it('should gracefully skip when insufficient available stock', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null); // No item with enough stock

      // Should NOT throw
      await expect(
        service.reserveStock(TENANT_A, PRODUCT_ID, null, 9999),
      ).resolves.toBeUndefined();

      expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    });

    it('should work correctly with variantId', async () => {
      const item = makeInventoryItem({ variantId: VARIANT_ID, available: 50, minStock: 0 });
      prisma.inventoryItem.findFirst.mockResolvedValue(item);
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.inventoryItem.findUnique.mockResolvedValue({ ...item, available: 40, reserved: 20, minStock: 0 });

      await service.reserveStock(TENANT_A, PRODUCT_ID, VARIANT_ID, 10);

      const findArgs = prisma.inventoryItem.findFirst.mock.calls[0][0];
      expect(findArgs.where.variantId).toBe(VARIANT_ID);
      expect(findArgs.where.tenantId).toBe(TENANT_A);
    });

    it('should NOT affect other tenants stock', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await service.reserveStock(TENANT_A, PRODUCT_ID, null, 5);

      const findArgs = prisma.inventoryItem.findFirst.mock.calls[0][0];
      expect(findArgs.where.tenantId).toBe(TENANT_A);
    });

    it('should trigger low stock alert when available drops below minStock', async () => {
      const item = makeInventoryItem({ available: 25, reserved: 5, minStock: 20 });
      prisma.inventoryItem.findFirst.mockResolvedValue(item);
      prisma.inventoryItem.update.mockResolvedValue({});
      // After reservation: available = 15 which is <= minStock(20)
      prisma.inventoryItem.findUnique.mockResolvedValue({
        ...item,
        available: 15,
        reserved: 15,
        minStock: 20,
      });
      prisma.stockAlert.findFirst.mockResolvedValue(null); // No existing alert
      prisma.stockAlert.create.mockResolvedValue({});

      await service.reserveStock(TENANT_A, PRODUCT_ID, null, 10);

      expect(prisma.stockAlert.create).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'stock.low',
        expect.objectContaining({
          tenantId: TENANT_A,
          productId: PRODUCT_ID,
          currentQty: 15,
          minStock: 20,
        }),
      );
    });
  });

  // ─── fulfillReservedStock ─────────────────────────────────────────────────

  describe('fulfillReservedStock', () => {
    beforeEach(() => {
      // fulfillReservedStock runs checkAndUpdateAlerts after the movement
      prisma.stockAlert.updateMany.mockResolvedValue({ count: 0 });
      prisma.stockAlert.findFirst.mockResolvedValue(null);
      prisma.stockAlert.create.mockResolvedValue({});
    });

    it('should decrement reserved and quantity and create an EXIT/SALE movement', async () => {
      const item = makeInventoryItem({ quantity: 100, reserved: 20, available: 80 });
      prisma.inventoryItem.findFirst.mockResolvedValue(item);
      prisma._tx.inventoryItem.update.mockResolvedValue({});
      prisma._tx.inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'EXIT', reason: 'SALE' }));

      await service.fulfillReservedStock(TENANT_A, PRODUCT_ID, null, 5, 'order-uuid-001');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma._tx.inventoryItem.update).toHaveBeenCalledWith({
        where: { id: 'ii-001' },
        data: {
          reserved: { decrement: 5 },
          quantity: { decrement: 5 },
        },
      });

      const movementArgs = prisma._tx.inventoryMovement.create.mock.calls[0][0];
      expect(movementArgs.data).toEqual(
        expect.objectContaining({
          tenantId: TENANT_A,
          productId: PRODUCT_ID,
          type: 'EXIT',
          reason: 'SALE',
          quantity: 5,
          fromWarehouseId: WAREHOUSE_A,
          referenceType: 'ORDER',
          referenceId: 'order-uuid-001',
        }),
      );
    });

    it('should query the reservation scoped by tenant, preferring the default warehouse', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(makeInventoryItem({ reserved: 10 }));
      prisma._tx.inventoryItem.update.mockResolvedValue({});
      prisma._tx.inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'EXIT' }));

      await service.fulfillReservedStock(TENANT_A, PRODUCT_ID, VARIANT_ID, 3, 'order-uuid-001');

      const findArgs = prisma.inventoryItem.findFirst.mock.calls[0][0];
      expect(findArgs.where.tenantId).toBe(TENANT_A);
      expect(findArgs.where.variantId).toBe(VARIANT_ID);
      expect(findArgs.where.reserved).toEqual({ gte: 3 });
      expect(findArgs.orderBy).toEqual({ warehouse: { isDefault: 'desc' } });
    });

    it('should gracefully skip (no movement) when there is no matching reservation', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(
        service.fulfillReservedStock(TENANT_A, PRODUCT_ID, null, 5, 'order-uuid-001'),
      ).resolves.toBeUndefined();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma._tx.inventoryMovement.create).not.toHaveBeenCalled();
    });
  });

  // ─── releaseStock ───────────────────────────────────────────────────────

  describe('releaseStock', () => {
    it('should decrease reserved and increase available', async () => {
      const item = makeInventoryItem({ available: 80, reserved: 20, minStock: 0 });
      prisma.inventoryItem.findFirst.mockResolvedValue(item);
      prisma.inventoryItem.update.mockResolvedValue({});
      prisma.inventoryItem.findUnique.mockResolvedValue({ ...item, available: 90, reserved: 10, minStock: 0 });

      await service.releaseStock(TENANT_A, PRODUCT_ID, null, 10);

      expect(prisma.inventoryItem.update).toHaveBeenCalledWith({
        where: { id: 'ii-001' },
        data: {
          reserved: { decrement: 10 },
          available: { increment: 10 },
        },
      });
    });

    it('should gracefully skip when no matching reservation found', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      // Should NOT throw
      await expect(
        service.releaseStock(TENANT_A, PRODUCT_ID, null, 100),
      ).resolves.toBeUndefined();

      expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    });

    it('should scope query by tenantId', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await service.releaseStock(TENANT_A, PRODUCT_ID, null, 5);

      const findArgs = prisma.inventoryItem.findFirst.mock.calls[0][0];
      expect(findArgs.where.tenantId).toBe(TENANT_A);
    });
  });

  // ─── transferStock ──────────────────────────────────────────────────────

  describe('stock messages (AE-12a)', () => {
    // O usuário via "Insufficient stock. Current: 19, Change: -999" — em
    // inglês e sem dizer de qual depósito é esse 19.
    it('says the product, the warehouse and both numbers, in Portuguese', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, type: 'SIMPLE' });
      prisma._tx.inventoryItem.findFirst.mockResolvedValue({
        id: 'ii-1',
        quantity: 19,
        available: 19,
      });
      prisma._tx.warehouse.findUnique.mockResolvedValue({ name: 'Makeimports' });
      prisma._tx.product.findUnique.mockResolvedValue({
        name: 'Widget A',
        sku: 'SKU-001',
      });

      await expect(
        service.createMovement(TENANT_A, USER_ID, {
          productId: PRODUCT_ID,
          type: 'EXIT',
          quantity: 999,
          fromWarehouseId: WAREHOUSE_A,
        } as never),
      ).rejects.toThrow(/Estoque insuficiente.*Makeimports.*19.*999/s);
    });

    it('explains an exit from a product with no stock at all', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, type: 'SIMPLE' });
      prisma._tx.inventoryItem.findFirst.mockResolvedValue(null);
      prisma._tx.warehouse.findUnique.mockResolvedValue({ name: 'Makeimports' });

      await expect(
        service.createMovement(TENANT_A, USER_ID, {
          productId: PRODUCT_ID,
          type: 'EXIT',
          quantity: 5,
          fromWarehouseId: WAREHOUSE_A,
        } as never),
      ).rejects.toThrow(/ainda não tem estoque.*Makeimports/s);
    });

    it('names the source warehouse when a transfer does not fit', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, type: 'SIMPLE' });
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'ii-1', available: 3 });
      prisma.warehouse.findFirst.mockResolvedValue({ name: 'Makeimports' });

      await expect(
        service.transferStock(TENANT_A, USER_ID, {
          productId: PRODUCT_ID,
          fromWarehouseId: WAREHOUSE_A,
          toWarehouseId: WAREHOUSE_B,
          quantity: 10,
        } as never),
      ).rejects.toThrow(/Estoque insuficiente.*Makeimports.*3.*10/s);
    });
  });

  describe('transferStock', () => {
    const baseTransferDto: TransferStockDto = {
      productId: PRODUCT_ID,
      fromWarehouseId: WAREHOUSE_A,
      toWarehouseId: WAREHOUSE_B,
      quantity: 10,
    };

    beforeEach(() => {
      prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, sku: 'PRD-001' });
      // Default mock for checkAndUpdateAlerts: item above minStock, no alerts needed
      prisma.inventoryItem.findFirst.mockResolvedValue(makeInventoryItem({ available: 90, minStock: 20 }));
      prisma.stockAlert.updateMany.mockResolvedValue({ count: 0 });
    });

    it('should decrease stock in source warehouse and increase in destination', async () => {
      const sourceItem = makeInventoryItem({ warehouseId: WAREHOUSE_A, quantity: 100, available: 90 });
      prisma.inventoryItem.findFirst.mockResolvedValue(sourceItem);

      const tx = prisma._tx;
      // Source lookup
      tx.inventoryItem.findFirst
        .mockResolvedValueOnce(sourceItem) // source upsert lookup
        .mockResolvedValueOnce(makeInventoryItem({ warehouseId: WAREHOUSE_B, quantity: 50, available: 50 })); // dest upsert lookup
      tx.inventoryItem.update.mockResolvedValue({});
      tx.inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'TRANSFER' }));

      await service.transferStock(TENANT_A, USER_ID, baseTransferDto);

      // Source: quantity 100 - 10 = 90, available 90 - 10 = 80
      const sourceUpdateArgs = tx.inventoryItem.update.mock.calls[0][0];
      expect(sourceUpdateArgs.data.quantity).toBe(90);
      expect(sourceUpdateArgs.data.available).toBe(80);

      // Destination: quantity 50 + 10 = 60, available 50 + 10 = 60
      const destUpdateArgs = tx.inventoryItem.update.mock.calls[1][0];
      expect(destUpdateArgs.data.quantity).toBe(60);
      expect(destUpdateArgs.data.available).toBe(60);
    });

    it('should create a TRANSFER movement record', async () => {
      const sourceItem = makeInventoryItem({ available: 90 });
      prisma.inventoryItem.findFirst.mockResolvedValue(sourceItem);

      const tx = prisma._tx;
      tx.inventoryItem.findFirst.mockResolvedValue(makeInventoryItem());
      tx.inventoryItem.update.mockResolvedValue({});
      tx.inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'TRANSFER' }));

      await service.transferStock(TENANT_A, USER_ID, baseTransferDto);

      const movementArgs = tx.inventoryMovement.create.mock.calls[0][0];
      expect(movementArgs.data.type).toBe('TRANSFER');
      expect(movementArgs.data.fromWarehouseId).toBe(WAREHOUSE_A);
      expect(movementArgs.data.toWarehouseId).toBe(WAREHOUSE_B);
      expect(movementArgs.data.quantity).toBe(10);
      expect(movementArgs.data.tenantId).toBe(TENANT_A);
    });

    it('should throw BadRequestException when insufficient stock in source', async () => {
      const sourceItem = makeInventoryItem({ available: 5 });
      prisma.inventoryItem.findFirst.mockResolvedValue(sourceItem);

      const dto: TransferStockDto = { ...baseTransferDto, quantity: 10 };

      await expect(service.transferStock(TENANT_A, USER_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when source has no inventory item', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(service.transferStock(TENANT_A, USER_ID, baseTransferDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when source and destination are the same', async () => {
      const dto: TransferStockDto = {
        ...baseTransferDto,
        fromWarehouseId: WAREHOUSE_A,
        toWarehouseId: WAREHOUSE_A,
      };

      await expect(service.transferStock(TENANT_A, USER_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when product not found', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.transferStock(TENANT_A, USER_ID, baseTransferDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should use $transaction to ensure atomicity', async () => {
      const sourceItem = makeInventoryItem({ available: 90 });
      prisma.inventoryItem.findFirst.mockResolvedValue(sourceItem);

      const tx = prisma._tx;
      tx.inventoryItem.findFirst.mockResolvedValue(makeInventoryItem());
      tx.inventoryItem.update.mockResolvedValue({});
      tx.inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'TRANSFER' }));

      await service.transferStock(TENANT_A, USER_ID, baseTransferDto);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should rollback if transaction callback throws', async () => {
      const sourceItem = makeInventoryItem({ available: 90 });
      prisma.inventoryItem.findFirst.mockResolvedValue(sourceItem);

      // Make the transaction fail
      prisma.$transaction.mockRejectedValue(new Error('DB connection lost'));

      await expect(service.transferStock(TENANT_A, USER_ID, baseTransferDto)).rejects.toThrow(
        'DB connection lost',
      );
    });

    it('should verify tenant isolation on transfer', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.transferStock(TENANT_A, USER_ID, baseTransferDto),
      ).rejects.toThrow(NotFoundException);

      const findArgs = prisma.product.findFirst.mock.calls[0][0];
      expect(findArgs.where.tenantId).toBe(TENANT_A);
    });
  });

  // ─── getLowStockAlerts ──────────────────────────────────────────────────

  describe('getLowStockAlerts', () => {
    /** Prisma row as returned with the relations included. */
    function makeAlertRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'alert-1',
        productId: PRODUCT_ID,
        variantId: null,
        warehouseId: WAREHOUSE_A,
        currentQty: 3,
        minStock: 20,
        isResolved: false,
        resolvedAt: null,
        createdAt: new Date('2026-07-10'),
        product: { id: PRODUCT_ID, name: 'Widget', sku: 'PRD-001' },
        warehouse: { id: WAREHOUSE_A, name: 'Main', code: 'MAIN' },
        ...overrides,
      };
    }

    beforeEach(() => {
      prisma.stockAlert.count.mockResolvedValue(1);
    });

    it('should include the product and warehouse relations in the query', async () => {
      prisma.stockAlert.findMany.mockResolvedValue([]);
      prisma.stockAlert.count.mockResolvedValue(0);

      await service.getLowStockAlerts(TENANT_A, {});

      const include = prisma.stockAlert.findMany.mock.calls[0][0].include;
      expect(include.product).toBeDefined();
      expect(include.warehouse).toBeDefined();
    });

    // SCRUM-38: the table reads flat fields; the model only stores ids + currentQty
    it('should flatten product, warehouse and stock into the DTO', async () => {
      prisma.stockAlert.findMany.mockResolvedValue([makeAlertRow()]);

      const result = await service.getLowStockAlerts(TENANT_A, {});

      expect(result.data[0]).toMatchObject({
        productId: PRODUCT_ID,
        productName: 'Widget',
        productSku: 'PRD-001',
        warehouseId: WAREHOUSE_A,
        warehouseName: 'Main',
        currentStock: 3,
        minStock: 20,
      });
    });

    // SCRUM-39: the API never returned `status`, so every alert rendered "Resolvido"
    it('should derive status ACTIVE from isResolved = false', async () => {
      prisma.stockAlert.findMany.mockResolvedValue([makeAlertRow({ isResolved: false })]);

      const result = await service.getLowStockAlerts(TENANT_A, {});

      expect(result.data[0]).toMatchObject({ status: 'ACTIVE', isResolved: false });
    });

    it('should derive status RESOLVED from isResolved = true', async () => {
      prisma.stockAlert.findMany.mockResolvedValue([
        makeAlertRow({ isResolved: true, resolvedAt: new Date('2026-07-12') }),
      ]);

      const result = await service.getLowStockAlerts(TENANT_A, {});

      expect(result.data[0]).toMatchObject({ status: 'RESOLVED', isResolved: true });
      expect(result.data[0].resolvedAt).toEqual(new Date('2026-07-12'));
    });

    it('should scope the query by tenant', async () => {
      prisma.stockAlert.findMany.mockResolvedValue([]);
      prisma.stockAlert.count.mockResolvedValue(0);

      await service.getLowStockAlerts(TENANT_B, {});

      const where = prisma.stockAlert.findMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe(TENANT_B);
    });
  });

  // ─── setMinStock ─────────────────────────────────────────────────────

  describe('setMinStock', () => {
    it('should throw NotFoundException when the item does not exist', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(service.setMinStock(TENANT_A, 'ii-missing', 10)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    });

    it('should update minStock and raise an alert when now below threshold', async () => {
      prisma.inventoryItem.findFirst
        .mockResolvedValueOnce(makeInventoryItem({ available: 5, minStock: 0 })) // lookup
        .mockResolvedValueOnce(makeInventoryItem({ available: 5, minStock: 10 })); // checkAndUpdateAlerts
      prisma.inventoryItem.update.mockResolvedValue(
        makeInventoryItem({ available: 5, minStock: 10 }),
      );
      prisma.stockAlert.findFirst.mockResolvedValue(null);
      prisma.stockAlert.create.mockResolvedValue({});
      prisma.stockAlert.updateMany.mockResolvedValue({ count: 0 });

      await service.setMinStock(TENANT_A, 'ii-001', 10);

      expect(prisma.inventoryItem.update).toHaveBeenCalledWith({
        where: { id: 'ii-001' },
        data: { minStock: 10 },
      });
      expect(prisma.stockAlert.create).toHaveBeenCalledTimes(1);
    });

    it('should scope the lookup by tenantId', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(null);

      await expect(service.setMinStock(TENANT_A, 'ii-1', 5)).rejects.toThrow();

      const whereArg = prisma.inventoryItem.findFirst.mock.calls[0][0].where;
      expect(whereArg.tenantId).toBe(TENANT_A);
      expect(whereArg.id).toBe('ii-1');
    });
  });

  // ─── checkLowStock ─────────────────────────────────────────────────────

  describe('checkLowStock', () => {
    it('should find items where available <= minStock and create alerts', async () => {
      const lowStockItems = [
        { productId: PRODUCT_ID, variantId: null, warehouseId: WAREHOUSE_A, available: 5, minStock: 20 },
      ];
      prisma.$queryRaw.mockResolvedValue(lowStockItems);
      prisma.stockAlert.findFirst.mockResolvedValue(null); // No existing alert
      prisma.stockAlert.create.mockResolvedValue({});

      await service.checkLowStock(TENANT_A);

      expect(prisma.stockAlert.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.stockAlert.create.mock.calls[0][0];
      expect(createArgs.data.tenantId).toBe(TENANT_A);
      expect(createArgs.data.productId).toBe(PRODUCT_ID);
      expect(createArgs.data.currentQty).toBe(5);
      expect(createArgs.data.minStock).toBe(20);
    });

    it('should emit STOCK_LOW event for each low stock item', async () => {
      const lowStockItems = [
        { productId: PRODUCT_ID, variantId: null, warehouseId: WAREHOUSE_A, available: 3, minStock: 10 },
      ];
      prisma.$queryRaw.mockResolvedValue(lowStockItems);
      prisma.stockAlert.findFirst.mockResolvedValue(null);
      prisma.stockAlert.create.mockResolvedValue({});

      await service.checkLowStock(TENANT_A);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'stock.low',
        expect.objectContaining({
          eventName: 'stock.low',
          tenantId: TENANT_A,
          productId: PRODUCT_ID,
          currentQty: 3,
          minStock: 10,
        }),
      );
    });

    it('should not create duplicate alerts for same product/warehouse', async () => {
      const lowStockItems = [
        { productId: PRODUCT_ID, variantId: null, warehouseId: WAREHOUSE_A, available: 5, minStock: 20 },
      ];
      prisma.$queryRaw.mockResolvedValue(lowStockItems);
      prisma.stockAlert.findFirst.mockResolvedValue({ id: 'alert-existing', isResolved: false }); // Already exists

      await service.checkLowStock(TENANT_A);

      expect(prisma.stockAlert.create).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should handle empty low stock results gracefully', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await service.checkLowStock(TENANT_A);

      expect(prisma.stockAlert.create).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should process multiple low stock items', async () => {
      const lowStockItems = [
        { productId: 'prod-001', variantId: null, warehouseId: WAREHOUSE_A, available: 1, minStock: 10 },
        { productId: 'prod-002', variantId: null, warehouseId: WAREHOUSE_B, available: 3, minStock: 15 },
      ];
      prisma.$queryRaw.mockResolvedValue(lowStockItems);
      prisma.stockAlert.findFirst.mockResolvedValue(null);
      prisma.stockAlert.create.mockResolvedValue({});

      await service.checkLowStock(TENANT_A);

      expect(prisma.stockAlert.create).toHaveBeenCalledTimes(2);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Edge Cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    beforeEach(() => {
      // Default mock for checkAndUpdateAlerts after movement
      prisma.inventoryItem.findFirst.mockResolvedValue(makeInventoryItem({ available: 90, minStock: 20 }));
      prisma.stockAlert.updateMany.mockResolvedValue({ count: 0 });
    });

    it('should handle zero quantity in inventory item', async () => {
      const tx = prisma._tx;
      const existingItem = makeInventoryItem({ quantity: 0, available: 0 });
      tx.inventoryItem.findFirst.mockResolvedValue(existingItem);
      tx.inventoryItem.update.mockResolvedValue({});
      tx.inventoryMovement.create.mockResolvedValue(makeMovement());
      prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, sku: 'PRD-001', name: 'Widget' });

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'ENTRY',
        reason: 'PURCHASE',
        quantity: 5,
        toWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      const updateArgs = tx.inventoryItem.update.mock.calls[0][0];
      expect(updateArgs.data.quantity).toBe(5);
      expect(updateArgs.data.available).toBe(5);
    });

    it('should handle RETURN movement type like ENTRY', async () => {
      const tx = prisma._tx;
      tx.inventoryItem.findFirst.mockResolvedValue(makeInventoryItem());
      tx.inventoryItem.update.mockResolvedValue({});
      tx.inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'RETURN' }));
      prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, sku: 'PRD-001', name: 'Widget' });

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'RETURN',
        reason: 'RETURN_CUSTOMER',
        quantity: 3,
        toWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      // RETURN should increase stock like ENTRY
      const updateArgs = tx.inventoryItem.update.mock.calls[0][0];
      expect(updateArgs.data.quantity).toBe(103); // 100 + 3
    });

    it('should handle PRODUCTION movement type like ENTRY', async () => {
      const tx = prisma._tx;
      tx.inventoryItem.findFirst.mockResolvedValue(makeInventoryItem());
      tx.inventoryItem.update.mockResolvedValue({});
      tx.inventoryMovement.create.mockResolvedValue(makeMovement({ type: 'PRODUCTION' }));
      prisma.product.findFirst.mockResolvedValue({ id: PRODUCT_ID, sku: 'PRD-001', name: 'Widget' });

      const dto: CreateMovementDto = {
        productId: PRODUCT_ID,
        type: 'PRODUCTION',
        reason: 'PRODUCTION',
        quantity: 20,
        toWarehouseId: WAREHOUSE_A,
      };
      await service.createMovement(TENANT_A, USER_ID, dto);

      const updateArgs = tx.inventoryItem.update.mock.calls[0][0];
      expect(updateArgs.data.quantity).toBe(120); // 100 + 20
    });
  });

  // ─── getWarehouses ────────────────────────────────────────────────────

  describe('getWarehouses', () => {
    beforeEach(() => {
      // Need warehouse mock on prisma
      (prisma as any).warehouse = {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      // AE-12c: marcar um padrão rebaixa os outros na mesma transação.
      (prisma as any).$transaction = jest.fn(async (cb: unknown) =>
        typeof cb === 'function'
          ? (cb as (tx: unknown) => unknown)((prisma as any))
          : cb,
      );
    });

    // ─── AE-12a: mensagem de estoque em pt-BR e acionável ──────────────

    it('returns productCount, the field the card reads (AE-12b)', async () => {
      (prisma as any).warehouse.findMany.mockResolvedValue([
        {
          id: 'wh-1',
          name: 'Depósito SP',
          city: 'São Paulo',
          state: 'SP',
          _count: { inventoryItems: 12 },
        },
      ]);
      (prisma as any).warehouse.count.mockResolvedValue(1);

      const result = await service.getWarehouses(TENANT_A, {} as never);

      expect(result.data[0]).toMatchObject({
        city: 'São Paulo',
        state: 'SP',
        productCount: 12,
      });
      expect((result.data[0] as Record<string, unknown>)._count).toBeUndefined();
    });

    // ─── AE-12b: o card lia campos que a API não devolvia ───────────

    it('stores city, state and zip as their own fields (AE-12b)', async () => {
      // O serviço concatenava tudo em `address` e o card exibia ", -", porque
      // lia `city` e `state` — que nunca existiram na resposta.
      (prisma as any).warehouse.create.mockResolvedValue({ id: 'wh-new' });

      await service.createWarehouse(TENANT_A, {
        name: 'Depósito SP',
        address: 'Rua A, 100',
        city: 'São Paulo',
        state: 'SP',
        zipCode: '01000-000',
      } as never);

      const data = (prisma as any).warehouse.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        address: 'Rua A, 100',
        city: 'São Paulo',
        state: 'SP',
        zipCode: '01000-000',
      });
    });

    it('does not smash the parts into the address string', async () => {
      (prisma as any).warehouse.create.mockResolvedValue({ id: 'wh-new' });

      await service.createWarehouse(TENANT_A, {
        name: 'Depósito SP',
        address: 'Rua A, 100',
        city: 'São Paulo',
        state: 'SP',
      } as never);

      const data = (prisma as any).warehouse.create.mock.calls[0][0].data;
      expect(data.address).toBe('Rua A, 100');
    });

  // ─── AE-12c: só pode existir um depósito padrão ────────────────────

    it('demotes the previous default when a new one is marked', async () => {
      // A tela chegou a exibir **três** depósitos "Padrão", tornando ambíguo
      // qual deles vendas e balcão usam.
      (prisma as any).warehouse.create.mockResolvedValue({ id: 'wh-new' });

      await service.createWarehouse(TENANT_A, {
        name: 'Novo Padrão',
        isDefault: true,
      } as never);

      const args = (prisma as any).warehouse.updateMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ tenantId: TENANT_A, isDefault: true });
      expect(args.data).toEqual({ isDefault: false });
    });

    it('does not touch the other warehouses when the new one is not default', async () => {
      (prisma as any).warehouse.create.mockResolvedValue({ id: 'wh-new' });

      await service.createWarehouse(TENANT_A, {
        name: 'Secundário',
        isDefault: false,
      } as never);

      expect((prisma as any).warehouse.updateMany).not.toHaveBeenCalled();
    });

    it('demotes only inside the tenant', async () => {
      (prisma as any).warehouse.create.mockResolvedValue({ id: 'wh-new' });

      await service.createWarehouse(TENANT_A, {
        name: 'Padrão',
        isDefault: true,
      } as never);

      const args = (prisma as any).warehouse.updateMany.mock.calls[0][0];
      expect(args.where.tenantId).toBe(TENANT_A);
    });

    it('demotes and creates in the same transaction', async () => {
      (prisma as any).warehouse.create.mockResolvedValue({ id: 'wh-new' });

      await service.createWarehouse(TENANT_A, {
        name: 'Padrão',
        isDefault: true,
      } as never);

      // Sem transação, uma falha no meio deixaria zero depósitos padrão.
      expect((prisma as any).$transaction).toHaveBeenCalled();
    });

    it('should return paginated warehouses for tenant', async () => {
      const warehouses = [
        { id: 'wh-001', name: 'Deposito Principal', code: 'DEP-001', address: 'Rua A, 1', isDefault: true, createdAt: new Date(), updatedAt: new Date() },
      ];
      (prisma as any).warehouse.findMany.mockResolvedValue(warehouses);
      (prisma as any).warehouse.count.mockResolvedValue(1);

      const result = await service.getWarehouses(TENANT_A, { page: 1, limit: 20 });

      expect(result.success).toBe(true);
      // `productCount` entra na resposta (AE-12b); o resto do depósito é o mesmo.
      expect(result.data).toEqual([{ ...warehouses[0], productCount: 0 }]);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });

    it('should scope query by tenantId', async () => {
      (prisma as any).warehouse.findMany.mockResolvedValue([]);
      (prisma as any).warehouse.count.mockResolvedValue(0);

      await service.getWarehouses(TENANT_A, { page: 1, limit: 20 });

      const whereArg = (prisma as any).warehouse.findMany.mock.calls[0][0].where;
      expect(whereArg.tenantId).toBe(TENANT_A);
    });

    it('should NOT return warehouses from other tenants', async () => {
      (prisma as any).warehouse.findMany.mockResolvedValue([]);
      (prisma as any).warehouse.count.mockResolvedValue(0);

      await service.getWarehouses(TENANT_A, { page: 1, limit: 20 });

      const whereArg = (prisma as any).warehouse.findMany.mock.calls[0][0].where;
      expect(whereArg.tenantId).toBe(TENANT_A);
      expect(whereArg.tenantId).not.toBe(TENANT_B);
    });

    it('should apply pagination (skip and take)', async () => {
      (prisma as any).warehouse.findMany.mockResolvedValue([]);
      (prisma as any).warehouse.count.mockResolvedValue(0);

      await service.getWarehouses(TENANT_A, { page: 2, limit: 10 });

      const call = (prisma as any).warehouse.findMany.mock.calls[0][0];
      expect(call.skip).toBe(10); // (2-1) * 10
      expect(call.take).toBe(10);
    });

    it('should order by createdAt desc', async () => {
      (prisma as any).warehouse.findMany.mockResolvedValue([]);
      (prisma as any).warehouse.count.mockResolvedValue(0);

      await service.getWarehouses(TENANT_A, { page: 1, limit: 20 });

      const call = (prisma as any).warehouse.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  // ─── createWarehouse ──────────────────────────────────────────────────

  describe('createWarehouse', () => {
    beforeEach(() => {
      (prisma as any).warehouse = {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
      // AE-12c: marcar um padrão rebaixa os outros na mesma transação.
      (prisma as any).$transaction = jest.fn(async (cb: unknown) =>
        typeof cb === 'function'
          ? (cb as (tx: unknown) => unknown)((prisma as any))
          : cb,
      );
    });

    // ─── AE-12c: só pode existir um depósito padrão ────────────────────

    it('demotes the previous default when a new one is marked', async () => {
      // A tela chegou a exibir **três** depósitos "Padrão", tornando ambíguo
      // qual deles vendas e balcão usam.
      (prisma as any).warehouse.create.mockResolvedValue({ id: 'wh-new' });

      await service.createWarehouse(TENANT_A, {
        name: 'Novo Padrão',
        isDefault: true,
      } as never);

      const args = (prisma as any).warehouse.updateMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ tenantId: TENANT_A, isDefault: true });
      expect(args.data).toEqual({ isDefault: false });
    });

    it('does not touch the other warehouses when the new one is not default', async () => {
      (prisma as any).warehouse.create.mockResolvedValue({ id: 'wh-new' });

      await service.createWarehouse(TENANT_A, {
        name: 'Secundário',
        isDefault: false,
      } as never);

      expect((prisma as any).warehouse.updateMany).not.toHaveBeenCalled();
    });

    it('demotes only inside the tenant', async () => {
      (prisma as any).warehouse.create.mockResolvedValue({ id: 'wh-new' });

      await service.createWarehouse(TENANT_A, {
        name: 'Padrão',
        isDefault: true,
      } as never);

      const args = (prisma as any).warehouse.updateMany.mock.calls[0][0];
      expect(args.where.tenantId).toBe(TENANT_A);
    });

    it('demotes and creates in the same transaction', async () => {
      (prisma as any).warehouse.create.mockResolvedValue({ id: 'wh-new' });

      await service.createWarehouse(TENANT_A, {
        name: 'Padrão',
        isDefault: true,
      } as never);

      // Sem transação, uma falha no meio deixaria zero depósitos padrão.
      expect((prisma as any).$transaction).toHaveBeenCalled();
    });

    it('should create a warehouse with provided data', async () => {
      const dto = { name: 'Novo Deposito', code: 'ND-001', address: 'Rua B, 2', isDefault: false };
      const created = { id: 'wh-new', ...dto, tenantId: TENANT_A, createdAt: new Date(), updatedAt: new Date() };
      (prisma as any).warehouse.create.mockResolvedValue(created);

      const result = await service.createWarehouse(TENANT_A, dto as any);

      expect(result).toEqual(created);
      expect((prisma as any).warehouse.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_A,
          name: dto.name,
          code: dto.code,
          address: dto.address,
          isDefault: false,
        }),
        select: expect.objectContaining({
          id: true,
          name: true,
          code: true,
        }),
      });
    });

    it('should scope warehouse to tenantId', async () => {
      const dto = { name: 'Test', code: 'TST', address: null };
      (prisma as any).warehouse.create.mockResolvedValue({ id: 'wh-new', ...dto, tenantId: TENANT_A });

      await service.createWarehouse(TENANT_A, dto as any);

      const createArgs = (prisma as any).warehouse.create.mock.calls[0][0];
      expect(createArgs.data.tenantId).toBe(TENANT_A);
    });

    it('should default isDefault to false when not provided', async () => {
      const dto = { name: 'Test', code: 'TST', address: null };
      (prisma as any).warehouse.create.mockResolvedValue({ id: 'wh-new', ...dto, tenantId: TENANT_A, isDefault: false });

      await service.createWarehouse(TENANT_A, dto as any);

      const createArgs = (prisma as any).warehouse.create.mock.calls[0][0];
      expect(createArgs.data.isDefault).toBe(false);
    });
  });
  // ─── adjustStock (AE-25) ──────────────────────────────────────────────────

  describe('adjustStock', () => {
    const dto: AdjustStockDto = {
      productId: PRODUCT_ID,
      warehouseId: WAREHOUSE_A,
      countedQuantity: 47,
      reason: 'COUNT',
      notes: 'Contagem cíclica de agosto',
    };

    beforeEach(() => {
      (prisma as any).product.findFirst.mockResolvedValue({
        id: PRODUCT_ID,
        sku: 'SKU-001',
        name: 'Widget A',
      });
      (prisma as any).warehouse.findFirst.mockResolvedValue({
        id: WAREHOUSE_A,
        name: 'Depósito Principal',
      });
      (prisma as any).stockAlert.findFirst.mockResolvedValue(null);
      (prisma as any).stockAlert.updateMany.mockResolvedValue({ count: 0 });
      (prisma as any).inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        quantity: 47,
        available: 47,
        minStock: 0,
      });
      prisma._tx.inventoryMovement.create.mockResolvedValue({ id: 'mov-adj' });
    });

    it('should derive the delta from the balance read inside the transaction', async () => {
      // 50 on the shelf, 47 counted -> the movement is 3 units out. The client
      // never computes this: a sale between opening the screen and saving would
      // make a client-side delta overwrite the newer balance.
      prisma._tx.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        quantity: 50,
        available: 50,
        minStock: 0,
      });

      const result = await service.adjustStock(TENANT_A, USER_ID, dto);

      expect(result.previousQuantity).toBe(50);
      expect(result.newQuantity).toBe(47);
      expect(result.delta).toBe(-3);

      const movement = prisma._tx.inventoryMovement.create.mock.calls[0][0].data;
      expect(movement.type).toBe('ADJUSTMENT');
      expect(movement.quantity).toBe(3);
      expect(movement.fromWarehouseId).toBe(WAREHOUSE_A);
      expect(movement.toWarehouseId).toBeUndefined();
    });

    it('should register a positive adjustment as an entry into the warehouse', async () => {
      prisma._tx.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        quantity: 40,
        available: 40,
        minStock: 0,
      });

      const result = await service.adjustStock(TENANT_A, USER_ID, dto);

      expect(result.delta).toBe(7);
      const movement = prisma._tx.inventoryMovement.create.mock.calls[0][0].data;
      expect(movement.quantity).toBe(7);
      expect(movement.toWarehouseId).toBe(WAREHOUSE_A);
      expect(movement.fromWarehouseId).toBeUndefined();
    });

    it('should treat a missing inventory item as a zero balance', async () => {
      prisma._tx.inventoryItem.findFirst.mockResolvedValue(null);

      const result = await service.adjustStock(TENANT_A, USER_ID, dto);

      expect(result.previousQuantity).toBe(0);
      expect(result.delta).toBe(47);
    });

    it('should refuse an adjustment that changes nothing', async () => {
      prisma._tx.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        quantity: 47,
        available: 47,
        minStock: 0,
      });

      await expect(service.adjustStock(TENANT_A, USER_ID, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma._tx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('should record who made the adjustment and why', async () => {
      prisma._tx.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        quantity: 50,
        available: 50,
        minStock: 0,
      });

      await service.adjustStock(TENANT_A, USER_ID, dto);

      const movement = prisma._tx.inventoryMovement.create.mock.calls[0][0].data;
      expect(movement.userId).toBe(USER_ID);
      expect(movement.notes).toBe('Contagem cíclica de agosto');
      expect(movement.reason).toBe('COUNT');
    });

    it('should scope the product and warehouse lookups by tenant', async () => {
      prisma._tx.inventoryItem.findFirst.mockResolvedValue({
        id: 'item-1',
        quantity: 50,
        available: 50,
        minStock: 0,
      });

      await service.adjustStock(TENANT_A, USER_ID, dto);

      expect((prisma as any).product.findFirst.mock.calls[0][0].where.tenantId).toBe(TENANT_A);
      expect((prisma as any).warehouse.findFirst.mock.calls[0][0].where.tenantId).toBe(TENANT_A);
      expect(prisma._tx.inventoryItem.findFirst.mock.calls[0][0].where.tenantId).toBe(TENANT_A);
    });

    it('should reject a product from another tenant', async () => {
      (prisma as any).product.findFirst.mockResolvedValue(null);

      await expect(service.adjustStock(TENANT_B, USER_ID, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject an unknown warehouse', async () => {
      (prisma as any).warehouse.findFirst.mockResolvedValue(null);

      await expect(service.adjustStock(TENANT_A, USER_ID, dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
  // ─── Warehouse update / remove (AE-12d) ───────────────────────────────────

  describe('updateWarehouse', () => {
    beforeEach(() => {
      (prisma as any).warehouse.update.mockResolvedValue({ id: WAREHOUSE_A });
      prisma._tx.warehouse.update.mockResolvedValue({ id: WAREHOUSE_A });
      prisma._tx.warehouse.updateMany.mockResolvedValue({ count: 1 });
    });

    it('should scope the lookup by tenant', async () => {
      (prisma as any).warehouse.findFirst.mockResolvedValue({
        id: WAREHOUSE_A,
        isDefault: false,
      });

      await service.updateWarehouse(TENANT_A, WAREHOUSE_A, { name: 'Novo nome' });

      expect((prisma as any).warehouse.findFirst.mock.calls[0][0].where.tenantId).toBe(
        TENANT_A,
      );
    });

    it('should reject a warehouse from another tenant', async () => {
      (prisma as any).warehouse.findFirst.mockResolvedValue(null);

      await expect(
        service.updateWarehouse(TENANT_B, WAREHOUSE_A, { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should demote the previous default in the same transaction', async () => {
      // AE-12c: the screen once showed three "Padrão" warehouses and the sale
      // picked one of them without saying which.
      (prisma as any).warehouse.findFirst.mockResolvedValue({
        id: WAREHOUSE_B,
        isDefault: false,
      });

      await service.updateWarehouse(TENANT_A, WAREHOUSE_B, { isDefault: true });

      expect(prisma._tx.warehouse.updateMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_A, isDefault: true },
        data: { isDefault: false },
      });
    });

    it('should refuse to un-tick the only default', async () => {
      (prisma as any).warehouse.findFirst.mockResolvedValue({
        id: WAREHOUSE_A,
        isDefault: true,
      });

      await expect(
        service.updateWarehouse(TENANT_A, WAREHOUSE_A, { isDefault: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should refuse to deactivate the default warehouse', async () => {
      (prisma as any).warehouse.findFirst.mockResolvedValue({
        id: WAREHOUSE_A,
        isDefault: true,
      });

      await expect(
        service.updateWarehouse(TENANT_A, WAREHOUSE_A, { isActive: false }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should uppercase the state', async () => {
      (prisma as any).warehouse.findFirst.mockResolvedValue({
        id: WAREHOUSE_A,
        isDefault: false,
      });

      await service.updateWarehouse(TENANT_A, WAREHOUSE_A, {
        state: 'sp',
      } as UpdateWarehouseDto);

      expect(prisma._tx.warehouse.update.mock.calls[0][0].data.state).toBe('SP');
    });
  });

  describe('removeWarehouse', () => {
    beforeEach(() => {
      (prisma as any).warehouse.findFirst.mockResolvedValue({
        id: WAREHOUSE_B,
        name: 'Depósito Secundário',
        isDefault: false,
      });
      (prisma as any).inventoryItem.aggregate.mockResolvedValue({
        _sum: { quantity: 0 },
      });
      (prisma as any).inventoryMovement.count.mockResolvedValue(0);
      (prisma as any).warehouse.update.mockResolvedValue({ id: WAREHOUSE_B });
    });

    it('should refuse to delete a warehouse that still holds stock', async () => {
      // AE-02 shape: the balance goes in the message, so the operator is not
      // left hunting for which warehouse still has something.
      (prisma as any).inventoryItem.aggregate.mockResolvedValue({
        _sum: { quantity: 592 },
      });

      await expect(
        service.removeWarehouse(TENANT_A, WAREHOUSE_B),
      ).rejects.toThrow(ConflictException);

      await expect(
        service.removeWarehouse(TENANT_A, WAREHOUSE_B),
      ).rejects.toThrow(/592 un/);
    });

    it('should refuse to delete the default warehouse', async () => {
      (prisma as any).warehouse.findFirst.mockResolvedValue({
        id: WAREHOUSE_A,
        name: 'Principal',
        isDefault: true,
      });

      await expect(
        service.removeWarehouse(TENANT_A, WAREHOUSE_A),
      ).rejects.toThrow(BadRequestException);
    });

    it('should deactivate instead of deleting when there is movement history', async () => {
      // The movements pointing at it are the audit trail of every entry and
      // exit the warehouse ever saw — deleting the row orphans them.
      (prisma as any).inventoryMovement.count.mockResolvedValue(12);

      const result = await service.removeWarehouse(TENANT_A, WAREHOUSE_B);

      expect(result.deactivated).toBe(true);
      expect((prisma as any).warehouse.update).toHaveBeenCalledWith({
        where: { id: WAREHOUSE_B },
        data: { isActive: false },
      });
      expect(prisma._tx.warehouse.delete).not.toHaveBeenCalled();
    });

    it('should delete a warehouse with no stock and no history', async () => {
      const result = await service.removeWarehouse(TENANT_A, WAREHOUSE_B);

      expect(result.deactivated).toBe(false);
      expect(prisma._tx.warehouse.delete).toHaveBeenCalledWith({
        where: { id: WAREHOUSE_B },
      });
    });

    it('should reject a warehouse from another tenant', async () => {
      (prisma as any).warehouse.findFirst.mockResolvedValue(null);

      await expect(
        service.removeWarehouse(TENANT_B, WAREHOUSE_B),
      ).rejects.toThrow(NotFoundException);
    });
  });
  // ─── FT-10: alertas por depósito ──────────────────────────────────────────

  describe('getLowStockAlerts: filtros', () => {
    beforeEach(() => {
      (prisma as any).stockAlert.findMany.mockResolvedValue([]);
      (prisma as any).stockAlert.count.mockResolvedValue(0);
    });

    it('should filter the alerts by warehouse', async () => {
      // "O que está faltando no Depósito Central?" é a pergunta da tela, e ela
      // já mostra a coluna Depósito — filtrar por ela respondia 400.
      await service.getLowStockAlerts(TENANT_A, { warehouseId: WAREHOUSE_A } as never);

      const where = (prisma as any).stockAlert.findMany.mock.calls[0][0].where;
      expect(where.warehouseId).toBe(WAREHOUSE_A);
      expect(where.tenantId).toBe(TENANT_A);
    });

    it('should filter the alerts by product', async () => {
      await service.getLowStockAlerts(TENANT_A, { productId: PRODUCT_ID } as never);

      expect(
        (prisma as any).stockAlert.findMany.mock.calls[0][0].where.productId,
      ).toBe(PRODUCT_ID);
    });

    it('should combine the warehouse with the status', async () => {
      await service.getLowStockAlerts(TENANT_A, {
        warehouseId: WAREHOUSE_A,
        status: 'ACTIVE',
      } as never);

      const where = (prisma as any).stockAlert.findMany.mock.calls[0][0].where;
      expect(where.warehouseId).toBe(WAREHOUSE_A);
      expect(where.isResolved).toBe(false);
    });

    it('should not narrow by warehouse when none is given', async () => {
      await service.getLowStockAlerts(TENANT_A, {} as never);

      const where = (prisma as any).stockAlert.findMany.mock.calls[0][0].where;
      expect(where).not.toHaveProperty('warehouseId');
      expect(where).not.toHaveProperty('productId');
    });
  });
});
