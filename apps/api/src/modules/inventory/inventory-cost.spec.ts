import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';

import { PrismaService } from '../../database/prisma/prisma.service';
import { InventoryService } from './inventory.service';

/**
 * Custo do estoque: média ponderada por depósito, e o custo de cadastro do
 * produto acompanhando essa média (ADR 0004).
 *
 * Antes, o "preço de custo" do produto nunca mudava com as entradas; uma entrada
 * sem custo, uma devolução e uma transferência entravam pelo custo de cadastro e
 * diluíam a média com um número arbitrário.
 */
const TENANT = 'tenant-a';
const USER = 'user-1';
const PRODUCT = 'prod-1';
const WH_A = 'wh-a';
const WH_B = 'wh-b';

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ii-1',
    tenantId: TENANT,
    productId: PRODUCT,
    variantId: null,
    warehouseId: WH_A,
    quantity: 10,
    reserved: 0,
    available: 10,
    minStock: 0,
    costAverage: 22.5,
    ...overrides,
  };
}

function createPrisma() {
  const tx = {
    product: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ defaultMinStock: 0, costPrice: 10, name: 'Widget', sku: 'SKU-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    warehouse: { findUnique: jest.fn().mockResolvedValue({ name: 'Depósito' }) },
    inventoryItem: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    inventoryMovement: { create: jest.fn().mockResolvedValue({ id: 'mov-1' }) },
  };
  return {
    product: { findFirst: jest.fn().mockResolvedValue({ id: PRODUCT, sku: 'SKU-1', name: 'Widget' }) },
    inventoryItem: { findFirst: jest.fn().mockResolvedValue(item({ available: 90, minStock: 20 })) },
    warehouse: { findUnique: jest.fn().mockResolvedValue({ name: 'Depósito' }) },
    stockAlert: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    _tx: tx,
  };
}

describe('InventoryService — custo', () => {
  let service: InventoryService;
  let prisma: ReturnType<typeof createPrisma>;
  const tx = () => prisma._tx;

  beforeEach(async () => {
    prisma = createPrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = module.get(InventoryService);
  });

  const costAverageSaved = () => Number(tx().inventoryItem.update.mock.calls[0][0].data.costAverage);

  describe('entrada sem custo informado', () => {
    it.each([
      ['ENTRY', 'PURCHASE'],
      ['RETURN', 'RETURN_CUSTOMER'],
    ])('%s mantém o custo médio do saldo, em vez de cair no custo de cadastro', async (type, reason) => {
      tx().inventoryItem.findFirst.mockResolvedValue(item({ quantity: 10, costAverage: 22.5 }));

      await service.createMovement(TENANT, USER, {
        productId: PRODUCT, type, reason, quantity: 10, toWarehouseId: WH_A,
      });

      // com o custo de cadastro (10) a média cairia para 16,25
      expect(costAverageSaved()).toBe(22.5);
    });

    it('em depósito sem saldo usa o custo de cadastro do produto', async () => {
      tx().inventoryItem.findFirst.mockResolvedValue(null);

      await service.createMovement(TENANT, USER, {
        productId: PRODUCT, type: 'ENTRY', reason: 'PURCHASE', quantity: 5, toWarehouseId: WH_A,
      });

      expect(Number(tx().inventoryItem.create.mock.calls[0][0].data.costAverage)).toBe(10);
    });

    it('com saldo zerado, o custo de cadastro é o ponto de partida (não a média velha)', async () => {
      tx().inventoryItem.findFirst.mockResolvedValue(item({ quantity: 0, available: 0, costAverage: 50 }));

      await service.createMovement(TENANT, USER, {
        productId: PRODUCT, type: 'ENTRY', reason: 'PURCHASE', quantity: 4, toWarehouseId: WH_A,
      });

      expect(costAverageSaved()).toBe(10);
    });
  });

  it('um custo 0 informado é bonificação: entra na média com custo zero', async () => {
    tx().inventoryItem.findFirst.mockResolvedValue(item({ quantity: 20, costAverage: 16.25 }));

    await service.createMovement(TENANT, USER, {
      productId: PRODUCT, type: 'ENTRY', reason: 'PURCHASE', quantity: 10, unitCost: 0, toWarehouseId: WH_A,
    });

    expect(costAverageSaved()).toBeCloseTo(10.8333, 4);
  });

  describe('transferência', () => {
    const dto = { productId: PRODUCT, fromWarehouseId: WH_A, toWarehouseId: WH_B, quantity: 4 };

    it('leva o custo médio do depósito de origem para o destino', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(item({ quantity: 10, available: 10, costAverage: 50 }));
      tx().inventoryItem.findFirst
        .mockResolvedValueOnce(item({ warehouseId: WH_A, quantity: 10, available: 10, costAverage: 50 })) // origem
        .mockResolvedValueOnce(item({ warehouseId: WH_B, quantity: 4, available: 4, costAverage: 80 })); // destino

      await service.transferStock(TENANT, USER, dto);

      // origem não muda de custo ao sair; destino: (4×80 + 4×50) / 8 = 65
      const [sourceUpdate, destUpdate] = tx().inventoryItem.update.mock.calls.map((c) => c[0].data);
      expect(sourceUpdate.costAverage).toBeUndefined();
      expect(Number(destUpdate.costAverage)).toBe(65);
    });

    it('cria o saldo do destino já com o custo da origem', async () => {
      prisma.inventoryItem.findFirst.mockResolvedValue(item({ quantity: 10, available: 10, costAverage: 50 }));
      tx().inventoryItem.findFirst
        .mockResolvedValueOnce(item({ warehouseId: WH_A, quantity: 10, available: 10, costAverage: 50 }))
        .mockResolvedValueOnce(null);

      await service.transferStock(TENANT, USER, dto);

      expect(Number(tx().inventoryItem.create.mock.calls[0][0].data.costAverage)).toBe(50);
    });
  });

  describe('custo de cadastro do produto acompanha a média', () => {
    const entry = (extra: Record<string, unknown> = {}) =>
      service.createMovement(TENANT, USER, {
        productId: PRODUCT, type: 'ENTRY', reason: 'PURCHASE', quantity: 4,
        unitCost: 50, toWarehouseId: WH_A, ...extra,
      });

    beforeEach(() => {
      tx().inventoryItem.findFirst.mockResolvedValue(item({ quantity: 6, costAverage: 40 }));
    });

    it('grava a média ponderada de todos os depósitos em products.costPrice', async () => {
      tx().inventoryItem.findMany.mockResolvedValue([
        { quantity: 10, costAverage: 45 },
        { quantity: 4, costAverage: 80 },
      ]);

      await entry();

      // (10×45 + 4×80) / 14 = 55
      const data = tx().product.update.mock.calls[0][0].data;
      expect(Number(data.costPrice)).toBe(55);
      expect(tx().product.update.mock.calls[0][0].where).toEqual({ id: PRODUCT });
    });

    it('só considera saldo positivo e é filtrado pela empresa', async () => {
      await entry();

      expect(tx().inventoryItem.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, productId: PRODUCT, quantity: { gt: 0 } },
        select: { quantity: true, costAverage: true },
      });
    });

    it('não toca o custo quando não sobra saldo (mantém o último)', async () => {
      tx().inventoryItem.findMany.mockResolvedValue([]);

      await entry();

      const costWrites = tx().product.update.mock.calls.filter(([a]) => 'costPrice' in a.data);
      expect(costWrites).toHaveLength(0);
    });

    it('uma saída não mexe no custo do produto', async () => {
      tx().inventoryItem.findFirst.mockResolvedValue(item({ quantity: 10 }));

      await service.createMovement(TENANT, USER, {
        productId: PRODUCT, type: 'EXIT', reason: 'SALE', quantity: 2, fromWarehouseId: WH_A,
      });

      expect(tx().inventoryItem.findMany).not.toHaveBeenCalled();
      expect(tx().product.update).not.toHaveBeenCalled();
    });
  });

  describe('último custo de compra', () => {
    const run = (overrides: Record<string, unknown>) => {
      tx().inventoryItem.findFirst.mockResolvedValue(item({ quantity: 6, costAverage: 40 }));
      return service.createMovement(TENANT, USER, {
        productId: PRODUCT, type: 'ENTRY', reason: 'PURCHASE', quantity: 4,
        unitCost: 50, toWarehouseId: WH_A, ...overrides,
      });
    };
    const lastCostWrites = () =>
      tx().product.update.mock.calls.filter(([a]) => 'lastPurchaseCost' in a.data);

    it('registra o custo e a data de uma compra', async () => {
      await run({});

      const data = lastCostWrites()[0][0].data;
      expect(Number(data.lastPurchaseCost)).toBe(50);
      expect(data.lastPurchaseAt).toBeInstanceOf(Date);
    });

    it.each([
      ['devolução de cliente', { reason: 'RETURN_CUSTOMER' }],
      ['entrada sem custo', { unitCost: undefined }],
      ['saldo inicial', { reason: 'INITIAL' }],
    ])('não registra em %s', async (_label, overrides) => {
      await run(overrides);

      expect(lastCostWrites()).toHaveLength(0);
    });
  });
});
