import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CardMachinesService } from './card-machines.service';
import { PrismaService } from '../../database/prisma/prisma.service';

/**
 * A maquininha guarda as taxas e os prazos do cartão. O método de pagamento de
 * cartão aponta para ela, e a venda calcula títulos e taxas a partir dela.
 */

const TENANT = 'tenant-uuid-001';
const OTHER_TENANT = 'tenant-uuid-999';

function makeDto(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Stone Loja Centro',
    provider: 'Stone',
    debitFeePercentage: 1.5,
    debitSettlementDays: 1,
    creditReceiveMode: 'FLOW',
    creditSettlementDays: 30,
    rates: [
      { installments: 1, feePercentage: 3.19 },
      { installments: 2, feePercentage: 4.99 },
      { installments: 3, feePercentage: 4.99 },
    ],
    ...overrides,
  };
}

describe('CardMachinesService', () => {
  let service: CardMachinesService;
  let prisma: {
    cardMachine: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    cardMachineRate: { deleteMany: jest.Mock; createMany: jest.Mock };
    paymentMethod: { count: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      cardMachine: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'cm-1', tenantId: TENANT, name: 'Stone' }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'cm-1' }),
        update: jest.fn().mockResolvedValue({ id: 'cm-1' }),
        delete: jest.fn().mockResolvedValue({ id: 'cm-1' }),
      },
      cardMachineRate: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      paymentMethod: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma));

    const module: TestingModule = await Test.createTestingModule({
      providers: [CardMachinesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(CardMachinesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('saves the machine with its credit rate table', async () => {
      await service.create(TENANT, makeDto() as never);

      const data = prisma.cardMachine.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        tenantId: TENANT,
        name: 'Stone Loja Centro',
        debitFeePercentage: 1.5,
        debitSettlementDays: 1,
        creditReceiveMode: 'FLOW',
        creditSettlementDays: 30,
      });
      expect(data.rates.create).toEqual([
        { installments: 1, feePercentage: 3.19 },
        { installments: 2, feePercentage: 4.99 },
        { installments: 3, feePercentage: 4.99 },
      ]);
    });

    it('accepts a debit-only machine, with no credit rates', async () => {
      await service.create(TENANT, makeDto({ rates: [] }) as never);

      expect(prisma.cardMachine.create).toHaveBeenCalled();
    });

    // Uma tabela 1x, 2x, 4x deixaria o vendedor escolher 3x sem taxa nenhuma.
    it('refuses a gap in the rate table, naming the missing installment', async () => {
      const dto = makeDto({
        rates: [
          { installments: 1, feePercentage: 3 },
          { installments: 2, feePercentage: 4 },
          { installments: 4, feePercentage: 5 },
        ],
      });

      await expect(service.create(TENANT, dto as never)).rejects.toThrow(
        'Falta a taxa de 3x',
      );
      expect(prisma.cardMachine.create).not.toHaveBeenCalled();
    });

    it('refuses the same number of installments twice', async () => {
      const dto = makeDto({
        rates: [
          { installments: 1, feePercentage: 3 },
          { installments: 1, feePercentage: 4 },
        ],
      });

      await expect(service.create(TENANT, dto as never)).rejects.toThrow(BadRequestException);
    });

    it('sorts the table regardless of the order it was sent in', async () => {
      await service.create(
        TENANT,
        makeDto({
          rates: [
            { installments: 2, feePercentage: 4.99 },
            { installments: 1, feePercentage: 3.19 },
          ],
        }) as never,
      );

      const rates = prisma.cardMachine.create.mock.calls[0][0].data.rates.create;
      expect(rates.map((r: { installments: number }) => r.installments)).toEqual([1, 2]);
    });
  });

  describe('update', () => {
    it('replaces the whole rate table when one is sent', async () => {
      await service.update(TENANT, 'cm-1', {
        rates: [{ installments: 1, feePercentage: 2.5 }],
      } as never);

      expect(prisma.cardMachineRate.deleteMany).toHaveBeenCalledWith({
        where: { cardMachineId: 'cm-1' },
      });
      expect(prisma.cardMachineRate.createMany).toHaveBeenCalledWith({
        data: [{ cardMachineId: 'cm-1', installments: 1, feePercentage: 2.5 }],
      });
    });

    it('keeps the rate table when none is sent', async () => {
      await service.update(TENANT, 'cm-1', { name: 'Stone Shopping' } as never);

      expect(prisma.cardMachineRate.deleteMany).not.toHaveBeenCalled();
      expect(prisma.cardMachine.update.mock.calls[0][0].data).toMatchObject({
        name: 'Stone Shopping',
      });
    });

    it('validates the new table the same way as on create', async () => {
      await expect(
        service.update(TENANT, 'cm-1', {
          rates: [{ installments: 2, feePercentage: 4 }],
        } as never),
      ).rejects.toThrow('Falta a taxa de 1x');
    });

    it('404s for a machine of another tenant', async () => {
      prisma.cardMachine.findFirst.mockResolvedValue(null);

      await expect(
        service.update(OTHER_TENANT, 'cm-1', { name: 'x' } as never),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.cardMachine.findFirst.mock.calls[0][0].where).toEqual({
        id: 'cm-1',
        tenantId: OTHER_TENANT,
      });
    });
  });

  describe('findAll', () => {
    it('lists only the machines of the tenant, with the table in order', async () => {
      await service.findAll(TENANT, { page: 1, limit: 20 } as never);

      const args = prisma.cardMachine.findMany.mock.calls[0][0];
      expect(args.where.tenantId).toBe(TENANT);
      expect(args.include.rates.orderBy).toEqual({ installments: 'asc' });
    });
  });

  describe('remove', () => {
    it('deletes a machine no payment method points to', async () => {
      const result = await service.remove(TENANT, 'cm-1');

      expect(prisma.cardMachine.delete).toHaveBeenCalledWith({ where: { id: 'cm-1' } });
      expect(result.deactivated).toBe(false);
    });

    // Apagar quebraria os métodos vinculados — mesma regra do FN-16.
    it('deactivates instead of deleting a machine linked to a payment method', async () => {
      prisma.paymentMethod.count.mockResolvedValue(2);

      const result = await service.remove(TENANT, 'cm-1');

      expect(prisma.cardMachine.delete).not.toHaveBeenCalled();
      expect(prisma.cardMachine.update).toHaveBeenCalledWith({
        where: { id: 'cm-1' },
        data: { isActive: false },
      });
      expect(result.deactivated).toBe(true);
      expect(result.message).toContain('inativada');
    });

    it('404s for a machine of another tenant', async () => {
      prisma.cardMachine.findFirst.mockResolvedValue(null);

      await expect(service.remove(OTHER_TENANT, 'cm-1')).rejects.toThrow(NotFoundException);
    });
  });
});
