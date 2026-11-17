import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethodsService } from './payment-methods.service';
import { PrismaService } from '../../database/prisma/prisma.service';

/**
 * VD-11 / FN-20: um método à vista sem conta financeira vinculada gera
 * contabilidade errada em silêncio.
 *
 * O QA reproduziu com PED-000007: R$ 299,80 em dinheiro + PIX criaram dois
 * recebíveis **pendentes** com vencimento em 30 dias e não creditaram conta
 * nenhuma. Com a conta vinculada, a mesma venda gera recebível pago e credita
 * a conta. O sistema aceitava os dois caminhos sem distinguir.
 */

const TENANT = 'tenant-uuid-001';

describe('PaymentMethodsService — linked account (VD-11)', () => {
  let service: PaymentMethodsService;
  let prisma: {
    financialAccount: { findFirst: jest.Mock };
    cardMachine: { findFirst: jest.Mock };
    paymentMethod: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
    orderPayment: { count: jest.Mock };
    accountsReceivable: { count: jest.Mock };
    accountsPayable: { count: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      financialAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'acc-1' }) },
      cardMachine: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cm-1', name: 'Stone', isActive: true }),
      },
      paymentMethod: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pm-1', type: 'CASH' }),
        create: jest.fn().mockResolvedValue({ id: 'pm-1' }),
        update: jest.fn().mockResolvedValue({ id: 'pm-1' }),
        delete: jest.fn().mockResolvedValue({ id: 'pm-1' }),
      },
      orderPayment: { count: jest.fn().mockResolvedValue(0) },
      accountsReceivable: { count: jest.fn().mockResolvedValue(0) },
      accountsPayable: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PaymentMethodsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('create', () => {
    it.each(['CASH', 'PIX', 'DEBIT_CARD'])(
      'refuses a %s method with no linked account',
      async (type) => {
        await expect(
          service.create(TENANT, { name: 'Dinheiro', type } as never),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('explains what is missing, in Portuguese', async () => {
      await expect(
        service.create(TENANT, { name: 'Dinheiro', type: 'CASH' } as never),
      ).rejects.toThrow(/conta financeira/i);
    });

    it('accepts an immediate method that has an account', async () => {
      await expect(
        service.create(TENANT, {
          name: 'Dinheiro',
          type: 'CASH',
          defaultAccountId: 'acc-1',
        } as never),
      ).resolves.toBeDefined();
    });

    it.each(['CREDIT_CARD', 'BOLETO', 'BANK_TRANSFER', 'OTHER'])(
      'still allows a %s method without an account — it settles later',
      async (type) => {
        await expect(
          service.create(TENANT, {
            name: 'A prazo',
            type,
            cardMachineId: type === 'CREDIT_CARD' ? 'cm-1' : undefined,
          } as never),
        ).resolves.toBeDefined();
      },
    );
  });

  describe('update', () => {
    it('refuses to unlink the account of an immediate method', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-1',
        type: 'PIX',
        defaultAccountId: 'acc-1',
      });

      await expect(
        service.update(TENANT, 'pm-1', { defaultAccountId: null } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to turn a term method into an immediate one without an account', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-1',
        type: 'BOLETO',
        defaultAccountId: null,
      });

      await expect(
        service.update(TENANT, 'pm-1', { type: 'CASH' } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts the same change when an account comes with it', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-1',
        type: 'BOLETO',
        defaultAccountId: null,
      });

      await expect(
        service.update(TENANT, 'pm-1', {
          type: 'CASH',
          defaultAccountId: 'acc-1',
        } as never),
      ).resolves.toBeDefined();
    });

    it('leaves an unrelated edit alone', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-1',
        type: 'CASH',
        defaultAccountId: 'acc-1',
      });

      await expect(
        service.update(TENANT, 'pm-1', { name: 'Dinheiro (caixa)' } as never),
      ).resolves.toBeDefined();
    });
  });

  // Baixa automática no dia em que a operadora paga.
  describe('auto-settle', () => {
    const credit = { name: 'Cartão de Crédito', type: 'CREDIT_CARD', cardMachineId: 'cm-1' };

    it('saves the auto-settle flag', async () => {
      await service.create(TENANT, {
        ...credit,
        defaultAccountId: 'acc-1',
        autoSettle: true,
      } as never);

      expect(prisma.paymentMethod.create.mock.calls[0][0].data).toMatchObject({
        autoSettle: true,
      });
    });

    it('defaults to no auto-settle', async () => {
      await service.create(TENANT, credit as never);

      expect(prisma.paymentMethod.create.mock.calls[0][0].data.autoSettle).toBe(false);
    });

    it('refuses auto-settle with no account to credit, in Portuguese', async () => {
      await expect(
        service.create(TENANT, { ...credit, autoSettle: true } as never),
      ).rejects.toThrow('A baixa automática precisa de uma conta financeira vinculada');
    });

    it('judges an edit by the resulting method, not only by what was sent', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-1',
        type: 'CREDIT_CARD',
        defaultAccountId: null,
      });

      // ligar a baixa automática num método que não tem conta
      await expect(
        service.update(TENANT, 'pm-1', { autoSettle: true } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // O vendedor digita as parcelas na venda; o método diz até quantas aceita.
  // Para quem não é cartão (boleto, crediário); o cartão usa a maquininha.
  describe('max installments', () => {
    const credit = { name: 'Boleto', type: 'BOLETO' };

    it('saves the maximum number of installments', async () => {
      await service.create(TENANT, { ...credit, maxInstallments: 12 } as never);

      expect(prisma.paymentMethod.create.mock.calls[0][0].data.maxInstallments).toBe(12);
    });

    it('defaults to a single installment', async () => {
      await service.create(TENANT, credit as never);

      expect(prisma.paymentMethod.create.mock.calls[0][0].data.maxInstallments).toBe(1);
    });

    it.each(['CASH', 'PIX', 'DEBIT_CARD'])(
      'refuses installments on the immediate type %s, in Portuguese',
      async (type) => {
        await expect(
          service.create(TENANT, {
            name: 'À vista',
            type,
            defaultAccountId: 'acc-1',
            maxInstallments: 3,
          } as never),
        ).rejects.toThrow('não pode ser parcelad');
      },
    );

    it('updates the maximum', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-1',
        type: 'BOLETO',
        defaultAccountId: null,
        maxInstallments: 1,
      });

      await service.update(TENANT, 'pm-1', { maxInstallments: 6 } as never);

      expect(prisma.paymentMethod.update.mock.calls[0][0].data.maxInstallments).toBe(6);
    });

    it('judges an edit by the resulting method: turning a 12x card into PIX is refused', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-1',
        type: 'CREDIT_CARD',
        defaultAccountId: 'acc-1',
        maxInstallments: 12,
      });

      await expect(
        service.update(TENANT, 'pm-1', { type: 'PIX' } as never),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // Taxas, prazos e parcelas do cartão moram na maquininha.
  describe('card machine link', () => {
    const credit = { name: 'Cartão de Crédito', type: 'CREDIT_CARD' };

    it.each(['CREDIT_CARD', 'DEBIT_CARD'])(
      'refuses a %s method with no card machine, in Portuguese',
      async (type) => {
        await expect(
          service.create(TENANT, { name: 'Cartão', type, defaultAccountId: 'acc-1' } as never),
        ).rejects.toThrow('Escolha a maquininha');
        expect(prisma.paymentMethod.create).not.toHaveBeenCalled();
      },
    );

    it('looks the machine up in the same tenant and refuses one it cannot see', async () => {
      prisma.cardMachine.findFirst.mockResolvedValue(null);

      await expect(
        service.create(TENANT, { ...credit, cardMachineId: 'cm-other' } as never),
      ).rejects.toThrow('Maquininha não encontrada');
      expect(prisma.cardMachine.findFirst.mock.calls[0][0].where).toEqual({
        id: 'cm-other',
        tenantId: TENANT,
      });
    });

    it('refuses an inactive machine', async () => {
      prisma.cardMachine.findFirst.mockResolvedValue({
        id: 'cm-1',
        name: 'Stone',
        isActive: false,
      });

      await expect(
        service.create(TENANT, { ...credit, cardMachineId: 'cm-1' } as never),
      ).rejects.toThrow('inativa');
    });

    it('links the machine and drops fee, term and installments from the card method', async () => {
      await service.create(TENANT, {
        ...credit,
        cardMachineId: 'cm-1',
        feePercentage: 3.19,
        settlementDays: 30,
        maxInstallments: 12,
      } as never);

      expect(prisma.paymentMethod.create.mock.calls[0][0].data).toMatchObject({
        cardMachineId: 'cm-1',
        feePercentage: null,
        settlementDays: null,
        maxInstallments: 1,
      });
    });

    it('keeps the link on an edit that does not touch it', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-1',
        type: 'CREDIT_CARD',
        defaultAccountId: null,
        cardMachineId: 'cm-1',
        maxInstallments: 1,
      });

      await service.update(TENANT, 'pm-1', { name: 'Crédito Stone' } as never);

      expect(prisma.paymentMethod.update).toHaveBeenCalled();
    });

    it('unlinks the machine when the method stops being a card', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-1',
        type: 'CREDIT_CARD',
        defaultAccountId: null,
        cardMachineId: 'cm-1',
        maxInstallments: 1,
      });

      await service.update(TENANT, 'pm-1', { type: 'BOLETO' } as never);

      expect(prisma.paymentMethod.update.mock.calls[0][0].data.cardMachineId).toBeNull();
    });

    it('ignores a machine sent for a method that is not a card', async () => {
      await service.create(TENANT, {
        name: 'Boleto',
        type: 'BOLETO',
        cardMachineId: 'cm-1',
      } as never);

      expect(prisma.paymentMethod.create.mock.calls[0][0].data.cardMachineId).toBeNull();
    });
  });

  describe('effective installments in the response', () => {
    const machine = {
      id: 'cm-1',
      name: 'Stone',
      isActive: true,
      creditReceiveMode: 'FLOW',
      rates: [{ installments: 1 }, { installments: 2 }, { installments: 6 }],
    };

    it('a credit card offers up to the highest installment of its machine', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-1',
        type: 'CREDIT_CARD',
        maxInstallments: 1,
        cardMachine: machine,
      });

      const method = await service.findOne(TENANT, 'pm-1');

      expect(method.maxInstallments).toBe(6);
    });

    it('a debit card never splits, whatever the machine has', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-2',
        type: 'DEBIT_CARD',
        maxInstallments: 1,
        cardMachine: machine,
      });

      const method = await service.findOne(TENANT, 'pm-2');

      expect(method.maxInstallments).toBe(1);
    });

    it('a method that is not a card keeps its own maximum', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValue({
        id: 'pm-3',
        type: 'BOLETO',
        maxInstallments: 4,
        cardMachine: null,
      });

      const method = await service.findOne(TENANT, 'pm-3');

      expect(method.maxInstallments).toBe(4);
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      prisma.paymentMethod.findFirst.mockResolvedValue({ id: 'pm-1', name: 'Dinheiro' });
    });

    it('deletes a method that was never used', async () => {
      const result = await service.remove(TENANT, 'pm-1');

      expect(prisma.paymentMethod.delete).toHaveBeenCalledWith({ where: { id: 'pm-1' } });
      expect(result.deactivated).toBe(false);
    });

    it('deactivates instead of deleting a method used in an order payment', async () => {
      prisma.orderPayment.count.mockResolvedValue(3);

      const result = await service.remove(TENANT, 'pm-1');

      expect(prisma.paymentMethod.update).toHaveBeenCalledWith({
        where: { id: 'pm-1' },
        data: { isActive: false },
      });
      expect(prisma.paymentMethod.delete).not.toHaveBeenCalled();
      expect(result.deactivated).toBe(true);
    });

    it('deactivates instead of deleting a method used in a receivable', async () => {
      prisma.accountsReceivable.count.mockResolvedValue(1);

      const result = await service.remove(TENANT, 'pm-1');

      expect(result.deactivated).toBe(true);
    });

    it('deactivates instead of deleting a method used in a payable', async () => {
      prisma.accountsPayable.count.mockResolvedValue(1);

      const result = await service.remove(TENANT, 'pm-1');

      expect(result.deactivated).toBe(true);
    });

    it('404s for a method of another tenant', async () => {
      prisma.paymentMethod.findFirst.mockResolvedValue(null);

      await expect(service.remove(TENANT, 'pm-1')).rejects.toThrow(NotFoundException);
    });
  });
});
