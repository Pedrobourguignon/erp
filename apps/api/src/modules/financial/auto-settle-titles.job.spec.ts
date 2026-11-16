import { Test, TestingModule } from '@nestjs/testing';
import { AutoSettleTitlesJob } from './auto-settle-titles.job';
import { FinancialSettlementsService } from './financial-settlements.service';
import { PrismaService } from '../../database/prisma/prisma.service';

/**
 * Antecipação combinada com a operadora: o lojista cadastra o prazo na forma de
 * pagamento e o dinheiro entra sozinho no dia, sem alguém dar baixa título a
 * título.
 */
describe('AutoSettleTitlesJob', () => {
  let job: AutoSettleTitlesJob;
  let prisma: {
    accountsReceivable: { findMany: jest.Mock };
    accountsPayable: { findMany: jest.Mock };
  };
  let settlements: { settle: jest.Mock };

  beforeEach(async () => {
    prisma = {
      accountsReceivable: { findMany: jest.fn().mockResolvedValue([]) },
      accountsPayable: { findMany: jest.fn().mockResolvedValue([]) },
    };
    settlements = { settle: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoSettleTitlesJob,
        { provide: PrismaService, useValue: prisma },
        { provide: FinancialSettlementsService, useValue: settlements },
      ],
    }).compile();

    job = module.get(AutoSettleTitlesJob);
    // 12/08 10:00 em Brasília
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T13:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('looks only for open títulos of an autoSettle method that are due up to today', async () => {
    await job.settleDueTitles();

    const receivableWhere = prisma.accountsReceivable.findMany.mock.calls[0][0].where;
    expect(receivableWhere).toEqual({
      status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
      dueDate: { lte: new Date('2026-08-12T03:00:00.000Z') },
      paymentMethod: { autoSettle: true },
    });

    const payableWhere = prisma.accountsPayable.findMany.mock.calls[0][0].where;
    expect(payableWhere).toEqual({
      status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
      dueDate: { lte: new Date('2026-08-12T03:00:00.000Z') },
      paymentMethod: { autoSettle: true },
      metadata: { path: ['kind'], equals: 'PAYMENT_FEE' },
    });
  });

  it('settles each receivable in its own tenant, dated on its due day', async () => {
    prisma.accountsReceivable.findMany.mockResolvedValue([
      { id: 'r-1', tenantId: 'tenant-a', dueDate: new Date('2026-08-12T03:00:00.000Z') },
      { id: 'r-2', tenantId: 'tenant-b', dueDate: new Date('2026-08-10T03:00:00.000Z') },
    ]);

    const result = await job.settleDueTitles();

    expect(settlements.settle).toHaveBeenCalledWith('tenant-a', 'r-1', {
      kind: 'RECEIVABLE',
      paidAt: '2026-08-12',
    });
    // atrasado: entra com a data em que deveria ter caído
    expect(settlements.settle).toHaveBeenCalledWith('tenant-b', 'r-2', {
      kind: 'RECEIVABLE',
      paidAt: '2026-08-10',
    });
    expect(result).toEqual({ settled: 2, failed: 0 });
  });

  it('also pays the acquirer fee of the same method', async () => {
    prisma.accountsPayable.findMany.mockResolvedValue([
      { id: 'p-1', tenantId: 'tenant-a', dueDate: new Date('2026-08-12T03:00:00.000Z') },
    ]);

    const result = await job.settleDueTitles();

    expect(settlements.settle).toHaveBeenCalledWith('tenant-a', 'p-1', {
      kind: 'PAYABLE',
      paidAt: '2026-08-12',
    });
    expect(result.settled).toBe(1);
  });

  it('keeps going when one título cannot be settled (e.g. no account)', async () => {
    prisma.accountsReceivable.findMany.mockResolvedValue([
      { id: 'r-1', tenantId: 'tenant-a', dueDate: new Date('2026-08-12T03:00:00.000Z') },
      { id: 'r-2', tenantId: 'tenant-a', dueDate: new Date('2026-08-12T03:00:00.000Z') },
    ]);
    settlements.settle
      .mockRejectedValueOnce(new Error('Nenhuma conta financeira definida'))
      .mockResolvedValueOnce({});

    const result = await job.settleDueTitles();

    expect(settlements.settle).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ settled: 1, failed: 1 });
  });
});
