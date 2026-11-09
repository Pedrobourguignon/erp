import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma, FinancialStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { CashRegistersService } from '../cash-registers/cash-registers.service';
import { parseUserDate } from '../../common/utils/date-range.util';
import {
  SettleFinancialEntryDto,
  SettleableKind,
} from './dto/settle-financial-entry.dto';
import {
  formatBRL,
  subtractMoney,
  sumMoney,
  toMoney,
} from '../../common/utils/money.util';

type Db = PrismaService | Prisma.TransactionClient;

type Titulo = Awaited<
  ReturnType<FinancialSettlementsService['loadReceivable']>
>;

interface SettlementPlan {
  amount: number;
  settledAmount: number;
  paidAmount: number;
  isFullyPaid: boolean;
  paidAt: Date;
}

/** Statuses a título can be settled from. */
const SETTLEABLE_STATUSES: FinancialStatus[] = [
  'PENDING',
  'PARTIALLY_PAID',
  'OVERDUE',
];

/** Cent-level tolerance for float comparisons on money. */
const EPSILON = 0.005;

export interface SettlementResult {
  kind: SettleableKind;
  id: string;
  status: FinancialStatus;
  amount: number;
  paidAmount: number;
  settledAmount: number;
  accountId: string;
  transactionId: string;
}

/**
 * Settlement (baixa) of open títulos — SCRUM-31/32.
 *
 * A term sale (boleto, credit card…) parks its money in an AccountsReceivable;
 * only the settlement moves it into a FinancialAccount. Immediate payments
 * (cash/PIX/debit) never pass through here — they are credited at the sale and
 * their título is already born PAID.
 */
@Injectable()
export class FinancialSettlementsService {
  private readonly logger = new Logger(FinancialSettlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashRegisters: CashRegistersService,
  ) {}

  async settle(
    tenantId: string,
    id: string,
    dto: SettleFinancialEntryDto,
    userId?: string,
  ): Promise<SettlementResult> {
    const titulo = await this.loadTitulo(this.prisma, tenantId, id, dto.kind);
    const accountId = await this.resolveAccountId(this.prisma, tenantId, titulo, dto.accountId);
    const plan = this.planSettlement(id, titulo, dto);

    const transaction = await this.prisma.$transaction((tx) =>
      this.applySettlement(tx, tenantId, id, dto.kind, titulo, accountId, plan, userId),
    );

    return this.toResult(tenantId, id, dto.kind, accountId, plan, transaction.id);
  }

  /**
   * Mesma baixa, dentro de uma transação que o chamador já abriu — para quem
   * cria o título e o liquida no mesmo ato (a diferença de uma troca paga no
   * balcão). Se a baixa falhar, o título e tudo que veio antes voltam junto.
   */
  async settleWithin(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    dto: SettleFinancialEntryDto,
    userId: string,
  ): Promise<SettlementResult> {
    const titulo = await this.loadTitulo(tx, tenantId, id, dto.kind);
    const accountId = await this.resolveAccountId(tx, tenantId, titulo, dto.accountId);
    const plan = this.planSettlement(id, titulo, dto);
    const transaction = await this.applySettlement(
      tx, tenantId, id, dto.kind, titulo, accountId, plan, userId,
    );
    return this.toResult(tenantId, id, dto.kind, accountId, plan, transaction.id);
  }

  private planSettlement(id: string, titulo: Titulo, dto: SettleFinancialEntryDto) {
    if (!SETTLEABLE_STATUSES.includes(titulo.status)) {
      throw new ConflictException(
        `Título ${id} não pode ser baixado (status atual: ${titulo.status})`,
      );
    }

    // FN-28: money is added and subtracted in cents, never as raw floats.
    const amount = toMoney(titulo.amount);
    const alreadyPaid = toMoney(titulo.paidAmount);
    const outstanding = subtractMoney(amount, alreadyPaid);

    const settledAmount = dto.amount != null ? toMoney(dto.amount) : outstanding;
    if (settledAmount <= 0 || settledAmount > outstanding + EPSILON) {
      throw new BadRequestException(
        `O valor da baixa (${formatBRL(settledAmount)}) deve ser maior que zero e no máximo o saldo em aberto (${formatBRL(outstanding)})`,
      );
    }

    const paidAmount = sumMoney([alreadyPaid, settledAmount]);
    const isFullyPaid = paidAmount >= amount - EPSILON;
    // A date picked in the UI is a civil date (midnight in the tenant
    // timezone); an ISO instant sent by an integration is kept as it is.
    const paidAt = dto.paidAt ? parseUserDate(dto.paidAt) : new Date();

    return { amount, settledAmount, paidAmount, isFullyPaid, paidAt };
  }

  private async applySettlement(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    kind: SettleableKind,
    titulo: Titulo,
    accountId: string,
    plan: SettlementPlan,
    userId?: string,
  ) {
    const isReceivable = kind === 'RECEIVABLE';
    const { settledAmount, paidAmount, isFullyPaid, paidAt } = plan;

    const account = await tx.financialAccount.update({
      where: { id: accountId },
      data: {
        balance: isReceivable
          ? { increment: settledAmount }
          : { decrement: settledAmount },
      },
      select: { balance: true },
    });

    const data = {
      paidAmount,
      status: (isFullyPaid ? 'PAID' : 'PARTIALLY_PAID') as FinancialStatus,
      paidAt: isFullyPaid ? paidAt : null,
    };

    if (isReceivable) {
      await tx.accountsReceivable.update({ where: { id }, data });
    } else {
      await tx.accountsPayable.update({ where: { id }, data });
    }

    // A conta de um caixa aberto é a gaveta: pagar por ela tira dinheiro
    // físico de dentro dela, e a contagem do fechamento precisa saber disso.
    if (userId) {
      await this.cashRegisters.mirrorSettlementInDrawer(tx, {
        tenantId,
        accountId,
        direction: isReceivable ? 'in' : 'out',
        amount: settledAmount,
        reason: `${isReceivable ? 'Recebimento' : 'Pagamento'} - ${titulo.description}`,
        userId,
      });
    }

    return tx.financialTransaction.create({
      data: {
        tenantId,
        accountId,
        type: isReceivable ? 'CREDIT' : 'DEBIT',
        amount: settledAmount,
        balanceAfter: account.balance,
        description: `${isReceivable ? 'Recebimento' : 'Pagamento'} - ${titulo.description}`,
        chartAccountId: titulo.chartAccountId,
        referenceType: isReceivable ? 'receivable' : 'payable',
        referenceId: id,
        createdAt: paidAt,
      },
    });
  }

  private toResult(
    tenantId: string,
    id: string,
    kind: SettleableKind,
    accountId: string,
    plan: SettlementPlan,
    transactionId: string,
  ): SettlementResult {
    this.logger.log(
      `Settled ${kind} ${id}: ${plan.settledAmount} on account ${accountId} (tenant ${tenantId})`,
    );

    return {
      kind,
      id,
      status: plan.isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
      amount: plan.amount,
      paidAmount: plan.paidAmount,
      settledAmount: plan.settledAmount,
      accountId,
      transactionId,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private loadTitulo(db: Db, tenantId: string, id: string, kind: SettleableKind) {
    return kind === 'RECEIVABLE'
      ? this.loadReceivable(db, tenantId, id)
      : this.loadPayable(db, tenantId, id);
  }

  private async loadReceivable(db: Db, tenantId: string, id: string) {
    const receivable = await db.accountsReceivable.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        description: true,
        amount: true,
        paidAmount: true,
        status: true,
        chartAccountId: true,
        metadata: true,
        orderPayment: {
          select: {
            financialAccountId: true,
            paymentMethod: { select: { defaultAccountId: true } },
          },
        },
        paymentMethod: { select: { defaultAccountId: true } },
      },
    });

    if (!receivable) {
      throw new NotFoundException(
        `Título a receber não encontrado`,
      );
    }
    return receivable;
  }

  private async loadPayable(db: Db, tenantId: string, id: string) {
    const payable = await db.accountsPayable.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        description: true,
        amount: true,
        paidAmount: true,
        status: true,
        chartAccountId: true,
        metadata: true,
        paymentMethod: { select: { defaultAccountId: true } },
      },
    });

    if (!payable) {
      throw new NotFoundException(
        `Título a pagar não encontrado`,
      );
    }
    return { ...payable, orderPayment: null };
  }

  /**
   * Where the money lands: the account chosen by the caller, else the one the
   * sale recorded on its payment, else the payment method's default, else the
   * account a manual entry was booked against.
   */
  private async resolveAccountId(
    db: Db,
    tenantId: string,
    titulo: {
      metadata: Prisma.JsonValue;
      orderPayment: {
        financialAccountId: string | null;
        paymentMethod: { defaultAccountId: string | null } | null;
      } | null;
      paymentMethod: { defaultAccountId: string | null } | null;
    },
    requestedAccountId?: string,
  ): Promise<string> {
    if (requestedAccountId) {
      const account = await db.financialAccount.findFirst({
        where: { id: requestedAccountId, tenantId },
        select: { id: true },
      });
      if (!account) {
        throw new NotFoundException(
          `Conta financeira não encontrada`,
        );
      }
      return account.id;
    }

    const resolved =
      titulo.orderPayment?.financialAccountId ??
      titulo.orderPayment?.paymentMethod?.defaultAccountId ??
      titulo.paymentMethod?.defaultAccountId ??
      readAccountIdFromMetadata(titulo.metadata);

    if (!resolved) {
      throw new BadRequestException(
        'Não há conta financeira vinculada a este título. Informe a conta para registrar a baixa.',
      );
    }
    return resolved;
  }
}


function readAccountIdFromMetadata(metadata: Prisma.JsonValue): string | null {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const value = (metadata as Record<string, unknown>).financialAccountId;
    return typeof value === 'string' ? value : null;
  }
  return null;
}
