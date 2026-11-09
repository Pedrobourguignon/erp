import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma, FinancialStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { CashRegistersService } from '../cash-registers/cash-registers.service';
import {
  CreateFinancialEntryDto,
  FinancialEntryQueryDto,
  FinancialEntryListType,
} from './dto/financial-entry.dto';
import {
  PaginatedResponse,
  buildPaginatedResponse,
} from '../../common/utils/pagination';
import {
  startOfDayInTz,
  toDateRange,
  toLocalDateKey,
} from '../../common/utils/date-range.util';
import { subtractMoney, sumMoney, toMoney } from '../../common/utils/money.util';

const OPEN_STATUSES: FinancialStatus[] = [
  'PENDING',
  'PARTIALLY_PAID',
  'OVERDUE',
];

/**
 * `referenceType` of the two legs of an internal transfer.
 *
 * FN-12: both legs used to be classified like any other movement — the DEBIT as
 * despesa and the CREDIT as receita — so moving R$ 250 between the company's own
 * accounts raised Receitas *and* Despesas by 250. The money never crossed the
 * company's boundary: it is neither.
 */
const TRANSFER_REFERENCE = 'transfer';

/** Prisma fragment excluding both legs of an internal transfer. */
const NOT_A_TRANSFER = { referenceType: { not: TRANSFER_REFERENCE } };

/** Unified list item (SCRUM-11). */
export interface FinancialEntry {
  id: string;
  kind: 'TRANSACTION' | 'RECEIVABLE' | 'PAYABLE';
  type: FinancialEntryListType;
  description: string;
  amount: number;
  date: Date;
  status: 'PAID' | 'PENDING' | 'PARTIALLY_PAID' | 'OVERDUE' | 'CANCELLED' | 'REFUNDED';
  accountId: string | null;
  accountName: string | null;
  chartAccountId: string | null;
  categoryName: string | null;
  /**
   * FN-04: o título nasceu de um pedido ou de uma compra. A UI não oferece
   * editar nem excluir esses — eles pertencem ao ciclo do documento de origem.
   */
  fromDocument: boolean;
}

export interface FinancialEntriesTotals {
  revenue: number;
  expense: number;
  balance: number;
  /** Open receivables already past their due date (FN-03). */
  overdueRevenue: number;
  /** Open payables already past their due date (FN-03). */
  overdueExpense: number;
}

/**
 * Midnight of today in the tenant's timezone.
 *
 * FN-03: a título is late once the day it was due has **ended**. Comparing
 * against `new Date()` would flag a título due today from 00:01 onwards, and
 * comparing in the process timezone would flag it a few hours early or late
 * depending on where the container runs (TZ-01).
 */
export function startOfToday(): Date {
  return startOfDayInTz(toLocalDateKey(new Date()));
}

/** Whether an open título should read as OVERDUE right now. */
export function isOverdue(
  status: FinancialEntry['status'],
  dueDate: Date,
  today: Date = startOfToday(),
): boolean {
  if (status !== 'PENDING' && status !== 'PARTIALLY_PAID') return false;
  return dueDate.getTime() < today.getTime();
}

@Injectable()
export class FinancialEntriesService {
  private readonly logger = new Logger(FinancialEntriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashRegisters: CashRegistersService,
  ) {}

  // ─── Create (SCRUM-10) ──────────────────────────────────────────────────

  async create(
    tenantId: string,
    dto: CreateFinancialEntryDto,
    userId?: string,
  ) {
    const account = await this.prisma.financialAccount.findFirst({
      where: { id: dto.accountId, tenantId },
      select: { id: true },
    });
    if (!account) {
      throw new NotFoundException(
        `Conta financeira não encontrada`,
      );
    }

    if (dto.chartAccountId) {
      const chart = await this.prisma.chartOfAccounts.findFirst({
        where: { id: dto.chartAccountId, tenantId },
        select: { id: true },
      });
      if (!chart) {
        throw new NotFoundException(
          `Categoria contábil não encontrada`,
        );
      }
    }

    const paid = dto.paid ?? true;
    const isRevenue = dto.type === 'REVENUE';
    const amount = dto.amount;
    // FN-02: `new Date('2026-01-15')` is midnight *UTC*, which is 21:00 of the
    // 14th in BRT — the user typed 15/01 and every screen showed 14/01. A date
    // the user picked is a civil date: midnight in the tenant's timezone.
    const date = startOfDayInTz(dto.date);
    const description =
      dto.description?.trim() || (isRevenue ? 'Receita manual' : 'Despesa manual');

    if (!paid && !dto.dueDate) {
      throw new BadRequestException(
        'Informe o vencimento para um lançamento a prazo',
      );
    }

    if (paid) {
      return this.createCashEntry(tenantId, {
        userId,
        accountId: dto.accountId,
        chartAccountId: dto.chartAccountId,
        isRevenue,
        amount,
        date,
        description,
      });
    }

    return this.createTermEntry(tenantId, {
      accountId: dto.accountId,
      chartAccountId: dto.chartAccountId,
      isRevenue,
      amount,
      dueDate: startOfDayInTz(dto.dueDate as string),
      description,
    });
  }

  private async createCashEntry(
    tenantId: string,
    input: {
      accountId: string;
      chartAccountId?: string;
      isRevenue: boolean;
      amount: number;
      date: Date;
      description: string;
      userId?: string;
    },
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const account = await tx.financialAccount.update({
        where: { id: input.accountId },
        data: {
          balance: input.isRevenue
            ? { increment: input.amount }
            : { decrement: input.amount },
        },
        select: { balance: true },
      });

      // Uma despesa paga pela conta de um caixa aberto sai da gaveta. Sem
      // isto, o dinheiro saía do saldo da conta e a contagem do fechamento
      // continuava esperando a nota que já não estava lá.
      if (input.userId) {
        await this.cashRegisters.mirrorSettlementInDrawer(tx, {
          tenantId,
          accountId: input.accountId,
          direction: input.isRevenue ? 'in' : 'out',
          amount: input.amount,
          reason: input.description,
          userId: input.userId,
        });
      }

      return tx.financialTransaction.create({
        data: {
          tenantId,
          accountId: input.accountId,
          type: input.isRevenue ? 'CREDIT' : 'DEBIT',
          amount: input.amount,
          balanceAfter: account.balance,
          description: input.description,
          chartAccountId: input.chartAccountId ?? null,
          referenceType: 'manual',
          createdAt: input.date,
        },
      });
    });

    this.logger.log(
      `Manual cash entry created: ${result.type} ${input.amount} on account ${input.accountId} (tenant ${tenantId})`,
    );

    return {
      kind: 'TRANSACTION' as const,
      id: result.id,
      type: input.isRevenue ? 'REVENUE' : 'EXPENSE',
      status: 'PAID',
      amount: toMoney(result.amount),
    };
  }

  private async createTermEntry(
    tenantId: string,
    input: {
      accountId: string;
      chartAccountId?: string;
      isRevenue: boolean;
      amount: number;
      dueDate: Date;
      description: string;
    },
  ) {
    const data = {
      tenantId,
      description: input.description,
      amount: input.amount,
      dueDate: input.dueDate,
      status: 'PENDING' as const,
      chartAccountId: input.chartAccountId ?? null,
      metadata: { manual: true, financialAccountId: input.accountId },
    };

    if (input.isRevenue) {
      const receivable = await this.prisma.accountsReceivable.create({ data });
      this.logger.log(
        `Manual receivable created: ${receivable.id} (tenant ${tenantId})`,
      );
      return {
        kind: 'RECEIVABLE' as const,
        id: receivable.id,
        type: 'REVENUE',
        status: receivable.status,
        amount: toMoney(receivable.amount),
      };
    }

    const payable = await this.prisma.accountsPayable.create({ data });
    this.logger.log(
      `Manual payable created: ${payable.id} (tenant ${tenantId})`,
    );
    return {
      kind: 'PAYABLE' as const,
      id: payable.id,
      type: 'EXPENSE',
      status: payable.status,
      amount: toMoney(payable.amount),
    };
  }

  // ─── List with filters + totals (SCRUM-11) ──────────────────────────────

  async findAll(
    tenantId: string,
    query: FinancialEntryQueryDto,
  ): Promise<PaginatedResponse<FinancialEntry> & { totals: FinancialEntriesTotals }> {
    const { page = 1, limit = 20, type, accountId, status } = query;
    const skip = (page - 1) * limit;

    const includeRevenue = !type || type === 'REVENUE';
    const includeExpense = !type || type === 'EXPENSE';
    // A transfer only ever exists as a pair of transactions — no título is one.
    const onlyTransfers = type === 'TRANSFER';
    // A FinancialTransaction is money that already moved — manual entries and
    // sales alike (SCRUM-41). A título is money still owed, so a settled one is
    // dropped from the list: its transaction already represents it, and listing
    // both would count the same money twice.
    const includeTransactions = status !== 'OPEN' && status !== 'OVERDUE';
    const includeTitulos = status !== 'PAID' && !onlyTransfers;
    // FN-03: "vencido" is a slice of the open títulos, never a transaction —
    // money that already moved cannot be late.
    const onlyOverdue = status === 'OVERDUE';

    const dateRange = this.buildDateRange(query.startDate, query.endDate);
    const accountsMap = await this.loadAccountNames(tenantId);

    const txWhere = this.buildTransactionWhere(tenantId, {
      dateRange,
      includeRevenue,
      includeExpense,
      accountId,
      onlyTransfers,
      // Only when the user explicitly asked for receitas or despesas: with no
      // filter the transfer legs stay in the list (they are just not totalled).
      excludeTransfers: !!type && type !== 'TRANSFER',
    });
    const recWhere = this.buildReceivableWhere(tenantId, {
      dateRange,
      accountId,
      onlyOverdue,
    });
    const payWhere = this.buildPayableWhere(tenantId, {
      dateRange,
      accountId,
      onlyOverdue,
    });

    const fetchLimit = skip + limit;
    const [txRows, recRows, payRows, txCount, recCount, payCount] =
      await Promise.all([
        includeTransactions
          ? this.prisma.financialTransaction.findMany({
              where: txWhere,
              orderBy: { createdAt: 'desc' },
              take: fetchLimit,
              include: { chartAccount: { select: { name: true } } },
            })
          : Promise.resolve([]),
        includeTitulos && includeRevenue
          ? this.prisma.accountsReceivable.findMany({
              where: recWhere,
              orderBy: { dueDate: 'desc' },
              take: fetchLimit,
              include: {
                chartAccount: { select: { name: true } },
                orderPayment: { select: { financialAccountId: true } },
                paymentMethod: { select: { defaultAccountId: true } },
              },
            })
          : Promise.resolve([]),
        includeTitulos && includeExpense
          ? this.prisma.accountsPayable.findMany({
              where: payWhere,
              orderBy: { dueDate: 'desc' },
              take: fetchLimit,
              include: {
                chartAccount: { select: { name: true } },
                paymentMethod: { select: { defaultAccountId: true } },
              },
            })
          : Promise.resolve([]),
        includeTransactions
          ? this.prisma.financialTransaction.count({ where: txWhere })
          : Promise.resolve(0),
        includeTitulos && includeRevenue
          ? this.prisma.accountsReceivable.count({ where: recWhere })
          : Promise.resolve(0),
        includeTitulos && includeExpense
          ? this.prisma.accountsPayable.count({ where: payWhere })
          : Promise.resolve(0),
      ]);

    // FN-03: derived here as well as materialised by the nightly job, so a
    // título that turned overdue since 05:00 does not wait a day to say so.
    const today = startOfToday();
    const merged = [
      ...txRows.map((r) => this.mapTransaction(r, accountsMap)),
      ...recRows.map((r) => this.mapReceivable(r, accountsMap, today)),
      ...payRows.map((r) => this.mapPayable(r, accountsMap, today)),
    ]
      // FN-03: overdue first, then newest. Sorting by date alone buried the one
      // row that needs action under every transaction of the day. The sort runs
      // before the slice, so page 1 really is the most urgent page.
      .sort((a, b) => {
        const overdueDelta =
          Number(b.status === 'OVERDUE') - Number(a.status === 'OVERDUE');
        if (overdueDelta !== 0) return overdueDelta;
        return b.date.getTime() - a.date.getTime();
      })
      .slice(skip, skip + limit);

    const total = txCount + recCount + payCount;
    const totals = await this.computeTotals(tenantId, {
      txWhere,
      recWhere,
      payWhere,
      includeTransactions,
      includeRevenue,
      includeExpense,
      includeTitulos,
    });

    return {
      ...buildPaginatedResponse(merged, total, { page, limit, sortOrder: 'desc' }),
      totals,
    };
  }

  /**
   * FN-01: this used to parse the bound as UTC midnight and then call
   * `setHours`, which applies the process timezone — in UTC-3 the range ended
   * at 02:59 UTC and dropped ~21h of the last day (4 records instead of 11).
   */
  private buildDateRange(startDate?: string, endDate?: string) {
    return toDateRange(startDate, endDate);
  }

  private buildTransactionWhere(
    tenantId: string,
    opts: {
      dateRange?: { gte?: Date; lte?: Date };
      includeRevenue: boolean;
      includeExpense: boolean;
      accountId?: string;
      onlyTransfers?: boolean;
      excludeTransfers?: boolean;
    },
  ): Prisma.FinancialTransactionWhereInput {
    // Manual entries, sales ('order') and settlements ('receivable'/'payable')
    // are all money that moved through an account, so none of them is filtered
    // out. Transfers are the exception (FN-12): they are their own category,
    // never part of receitas or despesas.
    const where: Prisma.FinancialTransactionWhereInput = { tenantId };
    if (opts.dateRange) where.createdAt = opts.dateRange;
    if (opts.accountId) where.accountId = opts.accountId;
    if (opts.includeRevenue && !opts.includeExpense) where.type = 'CREDIT';
    if (opts.includeExpense && !opts.includeRevenue) where.type = 'DEBIT';
    if (opts.onlyTransfers) where.referenceType = TRANSFER_REFERENCE;
    else if (opts.excludeTransfers)
      where.referenceType = { not: TRANSFER_REFERENCE };
    return where;
  }

  private buildReceivableWhere(
    tenantId: string,
    opts: {
      dateRange?: { gte?: Date; lte?: Date };
      accountId?: string;
      onlyOverdue?: boolean;
    },
  ): Prisma.AccountsReceivableWhereInput {
    const where: Prisma.AccountsReceivableWhereInput = {
      tenantId,
      status: { in: OPEN_STATUSES },
      // FN-04: um título excluído não some do banco, mas some das telas.
      deletedAt: null,
    };
    if (opts.dateRange) where.dueDate = opts.dateRange;
    if (opts.onlyOverdue) where.dueDate = { lt: startOfToday() };
    if (opts.accountId) {
      // The account of a título is wherever it will land: the one the sale
      // recorded, the payment method's default, or the manual entry's account.
      where.OR = [
        { orderPayment: { financialAccountId: opts.accountId } },
        { paymentMethod: { defaultAccountId: opts.accountId } },
        { metadata: { path: ['financialAccountId'], equals: opts.accountId } },
      ];
    }
    return where;
  }

  private buildPayableWhere(
    tenantId: string,
    opts: {
      dateRange?: { gte?: Date; lte?: Date };
      accountId?: string;
      onlyOverdue?: boolean;
    },
  ): Prisma.AccountsPayableWhereInput {
    const where: Prisma.AccountsPayableWhereInput = {
      tenantId,
      status: { in: OPEN_STATUSES },
      deletedAt: null,
    };
    if (opts.dateRange) where.dueDate = opts.dateRange;
    if (opts.onlyOverdue) where.dueDate = { lt: startOfToday() };
    if (opts.accountId) {
      where.OR = [
        { paymentMethod: { defaultAccountId: opts.accountId } },
        { metadata: { path: ['financialAccountId'], equals: opts.accountId } },
      ];
    }
    return where;
  }

  private async computeTotals(
    tenantId: string,
    opts: {
      txWhere: Prisma.FinancialTransactionWhereInput;
      recWhere: Prisma.AccountsReceivableWhereInput;
      payWhere: Prisma.AccountsPayableWhereInput;
      includeTransactions: boolean;
      includeRevenue: boolean;
      includeExpense: boolean;
      includeTitulos: boolean;
    },
  ): Promise<FinancialEntriesTotals> {
    const overdueBefore = { dueDate: { lt: startOfToday() } };
    const [txCredit, txDebit, recSum, paySum, recOverdue, payOverdue] =
      await Promise.all([
      // FN-12: the totals never count a transfer, whatever the list is
      // showing — moving money between our own accounts is not a result.
      opts.includeTransactions && opts.includeRevenue
        ? this.prisma.financialTransaction.aggregate({
            where: { ...opts.txWhere, type: 'CREDIT', ...NOT_A_TRANSFER },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),
      opts.includeTransactions && opts.includeExpense
        ? this.prisma.financialTransaction.aggregate({
            where: { ...opts.txWhere, type: 'DEBIT', ...NOT_A_TRANSFER },
            _sum: { amount: true },
          })
        : Promise.resolve({ _sum: { amount: null } }),
      opts.includeTitulos && opts.includeRevenue
        ? this.prisma.accountsReceivable.aggregate({
            where: opts.recWhere,
            _sum: { amount: true, paidAmount: true },
          })
        : Promise.resolve({ _sum: { amount: null, paidAmount: null } }),
      opts.includeTitulos && opts.includeExpense
        ? this.prisma.accountsPayable.aggregate({
            where: opts.payWhere,
            _sum: { amount: true, paidAmount: true },
          })
        : Promise.resolve({ _sum: { amount: null, paidAmount: null } }),
      // FN-03: "Vencidos" is a card of its own, so it is aggregated separately
      // instead of being inferred from the list page the user happens to see.
      opts.includeTitulos && opts.includeRevenue
        ? this.prisma.accountsReceivable.aggregate({
            where: { ...opts.recWhere, ...overdueBefore },
            _sum: { amount: true, paidAmount: true },
          })
        : Promise.resolve({ _sum: { amount: null, paidAmount: null } }),
      opts.includeTitulos && opts.includeExpense
        ? this.prisma.accountsPayable.aggregate({
            where: { ...opts.payWhere, ...overdueBefore },
            _sum: { amount: true, paidAmount: true },
          })
        : Promise.resolve({ _sum: { amount: null, paidAmount: null } }),
      ]);

    // An open título only counts for what is still owed — the part already
    // settled has become a FinancialTransaction and is counted there.
    // FN-28: summed in cents, never with `+` on floats — that is how
    // `"balance": 708.9000000000001` reached the response body.
    const revenue = sumMoney([txCredit._sum.amount, outstandingOf(recSum._sum)]);
    const expense = sumMoney([txDebit._sum.amount, outstandingOf(paySum._sum)]);
    return {
      revenue,
      expense,
      balance: subtractMoney(revenue, expense),
      overdueRevenue: outstandingOf(recOverdue._sum),
      overdueExpense: outstandingOf(payOverdue._sum),
    };
  }

  private async loadAccountNames(tenantId: string): Promise<Map<string, string>> {
    const accounts = await this.prisma.financialAccount.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    });
    return new Map(accounts.map((a) => [a.id, a.name]));
  }

  private mapTransaction(
    row: {
      id: string;
      type: string;
      amount: Prisma.Decimal;
      description: string;
      createdAt: Date;
      accountId: string;
      chartAccountId: string | null;
      chartAccount: { name: string } | null;
      referenceType?: string | null;
    },
    accounts: Map<string, string>,
  ): FinancialEntry {
    return {
      id: row.id,
      kind: 'TRANSACTION',
      type:
        row.referenceType === TRANSFER_REFERENCE
          ? 'TRANSFER'
          : row.type === 'CREDIT'
            ? 'REVENUE'
            : 'EXPENSE',
      description: row.description,
      amount: toMoney(row.amount),
      date: row.createdAt,
      status: 'PAID',
      accountId: row.accountId,
      accountName: accounts.get(row.accountId) ?? null,
      chartAccountId: row.chartAccountId,
      categoryName: row.chartAccount?.name ?? null,
      fromDocument: false,
    };
  }

  private mapReceivable(
    row: TituloRow & {
      orderPayment: { financialAccountId: string | null } | null;
      paymentMethod: { defaultAccountId: string | null } | null;
    },
    accounts: Map<string, string>,
    today: Date = startOfToday(),
  ): FinancialEntry {
    const accountId =
      row.orderPayment?.financialAccountId ??
      row.paymentMethod?.defaultAccountId ??
      this.readAccountIdFromMetadata(row.metadata);

    return {
      id: row.id,
      kind: 'RECEIVABLE',
      type: 'REVENUE',
      description: row.description,
      amount: outstandingOf(row),
      date: row.dueDate,
      status: isOverdue(row.status, row.dueDate, today) ? 'OVERDUE' : row.status,
      accountId,
      accountName: accountId ? accounts.get(accountId) ?? null : null,
      chartAccountId: row.chartAccountId,
      categoryName: row.chartAccount?.name ?? null,
      fromDocument: !!row.orderId,
    };
  }

  private mapPayable(
    row: TituloRow & { paymentMethod: { defaultAccountId: string | null } | null },
    accounts: Map<string, string>,
    today: Date = startOfToday(),
  ): FinancialEntry {
    const accountId =
      row.paymentMethod?.defaultAccountId ??
      this.readAccountIdFromMetadata(row.metadata);

    return {
      id: row.id,
      kind: 'PAYABLE',
      type: 'EXPENSE',
      description: row.description,
      amount: outstandingOf(row),
      date: row.dueDate,
      status: isOverdue(row.status, row.dueDate, today) ? 'OVERDUE' : row.status,
      accountId,
      accountName: accountId ? accounts.get(accountId) ?? null : null,
      chartAccountId: row.chartAccountId,
      categoryName: row.chartAccount?.name ?? null,
      fromDocument: !!row.purchaseOrderId,
    };
  }

  private readAccountIdFromMetadata(metadata: Prisma.JsonValue): string | null {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      const value = (metadata as Record<string, unknown>).financialAccountId;
      return typeof value === 'string' ? value : null;
    }
    return null;
  }
}

interface TituloRow {
  id: string;
  orderId?: string | null;
  purchaseOrderId?: string | null;
  amount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  description: string;
  dueDate: Date;
  status: FinancialEntry['status'];
  chartAccountId: string | null;
  chartAccount: { name: string } | null;
  metadata: Prisma.JsonValue;
}

/** What a título still owes: face value minus whatever has already been settled. */
function outstandingOf(row: {
  amount: Prisma.Decimal | number | null;
  paidAmount: Prisma.Decimal | number | null;
}): number {
  return subtractMoney(row.amount, row.paidAmount);
}
