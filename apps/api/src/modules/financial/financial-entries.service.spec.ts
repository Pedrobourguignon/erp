import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { FinancialEntriesService } from './financial-entries.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { CashRegistersService } from '../cash-registers/cash-registers.service';

const TENANT_A = 'tenant-aaa-111';
const TENANT_B = 'tenant-bbb-222';

function createMockTx() {
  return {
    financialAccount: { update: jest.fn() },
    financialTransaction: { create: jest.fn() },
  };
}

function createMockPrisma(mockTx: ReturnType<typeof createMockTx>) {
  return {
    financialAccount: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    chartOfAccounts: { findFirst: jest.fn() },
    financialTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
    accountsReceivable: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null, paidAmount: null } }),
    },
    accountsPayable: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null, paidAmount: null } }),
    },
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
  };
}

describe('FinancialEntriesService', () => {
  let service: FinancialEntriesService;
  let prisma: ReturnType<typeof createMockPrisma>;
  let mockTx: ReturnType<typeof createMockTx>;
  let cashRegisters: { mirrorSettlementInDrawer: jest.Mock };

  beforeEach(async () => {
    mockTx = createMockTx();
    prisma = createMockPrisma(mockTx);

    cashRegisters = { mirrorSettlementInDrawer: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialEntriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CashRegistersService, useValue: cashRegisters },
      ],
    }).compile();

    service = module.get<FinancialEntriesService>(FinancialEntriesService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── create ───────────────────────────────────────────────────────────

  describe('create', () => {
    beforeEach(() => {
      prisma.financialAccount.findFirst.mockResolvedValue({ id: 'acc-1' });
    });

    it('should credit the account balance and create a CREDIT transaction for a paid revenue', async () => {
      mockTx.financialAccount.update.mockResolvedValue({ balance: 1500 });
      mockTx.financialTransaction.create.mockResolvedValue({
        id: 'trx-1',
        type: 'CREDIT',
        amount: 1500,
      });

      const result = await service.create(TENANT_A, {
        type: 'REVENUE',
        accountId: 'acc-1',
        amount: 1500,
        date: '2026-07-08',
        paid: true,
      });

      expect(mockTx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'acc-1' },
          data: { balance: { increment: 1500 } },
        }),
      );
      expect(mockTx.financialTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_A,
            type: 'CREDIT',
            balanceAfter: 1500,
            referenceType: 'manual',
          }),
        }),
      );
      expect(result).toMatchObject({ kind: 'TRANSACTION', type: 'REVENUE', status: 'PAID' });
      expect(prisma.accountsReceivable.create).not.toHaveBeenCalled();
    });

    it('should debit the account balance and create a DEBIT transaction for a paid expense', async () => {
      mockTx.financialAccount.update.mockResolvedValue({ balance: -200 });
      mockTx.financialTransaction.create.mockResolvedValue({
        id: 'trx-2',
        type: 'DEBIT',
        amount: 200,
      });

      const result = await service.create(TENANT_A, {
        type: 'EXPENSE',
        accountId: 'acc-1',
        amount: 200,
        date: '2026-07-08',
        paid: true,
      });

      expect(mockTx.financialAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { balance: { decrement: 200 } } }),
      );
      expect(result).toMatchObject({ kind: 'TRANSACTION', type: 'EXPENSE' });
    });

    it('should create a PENDING receivable for a term revenue without touching balance', async () => {
      prisma.accountsReceivable.create.mockResolvedValue({
        id: 'rec-1',
        status: 'PENDING',
        amount: 900,
      });

      const result = await service.create(TENANT_A, {
        type: 'REVENUE',
        accountId: 'acc-1',
        amount: 900,
        date: '2026-07-08',
        paid: false,
        dueDate: '2026-08-08',
      });

      expect(prisma.accountsReceivable.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_A,
            status: 'PENDING',
            metadata: { manual: true, financialAccountId: 'acc-1' },
          }),
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result).toMatchObject({ kind: 'RECEIVABLE', type: 'REVENUE' });
    });

    it('should create a PENDING payable for a term expense', async () => {
      prisma.accountsPayable.create.mockResolvedValue({
        id: 'pay-1',
        status: 'PENDING',
        amount: 500,
      });

      const result = await service.create(TENANT_A, {
        type: 'EXPENSE',
        accountId: 'acc-1',
        amount: 500,
        date: '2026-07-08',
        paid: false,
        dueDate: '2026-08-08',
      });

      expect(prisma.accountsPayable.create).toHaveBeenCalled();
      expect(result).toMatchObject({ kind: 'PAYABLE', type: 'EXPENSE' });
    });

    it('should throw BadRequestException for a term entry without dueDate', async () => {
      await expect(
        service.create(TENANT_A, {
          type: 'EXPENSE',
          accountId: 'acc-1',
          amount: 500,
          date: '2026-07-08',
          paid: false,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should throw NotFoundException when the account does not belong to the tenant', async () => {
      prisma.financialAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.create(TENANT_A, {
          type: 'REVENUE',
          accountId: 'acc-x',
          amount: 100,
          date: '2026-07-08',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.financialAccount.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'acc-x', tenantId: TENANT_A } }),
      );
    });

    it('should throw NotFoundException when the chart account does not belong to the tenant', async () => {
      prisma.chartOfAccounts.findFirst.mockResolvedValue(null);

      await expect(
        service.create(TENANT_A, {
          type: 'REVENUE',
          accountId: 'acc-1',
          chartAccountId: 'chart-x',
          amount: 100,
          date: '2026-07-08',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should scope every source query by tenantId and return merged data with totals', async () => {
      prisma.financialTransaction.findMany.mockResolvedValue([
        {
          id: 'trx-1',
          type: 'CREDIT',
          amount: 100,
          description: 'Receita manual',
          createdAt: new Date('2026-07-05'),
          accountId: 'acc-1',
          chartAccountId: null,
          chartAccount: null,
        },
      ]);
      prisma.financialTransaction.count.mockResolvedValue(1);
      prisma.financialTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 100 } }) // CREDIT
        .mockResolvedValueOnce({ _sum: { amount: null } }); // DEBIT

      const result = await service.findAll(TENANT_A, { page: 1, limit: 20 });

      expect(prisma.financialTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_A }),
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ kind: 'TRANSACTION', type: 'REVENUE' });
      expect(result.meta.total).toBe(1);
      expect(result.totals.revenue).toBe(100);
      expect(result.totals.balance).toBe(100);
    });

    // ─── FN-04: a tela precisa saber o que pode editar ──────────────────

    it('flags a título that came from an order so the UI does not offer to edit it', async () => {
      prisma.accountsReceivable.findMany.mockResolvedValue([
        {
          id: 'ar-1',
          amount: 100,
          paidAmount: 0,
          description: 'PED-000010',
          dueDate: new Date('2026-08-10T03:00:00.000Z'),
          status: 'PENDING',
          chartAccountId: null,
          chartAccount: null,
          metadata: null,
          orderPayment: null,
          paymentMethod: null,
          orderId: 'order-1',
        },
      ]);
      prisma.accountsReceivable.count.mockResolvedValue(1);

      const result = await service.findAll(TENANT_A, {});

      expect(result.data[0].fromDocument).toBe(true);
    });

    it('marks a manual título as editable', async () => {
      prisma.accountsReceivable.findMany.mockResolvedValue([
        {
          id: 'ar-2',
          amount: 100,
          paidAmount: 0,
          description: 'Receita manual',
          dueDate: new Date('2026-08-10T03:00:00.000Z'),
          status: 'PENDING',
          chartAccountId: null,
          chartAccount: null,
          metadata: null,
          orderPayment: null,
          paymentMethod: null,
          orderId: null,
        },
      ]);
      prisma.accountsReceivable.count.mockResolvedValue(1);

      const result = await service.findAll(TENANT_A, {});

      expect(result.data[0].fromDocument).toBe(false);
    });

    // ─── FN-04: título excluído não volta na listagem ───────────────────

    it('leaves soft-deleted títulos out of the list and of the totals', async () => {
      await service.findAll(TENANT_A, {});

      const listWhere = prisma.accountsReceivable.findMany.mock.calls[0][0].where;
      const totalsWhere = prisma.accountsReceivable.aggregate.mock.calls[0][0].where;
      expect(listWhere.deletedAt).toBeNull();
      expect(totalsWhere.deletedAt).toBeNull();

      const payableWhere = prisma.accountsPayable.findMany.mock.calls[0][0].where;
      expect(payableWhere.deletedAt).toBeNull();
    });

    // ─── FN-12: transferência entre contas próprias não é receita nem despesa

    describe('internal transfers (FN-12)', () => {
      // Moving R$ 250 from Santander to Caixa raised Receitas *and* Despesas by
      // 250: the money never entered or left the company, so a DRE built on
      // these totals was inflated on both sides.
      function transferRow(direction: 'in' | 'out') {
        return {
          id: `trx-${direction}`,
          type: direction === 'in' ? 'CREDIT' : 'DEBIT',
          amount: 250,
          description: 'Transferência Santander → Caixa Principal',
          createdAt: new Date('2026-08-01T12:00:00.000Z'),
          accountId: direction === 'in' ? 'acc-2' : 'acc-1',
          chartAccountId: null,
          chartAccount: null,
          referenceType: 'transfer',
        };
      }

      it('excludes transfers from the revenue and expense totals', async () => {
        await service.findAll(TENANT_A, {});

        const [creditCall, debitCall] =
          prisma.financialTransaction.aggregate.mock.calls;
        expect(creditCall[0].where.referenceType).toEqual({ not: 'transfer' });
        expect(debitCall[0].where.referenceType).toEqual({ not: 'transfer' });
      });

      it('still lists them when no type filter is applied', async () => {
        await service.findAll(TENANT_A, {});

        const where = prisma.financialTransaction.findMany.mock.calls[0][0].where;
        // Out of the totals, but never out of the list: the operator has to be
        // able to see that the money moved between the company's own accounts.
        expect(where.referenceType).toBeUndefined();
      });

      it('still lists the two legs, labelled as transfers', async () => {
        prisma.financialTransaction.findMany.mockResolvedValue([
          transferRow('out'),
          transferRow('in'),
        ]);
        prisma.financialTransaction.count.mockResolvedValue(2);

        const result = await service.findAll(TENANT_A, {});

        expect(result.data).toHaveLength(2);
        expect(result.data.every((e) => e.type === 'TRANSFER')).toBe(true);
      });

      it('keeps a normal sale as REVENUE', async () => {
        prisma.financialTransaction.findMany.mockResolvedValue([
          { ...transferRow('in'), referenceType: 'order' },
        ]);
        prisma.financialTransaction.count.mockResolvedValue(1);

        const result = await service.findAll(TENANT_A, {});

        expect(result.data[0].type).toBe('REVENUE');
      });

      it('keeps a settlement as REVENUE or EXPENSE', async () => {
        prisma.financialTransaction.findMany.mockResolvedValue([
          { ...transferRow('out'), referenceType: 'payable' },
        ]);
        prisma.financialTransaction.count.mockResolvedValue(1);

        const result = await service.findAll(TENANT_A, {});

        expect(result.data[0].type).toBe('EXPENSE');
      });

      it('hides both legs when the user filters by REVENUE', async () => {
        await service.findAll(TENANT_A, { type: 'REVENUE' });

        const where = prisma.financialTransaction.findMany.mock.calls[0][0].where;
        // Filtering "receitas" must not surface the credit leg of a transfer:
        // it is not revenue, and showing it there is what made the total lie.
        expect(where.referenceType).toEqual({ not: 'transfer' });
      });

      it('counts the listed rows with the same filter it lists them', async () => {
        await service.findAll(TENANT_A, {});

        const listWhere =
          prisma.financialTransaction.findMany.mock.calls[0][0].where;
        const countWhere = prisma.financialTransaction.count.mock.calls[0][0].where;
        expect(countWhere).toEqual(listWhere);
      });

      it('shows only transfers when the user asks for them', async () => {
        await service.findAll(TENANT_A, { type: 'TRANSFER' });

        const where = prisma.financialTransaction.findMany.mock.calls[0][0].where;
        expect(where.referenceType).toBe('transfer');
        // A título is never a transfer, so neither side is queried.
        expect(prisma.accountsReceivable.findMany).not.toHaveBeenCalled();
        expect(prisma.accountsPayable.findMany).not.toHaveBeenCalled();
      });
    });

    // ─── FN-03: um título vencido precisa aparecer como Vencido ─────────

    describe('OVERDUE (FN-03)', () => {
      // Nothing in the codebase ever promoted a título to OVERDUE: the seed's
      // receivables were due in March and still read "Em aberto" in August.
      // The status is derived on read (no waiting for a job) and materialised
      // by the daily job, so filters and reports agree.
      const YESTERDAY = new Date('2026-07-31T03:00:00.000Z');
      const TOMORROW = new Date('2026-08-02T03:00:00.000Z');

      beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-08-01T15:00:00.000Z'));
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      function receivable(overrides: Record<string, unknown>) {
        return {
          id: 'ar-1',
          amount: 300,
          paidAmount: 0,
          description: 'Título',
          dueDate: YESTERDAY,
          status: 'PENDING',
          chartAccountId: null,
          chartAccount: null,
          metadata: null,
          orderPayment: null,
          paymentMethod: null,
          ...overrides,
        };
      }

      it('reads a PENDING título past its due date as OVERDUE', async () => {
        prisma.accountsReceivable.findMany.mockResolvedValue([receivable({})]);
        prisma.accountsReceivable.count.mockResolvedValue(1);

        const result = await service.findAll(TENANT_A, {});

        expect(result.data[0].status).toBe('OVERDUE');
      });

      it('leaves a título due today alone — the day is not over', async () => {
        prisma.accountsReceivable.findMany.mockResolvedValue([
          receivable({ dueDate: new Date('2026-08-01T03:00:00.000Z') }),
        ]);
        prisma.accountsReceivable.count.mockResolvedValue(1);

        const result = await service.findAll(TENANT_A, {});

        expect(result.data[0].status).toBe('PENDING');
      });

      it('leaves a future título alone', async () => {
        prisma.accountsReceivable.findMany.mockResolvedValue([
          receivable({ dueDate: TOMORROW }),
        ]);
        prisma.accountsReceivable.count.mockResolvedValue(1);

        const result = await service.findAll(TENANT_A, {});

        expect(result.data[0].status).toBe('PENDING');
      });

      it('promotes a partially paid título too — the rest is still late', async () => {
        prisma.accountsReceivable.findMany.mockResolvedValue([
          receivable({ status: 'PARTIALLY_PAID', paidAmount: 100 }),
        ]);
        prisma.accountsReceivable.count.mockResolvedValue(1);

        const result = await service.findAll(TENANT_A, {});

        expect(result.data[0].status).toBe('OVERDUE');
      });

      it('never re-labels a settled or cancelled título', async () => {
        prisma.accountsPayable.findMany.mockResolvedValue([
          { ...receivable({ status: 'CANCELLED' }), id: 'ap-1' },
        ]);
        prisma.accountsPayable.count.mockResolvedValue(1);

        const result = await service.findAll(TENANT_A, { type: 'EXPENSE' });

        expect(result.data[0].status).toBe('CANCELLED');
      });

      it('filters by OVERDUE with the same rule the list displays', async () => {
        await service.findAll(TENANT_A, { status: 'OVERDUE' });

        const where = prisma.accountsReceivable.findMany.mock.calls[0][0].where;
        expect(where.status).toEqual({ in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] });
        // Past due date, in the tenant timezone: 2026-08-01 00:00 BRT = 03:00Z
        expect(where.dueDate).toEqual({ lt: new Date('2026-08-01T03:00:00.000Z') });
      });

      it('lists the overdue títulos before everything else', async () => {
        prisma.financialTransaction.findMany.mockResolvedValue([
          {
            id: 'trx-1',
            type: 'CREDIT',
            amount: 100,
            description: 'Venda de hoje',
            createdAt: new Date('2026-08-01T12:00:00.000Z'),
            accountId: 'acc-1',
            chartAccountId: null,
            chartAccount: null,
          },
        ]);
        prisma.accountsReceivable.findMany.mockResolvedValue([receivable({})]);
        prisma.financialTransaction.count.mockResolvedValue(1);
        prisma.accountsReceivable.count.mockResolvedValue(1);

        const result = await service.findAll(TENANT_A, {});

        // The transaction is newer, so date ordering alone would bury the
        // overdue título — the one row the user has to act on.
        expect(result.data.map((e) => e.status)).toEqual(['OVERDUE', 'PAID']);
      });

      it('reports the overdue total as its own figure', async () => {
        prisma.accountsReceivable.aggregate.mockResolvedValue({
          _sum: { amount: 500, paidAmount: 100 },
        });
        prisma.accountsPayable.aggregate.mockResolvedValue({
          _sum: { amount: 200, paidAmount: 0 },
        });

        const result = await service.findAll(TENANT_A, {});

        expect(result.totals.overdueRevenue).toBe(400);
        expect(result.totals.overdueExpense).toBe(200);
      });
    });

    // ─── FN-28: nenhum ruído de ponto flutuante na resposta ──────────────

    describe('rounding (FN-28)', () => {
      it('does not leak float noise into the totals', async () => {
        // The API answered "balance": 708.9000000000001 for exactly this shape:
        // a CREDIT of 299.80 plus an open receivable of 409.10.
        prisma.financialTransaction.aggregate
          .mockResolvedValueOnce({ _sum: { amount: 299.8 } })
          .mockResolvedValueOnce({ _sum: { amount: null } });
        prisma.accountsReceivable.aggregate.mockResolvedValue({
          _sum: { amount: 409.1, paidAmount: null },
        });

        const result = await service.findAll(TENANT_A, {});

        expect(result.totals.revenue).toBe(708.9);
        expect(result.totals.balance).toBe(708.9);
      });

      it('keeps the balance clean when revenue and expense both drift', async () => {
        prisma.financialTransaction.aggregate
          .mockResolvedValueOnce({ _sum: { amount: 1000.1 } })
          .mockResolvedValueOnce({ _sum: { amount: 999.9 } });

        const result = await service.findAll(TENANT_A, {});

        expect(result.totals.balance).toBe(0.2);
      });

      it('rounds the outstanding amount of a título to cents', async () => {
        prisma.accountsReceivable.findMany.mockResolvedValue([
          {
            id: 'ar-1',
            amount: 708.9,
            paidAmount: 299.8,
            description: 'PED-000009',
            dueDate: new Date('2026-08-01'),
            status: 'PARTIALLY_PAID',
            chartAccountId: null,
            chartAccount: null,
            metadata: null,
            orderPayment: null,
            paymentMethod: null,
          },
        ]);
        prisma.accountsReceivable.count.mockResolvedValue(1);

        const result = await service.findAll(TENANT_A, {});

        expect(result.data[0].amount).toBe(409.1);
      });
    });

    // ─── SCRUM-41: sales must show up as receitas ─────────────────────────
    describe('sales (SCRUM-41)', () => {
      it('should NOT restrict transactions to manual entries', async () => {
        await service.findAll(TENANT_A, {});

        const where = prisma.financialTransaction.findMany.mock.calls[0][0].where;
        // A sale books a transaction with referenceType 'order'; filtering by
        // 'manual' is what used to hide it from the list.
        expect(where.referenceType).toBeUndefined();
      });

      it('should list the transaction of a counter sale as a receita', async () => {
        prisma.financialTransaction.findMany.mockResolvedValue([
          {
            id: 'trx-sale',
            type: 'CREDIT',
            amount: 250,
            description: 'Venda balcão PED-000001 - Dinheiro',
            createdAt: new Date('2026-07-10'),
            accountId: 'acc-1',
            chartAccountId: null,
            chartAccount: null,
          },
        ]);
        prisma.financialTransaction.count.mockResolvedValue(1);

        const result = await service.findAll(TENANT_A, {});

        expect(result.data[0]).toMatchObject({
          kind: 'TRANSACTION',
          type: 'REVENUE',
          amount: 250,
          description: 'Venda balcão PED-000001 - Dinheiro',
        });
      });

      it('should NOT restrict títulos to manual entries', async () => {
        await service.findAll(TENANT_A, {});

        const where = prisma.accountsReceivable.findMany.mock.calls[0][0].where;
        expect(where.metadata).toBeUndefined();
        expect(where.tenantId).toBe(TENANT_A);
      });

      it('should list only open títulos (a settled one is represented by its transaction)', async () => {
        await service.findAll(TENANT_A, {});

        const where = prisma.accountsReceivable.findMany.mock.calls[0][0].where;
        expect(where.status).toEqual({
          in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'],
        });
      });

      it('should skip títulos entirely when filtering by PAID', async () => {
        await service.findAll(TENANT_A, { status: 'PAID' });

        expect(prisma.accountsReceivable.findMany).not.toHaveBeenCalled();
        expect(prisma.accountsPayable.findMany).not.toHaveBeenCalled();
        expect(prisma.financialTransaction.findMany).toHaveBeenCalled();
      });

      it('should report the outstanding balance of a partially paid título', async () => {
        prisma.accountsReceivable.findMany.mockResolvedValue([
          {
            id: 'ar-1',
            amount: 250,
            paidAmount: 100,
            description: 'PED-000002 - Boleto',
            dueDate: new Date('2026-08-01'),
            status: 'PARTIALLY_PAID',
            chartAccountId: null,
            chartAccount: null,
            metadata: null,
            orderPayment: { financialAccountId: 'acc-1' },
            paymentMethod: null,
          },
        ]);
        prisma.accountsReceivable.count.mockResolvedValue(1);

        const result = await service.findAll(TENANT_A, {});

        // 250 owed - 100 already received = 150 still open
        expect(result.data[0]).toMatchObject({ kind: 'RECEIVABLE', amount: 150 });
      });

      it('should total open títulos by their outstanding balance', async () => {
        prisma.accountsReceivable.aggregate.mockResolvedValue({
          _sum: { amount: 250, paidAmount: 100 },
        });

        const result = await service.findAll(TENANT_A, { type: 'REVENUE' });

        expect(result.totals.revenue).toBe(150);
      });

      it('should resolve the account name of a sale título from its order payment', async () => {
        prisma.financialAccount.findMany.mockResolvedValue([
          { id: 'acc-1', name: 'Conta Corrente' },
        ]);
        prisma.accountsReceivable.findMany.mockResolvedValue([
          {
            id: 'ar-1',
            amount: 250,
            paidAmount: 0,
            description: 'PED-000002 - Boleto',
            dueDate: new Date('2026-08-01'),
            status: 'PENDING',
            chartAccountId: null,
            chartAccount: null,
            metadata: null,
            orderPayment: { financialAccountId: 'acc-1' },
            paymentMethod: null,
          },
        ]);
        prisma.accountsReceivable.count.mockResolvedValue(1);

        const result = await service.findAll(TENANT_A, {});

        expect(result.data[0]).toMatchObject({
          accountId: 'acc-1',
          accountName: 'Conta Corrente',
        });
      });
    });

    // FN-01: the range used to end at 02:59 UTC of the last day (setHours in the
    // process timezone), so `startDate=endDate=31/07` returned 4 of 11 records.
    describe('date range (FN-01)', () => {
      it('should cover whole civil days in the tenant timezone', async () => {
        await service.findAll(TENANT_A, {
          startDate: '2026-07-31',
          endDate: '2026-07-31',
        });

        const where = prisma.financialTransaction.findMany.mock.calls[0][0].where;
        expect(where.createdAt).toEqual({
          gte: new Date('2026-07-31T03:00:00.000Z'),
          lte: new Date('2026-08-01T02:59:59.999Z'),
        });
      });

      it('should include an entry made at 23:50 of the last day', async () => {
        await service.findAll(TENANT_A, {
          startDate: '2026-07-31',
          endDate: '2026-07-31',
        });

        const { gte, lte } = prisma.financialTransaction.findMany.mock.calls[0][0].where.createdAt;
        const lateEntry = new Date('2026-08-01T02:50:00.000Z');

        expect(lateEntry >= gte && lateEntry <= lte).toBe(true);
      });

      // FN-23: the UI warns first, but an inverted range must not read as "no results".
      it('should swap an inverted range instead of returning nothing', async () => {
        await service.findAll(TENANT_A, {
          startDate: '2026-12-31',
          endDate: '2026-01-01',
        });

        const where = prisma.financialTransaction.findMany.mock.calls[0][0].where;
        expect(where.createdAt.gte < where.createdAt.lte).toBe(true);
      });
    });

    it('should exclude transactions when filtering by OPEN status', async () => {
      await service.findAll(TENANT_A, { status: 'OPEN' });

      expect(prisma.financialTransaction.findMany).not.toHaveBeenCalled();
      expect(prisma.accountsReceivable.findMany).toHaveBeenCalled();
      expect(prisma.accountsPayable.findMany).toHaveBeenCalled();
    });

    it('should only query receivables when filtering type REVENUE', async () => {
      await service.findAll(TENANT_A, { type: 'REVENUE' });

      expect(prisma.accountsPayable.findMany).not.toHaveBeenCalled();
      expect(prisma.accountsReceivable.findMany).toHaveBeenCalled();
      expect(prisma.financialTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'CREDIT' }),
        }),
      );
    });

    it('should compute the period balance as revenue minus expense', async () => {
      prisma.financialTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 300 } }) // CREDIT
        .mockResolvedValueOnce({ _sum: { amount: 120 } }); // DEBIT

      const result = await service.findAll(TENANT_A, {});

      expect(result.totals.revenue).toBe(300);
      expect(result.totals.expense).toBe(120);
      expect(result.totals.balance).toBe(180);
    });

    it('should scope títulos by tenant', async () => {
      await service.findAll(TENANT_B, {});

      expect(prisma.accountsReceivable.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_B }),
        }),
      );
      expect(prisma.accountsPayable.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT_B }),
        }),
      );
    });
  });

  // ─── Despesa paga pela conta do caixa sai da gaveta ─────────────────────

  describe('lançamento à vista pela conta de um caixa', () => {
    // Pagar a conta de luz pela conta do caixa tira dinheiro da gaveta. Sem o
    // movimento, o fechamento seguia esperando a nota que já tinha saído.
    beforeEach(() => {
      prisma.financialAccount.findFirst.mockResolvedValue({ id: 'acc-1' });
      mockTx.financialAccount.update.mockResolvedValue({ balance: 300 });
      mockTx.financialTransaction.create.mockResolvedValue({ id: 'ft-1' });
      prisma.accountsPayable.create.mockResolvedValue({ id: 'ap-1' });
    });

    it('espelha a despesa como sangria na gaveta', async () => {
      await service.create(
        TENANT_A,
        {
          type: 'EXPENSE',
          description: 'Conta de luz',
          amount: 120,
          date: '2026-08-19',
          accountId: 'acc-1',
        } as never,
        'user-1',
      );

      expect(cashRegisters.mirrorSettlementInDrawer).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          accountId: 'acc-1',
          direction: 'out',
          amount: 120,
          userId: 'user-1',
        }),
      );
    });

    it('espelha uma receita como suprimento', async () => {
      await service.create(
        TENANT_A,
        {
          type: 'REVENUE',
          description: 'Aporte do sócio',
          amount: 500,
          date: '2026-08-19',
          accountId: 'acc-1',
        } as never,
        'user-1',
      );

      expect(cashRegisters.mirrorSettlementInDrawer).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ direction: 'in', amount: 500 }),
      );
    });

    it('não reflete nada num título a prazo — ali o dinheiro não se move ainda', async () => {
      await service.create(
        TENANT_A,
        {
          type: 'EXPENSE',
          description: 'Fornecedor',
          amount: 300,
          date: '2026-08-19',
          dueDate: '2026-09-19',
          paid: false,
          accountId: 'acc-1',
        } as never,
        'user-1',
      );

      expect(cashRegisters.mirrorSettlementInDrawer).not.toHaveBeenCalled();
    });
  });
});
