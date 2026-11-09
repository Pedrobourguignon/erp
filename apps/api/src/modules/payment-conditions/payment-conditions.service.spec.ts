import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentConditionsService } from './payment-conditions.service';
import { PrismaService } from '../../database/prisma/prisma.service';

/**
 * SCRUM-52: uma condição de pagamento ("12x sem juros") só faz sentido para os
 * métodos a que o lojista de fato a vincula ("Cartão de Crédito"). Sem essa
 * restrição, um método de dinheiro à vista mostrava parcelamento em 12x na
 * tela de venda.
 */

const TENANT_A = 'tenant-aaa-111';
const TENANT_B = 'tenant-bbb-222';

function createMockPrisma() {
  return {
    paymentCondition: {
      findFirst: jest.fn(),
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({
        id: 'pc-1',
        name: '12x sem juros',
        paymentMethods: [],
      }),
      update: jest.fn().mockResolvedValue({
        id: 'pc-1',
        name: '12x sem juros',
        paymentMethods: [],
      }),
    },
    paymentMethod: {
      findMany: jest.fn().mockResolvedValue([{ id: 'pm-1' }]),
    },
  };
}

describe('PaymentConditionsService — payment method links (SCRUM-52)', () => {
  let service: PaymentConditionsService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentConditionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PaymentConditionsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it('connects the payment methods informed', async () => {
      await service.create(TENANT_A, {
        name: '12x sem juros',
        code: '12X_SJ',
        type: 'INSTALLMENT',
        installments: 12,
        paymentMethodIds: ['pm-1'],
      } as never);

      const call = prisma.paymentCondition.create.mock.calls[0][0];
      expect(call.data.paymentMethods).toEqual({ connect: [{ id: 'pm-1' }] });
    });

    it('refuses a method id that does not belong to the tenant', async () => {
      prisma.paymentMethod.findMany.mockResolvedValue([]);

      await expect(
        service.create(TENANT_A, {
          name: '12x sem juros',
          code: '12X_SJ',
          type: 'INSTALLMENT',
          installments: 12,
          paymentMethodIds: ['pm-of-another-tenant'],
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates with no links when paymentMethodIds is omitted', async () => {
      await service.create(TENANT_A, {
        name: 'A Vista',
        code: 'AV',
        type: 'CASH',
      } as never);

      const call = prisma.paymentCondition.create.mock.calls[0][0];
      expect(call.data.paymentMethods).toEqual({ connect: [] });
      expect(prisma.paymentMethod.findMany).not.toHaveBeenCalled();
    });

    it('scopes the tenant-ownership check by tenant', async () => {
      await service.create(TENANT_B, {
        name: '12x sem juros',
        code: '12X_SJ',
        type: 'INSTALLMENT',
        installments: 12,
        paymentMethodIds: ['pm-1'],
      } as never);

      expect(prisma.paymentMethod.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['pm-1'] }, tenantId: TENANT_B },
        select: { id: true },
      });
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.paymentCondition.findFirst.mockResolvedValue({
        id: 'pc-1',
        code: 'AV',
      });
    });

    it('replaces the link set with `set` when paymentMethodIds is sent', async () => {
      await service.update(TENANT_A, 'pc-1', {
        paymentMethodIds: ['pm-1'],
      } as never);

      const call = prisma.paymentCondition.update.mock.calls[0][0];
      expect(call.data.paymentMethods).toEqual({ set: [{ id: 'pm-1' }] });
    });

    it('clears every link when an empty array is sent', async () => {
      await service.update(TENANT_A, 'pc-1', {
        paymentMethodIds: [],
      } as never);

      const call = prisma.paymentCondition.update.mock.calls[0][0];
      expect(call.data.paymentMethods).toEqual({ set: [] });
    });

    it('leaves existing links untouched when the field is omitted', async () => {
      await service.update(TENANT_A, 'pc-1', { name: 'Novo nome' } as never);

      const call = prisma.paymentCondition.update.mock.calls[0][0];
      expect(call.data).not.toHaveProperty('paymentMethods');
      expect(prisma.paymentMethod.findMany).not.toHaveBeenCalled();
    });

    it('refuses a method id that does not belong to the tenant', async () => {
      prisma.paymentMethod.findMany.mockResolvedValue([]);

      await expect(
        service.update(TENANT_A, 'pc-1', {
          paymentMethodIds: ['pm-of-another-tenant'],
        } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

/**
 * `entryPercentage` é `Decimal` no schema e o JSON de um Decimal é **string**.
 * O formulário de edição tipa o campo como número e o input de Entrada só
 * existe no tipo "Entrada + Parcelas": em qualquer outro tipo a string
 * reprovava na validação de um campo fora da tela, e Salvar só mostrava o
 * toast de "campo obrigatório não preenchido ou inválido", sem apontar nada.
 */
describe('PaymentConditionsService — entryPercentage sai como número', () => {
  let service: PaymentConditionsService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentConditionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PaymentConditionsService);
  });

  it('findOne converte o Decimal para number', async () => {
    prisma.paymentCondition.findFirst.mockResolvedValue({
      id: 'pc-1',
      code: 'AV',
      entryPercentage: new Prisma.Decimal('30.5'),
      paymentMethods: [],
    });

    const result = await service.findOne(TENANT_A, 'pc-1');

    expect(result.entryPercentage).toBe(30.5);
    expect(typeof result.entryPercentage).toBe('number');
  });

  it('findAll converte o Decimal de cada item', async () => {
    prisma.paymentCondition.findMany.mockResolvedValue([
      { id: 'pc-1', entryPercentage: new Prisma.Decimal('0'), paymentMethods: [] },
      { id: 'pc-2', entryPercentage: new Prisma.Decimal('50'), paymentMethods: [] },
    ]);
    prisma.paymentCondition.count.mockResolvedValue(2);

    const result = await service.findAll(TENANT_A, {} as never);

    expect(
      (result.data as { entryPercentage: number }[]).map((c) => c.entryPercentage),
    ).toEqual([0, 50]);
  });
});
