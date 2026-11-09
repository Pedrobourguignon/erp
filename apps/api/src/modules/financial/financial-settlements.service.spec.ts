import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { FinancialSettlementsService } from './financial-settlements.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { CashRegistersService } from '../cash-registers/cash-registers.service';

const TENANT_A = 'tenant-aaa-111';
const TENANT_B = 'tenant-bbb-222';
const RECEIVABLE_ID = 'ar-001';
const PAYABLE_ID = 'ap-001';

function createMockTx() {
  return {
    financialAccount: { update: jest.fn().mockResolvedValue({ balance: 1000 }) },
    financialTransaction: { create: jest.fn().mockResolvedValue({ id: 'ft-1' }) },
    accountsReceivable: { update: jest.fn().mockResolvedValue({}) },
    accountsPayable: { update: jest.fn().mockResolvedValue({}) },
  };
}

function createMockPrisma(tx: ReturnType<typeof createMockTx>) {
  return {
    accountsReceivable: { findFirst: jest.fn() },
    accountsPayable: { findFirst: jest.fn() },
    financialAccount: { findFirst: jest.fn().mockResolvedValue({ id: 'acc-1' }) },
    $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    _tx: tx,
  };
}

/** An open receivable from a boleto sale, account resolvable via the order payment. */
function makeReceivable(overrides: Record<string, unknown> = {}) {
  return {
    id: RECEIVABLE_ID,
    tenantId: TENANT_A,
    description: 'PED-000001 - Boleto',
    amount: 250,
    paidAmount: 0,
    status: 'PENDING',
    chartAccountId: null,
    metadata: null,
    orderPayment: {
      financialAccountId: 'acc-1',
      paymentMethod: { defaultAccountId: 'acc-default' },
    },
    paymentMethod: { defaultAccountId: 'acc-default' },
    ...overrides,
  };
}

function makePayable(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYABLE_ID,
    tenantId: TENANT_A,
    description: 'Aluguel',
    amount: 100,
    paidAmount: 0,
    status: 'PENDING',
    chartAccountId: null,
    metadata: { manual: true, financialAccountId: 'acc-1' },
    paymentMethod: null,
    ...overrides,
  };
}

describe('FinancialSettlementsService', () => {
  let service: FinancialSettlementsService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let tx: ReturnType<typeof createMockTx>;
  let cashRegisters: { mirrorSettlementInDrawer: jest.Mock };

  beforeEach(async () => {
    tx = createMockTx();
    prisma = createMockPrisma(tx);

    cashRegisters = { mirrorSettlementInDrawer: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialSettlementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CashRegistersService, useValue: cashRegisters },
      ],
    }).compile();

    service = module.get<FinancialSettlementsService>(FinancialSettlementsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── Receivable ────────────────────────────────────────────────────────

  describe('settle RECEIVABLE', () => {
    it('should credit the account and mark the receivable PAID', async () => {
      prisma.accountsReceivable.findFirst.mockResolvedValue(makeReceivable());
      tx.financialAccount.update.mockResolvedValue({ balance: 1250 });

      const result = await service.settle(TENANT_A, RECEIVABLE_ID, {
        kind: 'RECEIVABLE',
      });

      expect(tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { balance: { increment: 250 } },
        select: { balance: true },
      });
      expect(tx.financialTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_A,
          accountId: 'acc-1',
          type: 'CREDIT',
          amount: 250,
          balanceAfter: 1250,
          referenceType: 'receivable',
          referenceId: RECEIVABLE_ID,
        }),
      });
      const updateData = tx.accountsReceivable.update.mock.calls[0][0].data;
      expect(updateData.status).toBe('PAID');
      expect(updateData.paidAmount).toBe(250);
      expect(updateData.paidAt).toBeInstanceOf(Date);
      expect(result.status).toBe('PAID');
    });

    it('should record a partial settlement as PARTIALLY_PAID without paidAt', async () => {
      prisma.accountsReceivable.findFirst.mockResolvedValue(makeReceivable());

      const result = await service.settle(TENANT_A, RECEIVABLE_ID, {
        kind: 'RECEIVABLE',
        amount: 100,
      });

      expect(tx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { balance: { increment: 100 } } }),
      );
      const updateData = tx.accountsReceivable.update.mock.calls[0][0].data;
      expect(updateData.status).toBe('PARTIALLY_PAID');
      expect(updateData.paidAmount).toBe(100);
      expect(updateData.paidAt).toBeNull();
      expect(result.status).toBe('PARTIALLY_PAID');
    });

    it('should settle only the outstanding balance of a partially paid título', async () => {
      prisma.accountsReceivable.findFirst.mockResolvedValue(
        makeReceivable({ paidAmount: 200, status: 'PARTIALLY_PAID' }),
      );

      await service.settle(TENANT_A, RECEIVABLE_ID, { kind: 'RECEIVABLE' });

      // 250 total - 200 already paid = 50 outstanding
      expect(tx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { balance: { increment: 50 } } }),
      );
      const updateData = tx.accountsReceivable.update.mock.calls[0][0].data;
      expect(updateData.paidAmount).toBe(250);
      expect(updateData.status).toBe('PAID');
    });

    it('should reject an amount above the outstanding balance', async () => {
      prisma.accountsReceivable.findFirst.mockResolvedValue(makeReceivable());

      await expect(
        service.settle(TENANT_A, RECEIVABLE_ID, { kind: 'RECEIVABLE', amount: 300 }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should reject settling an already PAID título', async () => {
      prisma.accountsReceivable.findFirst.mockResolvedValue(
        makeReceivable({ status: 'PAID', paidAmount: 250 }),
      );

      await expect(
        service.settle(TENANT_A, RECEIVABLE_ID, { kind: 'RECEIVABLE' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should reject settling a CANCELLED título', async () => {
      prisma.accountsReceivable.findFirst.mockResolvedValue(
        makeReceivable({ status: 'CANCELLED' }),
      );

      await expect(
        service.settle(TENANT_A, RECEIVABLE_ID, { kind: 'RECEIVABLE' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should fall back to the payment method default account', async () => {
      prisma.accountsReceivable.findFirst.mockResolvedValue(
        makeReceivable({
          orderPayment: {
            financialAccountId: null,
            paymentMethod: { defaultAccountId: 'acc-default' },
          },
        }),
      );

      await service.settle(TENANT_A, RECEIVABLE_ID, { kind: 'RECEIVABLE' });

      expect(tx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-default' } }),
      );
    });

    it('should fall back to the account stored on a manual entry metadata', async () => {
      prisma.accountsReceivable.findFirst.mockResolvedValue(
        makeReceivable({
          orderPayment: null,
          paymentMethod: null,
          metadata: { manual: true, financialAccountId: 'acc-manual' },
        }),
      );

      await service.settle(TENANT_A, RECEIVABLE_ID, { kind: 'RECEIVABLE' });

      expect(tx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-manual' } }),
      );
    });

    it('should prefer an explicitly provided account', async () => {
      prisma.accountsReceivable.findFirst.mockResolvedValue(makeReceivable());
      prisma.financialAccount.findFirst.mockResolvedValue({ id: 'acc-chosen' });

      await service.settle(TENANT_A, RECEIVABLE_ID, {
        kind: 'RECEIVABLE',
        accountId: 'acc-chosen',
      });

      expect(prisma.financialAccount.findFirst).toHaveBeenCalledWith({
        where: { id: 'acc-chosen', tenantId: TENANT_A },
        select: { id: true },
      });
      expect(tx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-chosen' } }),
      );
    });

    it('should reject an account from another tenant', async () => {
      prisma.accountsReceivable.findFirst.mockResolvedValue(makeReceivable());
      prisma.financialAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.settle(TENANT_A, RECEIVABLE_ID, {
          kind: 'RECEIVABLE',
          accountId: 'acc-of-tenant-b',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when no account can be resolved', async () => {
      prisma.accountsReceivable.findFirst.mockResolvedValue(
        makeReceivable({ orderPayment: null, paymentMethod: null, metadata: null }),
      );

      await expect(
        service.settle(TENANT_A, RECEIVABLE_ID, { kind: 'RECEIVABLE' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should scope the lookup by tenant', async () => {
      prisma.accountsReceivable.findFirst.mockResolvedValue(null);

      await expect(
        service.settle(TENANT_B, RECEIVABLE_ID, { kind: 'RECEIVABLE' }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.accountsReceivable.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: RECEIVABLE_ID, tenantId: TENANT_B },
        }),
      );
    });
  });

  // ─── Payable ───────────────────────────────────────────────────────────

  describe('settle PAYABLE', () => {
    it('should debit the account and mark the payable PAID', async () => {
      prisma.accountsPayable.findFirst.mockResolvedValue(makePayable());
      tx.financialAccount.update.mockResolvedValue({ balance: 900 });

      const result = await service.settle(TENANT_A, PAYABLE_ID, { kind: 'PAYABLE' });

      expect(tx.financialAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { balance: { decrement: 100 } },
        select: { balance: true },
      });
      expect(tx.financialTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'DEBIT',
          amount: 100,
          balanceAfter: 900,
          referenceType: 'payable',
          referenceId: PAYABLE_ID,
        }),
      });
      expect(result.status).toBe('PAID');
    });

    it('should reject settling an already PAID payable', async () => {
      prisma.accountsPayable.findFirst.mockResolvedValue(
        makePayable({ status: 'PAID', paidAmount: 100 }),
      );

      await expect(
        service.settle(TENANT_A, PAYABLE_ID, { kind: 'PAYABLE' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── A gaveta acompanha a baixa paga pela conta do caixa ────────────────

  describe('reflexo no caixa', () => {
    // A conta de um caixa aberto é a gaveta: pagar um título por ela tira
    // dinheiro físico de dentro dela. Sem este reflexo, o fechamento contava
    // uma gaveta que ninguém tinha mexido e acusava diferença.
    it('espelha na gaveta o pagamento de um título', async () => {
      prisma.accountsPayable.findFirst.mockResolvedValue(makePayable());
      tx.financialAccount.update.mockResolvedValue({ balance: 500 });

      await service.settle(TENANT_A, PAYABLE_ID, { kind: 'PAYABLE' }, 'user-1');

      expect(cashRegisters.mirrorSettlementInDrawer).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          tenantId: TENANT_A,
          accountId: 'acc-1',
          direction: 'out',
          amount: 100,
          userId: 'user-1',
        }),
      );
    });

    it('espelha um recebimento como entrada na gaveta', async () => {
      prisma.accountsReceivable.findFirst.mockResolvedValue(makeReceivable());
      tx.financialAccount.update.mockResolvedValue({ balance: 1250 });

      await service.settle(TENANT_A, RECEIVABLE_ID, { kind: 'RECEIVABLE' }, 'user-1');

      expect(cashRegisters.mirrorSettlementInDrawer).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ direction: 'in', userId: 'user-1' }),
      );
    });

    it('não tenta refletir nada quando a baixa não sabe quem a fez', async () => {
      prisma.accountsPayable.findFirst.mockResolvedValue(makePayable());
      tx.financialAccount.update.mockResolvedValue({ balance: 500 });

      await service.settle(TENANT_A, PAYABLE_ID, { kind: 'PAYABLE' });

      expect(cashRegisters.mirrorSettlementInDrawer).not.toHaveBeenCalled();
    });
  });
  describe('settleWithin (baixa dentro da transação de quem chama)', () => {
    it('lê e grava pelo tx recebido, sem abrir outra transação', async () => {
      const tx = {
        ...createMockTx(),
        accountsPayable: {
          findFirst: jest.fn().mockResolvedValue(makePayable()),
          update: jest.fn().mockResolvedValue({}),
        },
        financialAccount: {
          findFirst: jest.fn().mockResolvedValue({ id: 'acc-drawer' }),
          update: jest.fn().mockResolvedValue({ balance: 400 }),
        },
      };
      const prisma = createMockPrisma(createMockTx());
      const cashRegisters = { mirrorSettlementInDrawer: jest.fn().mockResolvedValue(null) };
      const module = await Test.createTestingModule({
        providers: [
          FinancialSettlementsService,
          { provide: PrismaService, useValue: prisma },
          { provide: CashRegistersService, useValue: cashRegisters },
        ],
      }).compile();
      const service = module.get(FinancialSettlementsService);

      const result = await service.settleWithin(
        tx as never,
        TENANT_A,
        PAYABLE_ID,
        { kind: 'PAYABLE', accountId: 'acc-drawer' },
        'user-1',
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.accountsPayable.findFirst).not.toHaveBeenCalled();
      expect(tx.accountsPayable.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: PAYABLE_ID, tenantId: TENANT_A } }),
      );
      expect(tx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-drawer' }, data: { balance: { decrement: 100 } } }),
      );
      expect(cashRegisters.mirrorSettlementInDrawer).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ accountId: 'acc-drawer', direction: 'out', amount: 100 }),
      );
      expect(result.status).toBe('PAID');
    });
  });
});
