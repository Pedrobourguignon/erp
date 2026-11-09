import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { applyTransfer } from '../financial/financial-accounts.service';
import {
  CreateCashRegisterDto,
  UpdateCashRegisterDto,
  OpenSessionDto,
  CloseSessionDto,
  CashMovementDto,
  CashRegisterQueryDto,
  SessionQueryDto,
} from './dto/cash-register.dto';
import {
  PaginatedResponse,
  buildPaginatedResponse,
  buildPrismaOrderBy,
} from '../../common/utils/pagination';
import {
  formatBRL,
  MoneyLike,
  subtractMoney,
  sumMoney,
  toMoney,
} from '../../common/utils/money.util';


@Injectable()
export class CashRegistersService {
  private readonly logger = new Logger(CashRegistersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Cash Registers CRUD ─────────────────────────────────────────────

  async findAll(
    tenantId: string,
    query: CashRegisterQueryDto,
  ): Promise<PaginatedResponse<unknown>> {
    const { page = 1, limit = 20, search, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.CashRegisterWhereInput = { tenantId };

    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.cashRegister.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          financialAccount: { select: { id: true, name: true, type: true } },
          sessions: {
            where: { status: 'OPEN' },
            take: 1,
            select: {
              id: true,
              status: true,
              operatorId: true,
              openedAt: true,
              openingBalance: true,
              movements: { select: { type: true, amount: true } },
            },
          },
        },
      }),
      this.prisma.cashRegister.count({ where }),
    ]);

    // O card da tela de caixa mostrava só o saldo de abertura: depois de uma
    // venda em dinheiro, R$ 50,00 na tela e R$ 399,90 na gaveta. O saldo
    // corrente já existia, mas só no detalhe da sessão, atrás do "Ver sessão".
    // A listagem carrega os mesmos totais para quem só bate o olho no card.
    const openSessions = data.flatMap((register) => register.sessions);
    const cashSales = await this.cashSalesBySession(
      tenantId,
      openSessions.map((session) => session.id),
    );

    const withTotals = data.map((register) => ({
      ...register,
      sessions: register.sessions.map(({ movements, ...session }) => ({
        ...session,
        openingBalance: toMoney(session.openingBalance),
        totals: computeSessionTotals({
          openingBalance: session.openingBalance,
          movements,
          cashSales: cashSales.get(session.id) ?? 0,
        }),
      })),
    }));

    return buildPaginatedResponse(withTotals, total, { page, limit, sortOrder: 'desc' });
  }

  async create(tenantId: string, dto: CreateCashRegisterDto) {
    // Validate financial account exists and belongs to tenant
    const account = await this.prisma.financialAccount.findFirst({
      where: { id: dto.financialAccountId, tenantId },
    });

    if (!account) {
      throw new NotFoundException(
        `Conta financeira não encontrada`,
      );
    }

    // Check for duplicate name
    const existing = await this.prisma.cashRegister.findUnique({
      where: { tenantId_name: { tenantId, name: dto.name } },
    });

    if (existing) {
      throw new ConflictException(
        `Já existe um caixa chamado "${dto.name}"`,
      );
    }

    const cashRegister = await this.prisma.cashRegister.create({
      data: {
        tenantId,
        name: dto.name,
        financialAccountId: dto.financialAccountId,
        isActive: dto.isActive ?? true,
      },
      include: {
        financialAccount: { select: { id: true, name: true, type: true } },
      },
    });

    this.logger.log(
      `Cash register created: ${cashRegister.name} (${cashRegister.id}) for tenant ${tenantId}`,
    );

    return cashRegister;
  }

  async update(tenantId: string, id: string, dto: UpdateCashRegisterDto) {
    const existing = await this.prisma.cashRegister.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException(
        `Caixa não encontrado`,
      );
    }

    if (dto.financialAccountId) {
      const account = await this.prisma.financialAccount.findFirst({
        where: { id: dto.financialAccountId, tenantId },
      });
      if (!account) {
        throw new NotFoundException(
          `Conta financeira não encontrada`,
        );
      }
    }

    if (dto.name && dto.name !== existing.name) {
      const duplicate = await this.prisma.cashRegister.findUnique({
        where: { tenantId_name: { tenantId, name: dto.name } },
      });
      if (duplicate) {
        throw new ConflictException(
          `Já existe um caixa chamado "${dto.name}"`,
        );
      }
    }

    const updated = await this.prisma.cashRegister.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.financialAccountId !== undefined && { financialAccountId: dto.financialAccountId }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: {
        financialAccount: { select: { id: true, name: true, type: true } },
      },
    });

    this.logger.log(
      `Cash register updated: ${updated.name} (${updated.id}) for tenant ${tenantId}`,
    );

    return updated;
  }

  // ─── Session Operations ──────────────────────────────────────────────

  async openSession(
    tenantId: string,
    cashRegisterId: string,
    userId: string,
    dto: OpenSessionDto,
  ) {
    const cashRegister = await this.prisma.cashRegister.findFirst({
      where: { id: cashRegisterId, tenantId },
    });

    if (!cashRegister) {
      throw new NotFoundException(
        `Caixa não encontrado`,
      );
    }

    if (!cashRegister.isActive) {
      throw new BadRequestException('Não é possível abrir um caixa inativo');
    }

    // Check if there is already an open session
    const openSession = await this.prisma.cashRegisterSession.findFirst({
      where: { cashRegisterId, tenantId, status: 'OPEN' },
    });

    if (openSession) {
      throw new BadRequestException(
        `O caixa "${cashRegister.name}" já está aberto`,
      );
    }

    // A conta do caixa é a gaveta, inclusive fora do expediente: o troco que
    // ficou de ontem já está nela. Creditar a abertura inteira contava esse
    // dinheiro de novo — R$ 50,00 de fundo viravam R$ 50,00 novos a cada dia,
    // R$ 1.500,00 inventados por mês. Abrir caixa não cria dinheiro: só o que
    // entra de fora (do cofre, do bolso do dono) é crédito.
    const account = await this.prisma.financialAccount.findFirst({
      where: { id: cashRegister.financialAccountId, tenantId },
      select: { id: true, name: true, balance: true },
    });
    const balanceInDrawer = toMoney(account?.balance);
    const openingBalance = toMoney(dto.openingBalance);
    const externalSupply = subtractMoney(openingBalance, balanceInDrawer);

    // Abrir com menos do que a conta acusa significa que saiu dinheiro sem
    // registro. Debitar por conta própria esconderia o buraco; o certo é o
    // operador dizer para onde o dinheiro foi.
    if (externalSupply < 0) {
      throw new BadRequestException(
        `A conta "${account?.name ?? 'do caixa'}" acusa ${formatBRL(balanceInDrawer)} ` +
          `e a abertura declara ${formatBRL(openingBalance)}. ` +
          `Registre a sangria ou a transferência dos ${formatBRL(-externalSupply)} que saíram antes de abrir o caixa.`,
      );
    }

    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cashRegisterSession.create({
        data: {
          tenantId,
          cashRegisterId,
          operatorId: userId,
          status: 'OPEN',
          openingBalance,
        },
        include: {
          cashRegister: { select: { id: true, name: true } },
          operator: { select: { id: true, name: true } },
        },
      });

      // FN-15: só o suprimento externo é dinheiro entrando na gaveta.
      await this.bookOnAccount(tx, {
        tenantId,
        accountId: cashRegister.financialAccountId,
        direction: 'in',
        amount: externalSupply,
        description: `Suprimento de abertura - ${cashRegister.name}`,
        sessionId: created.id,
      });

      return created;
    });

    this.logger.log(
      `Cash session opened: ${session.id} for register ${cashRegister.name} by user ${userId}`,
    );

    return session;
  }


  // ─── FN-06 / FN-15: saldo do caixa e reflexo na conta ────────────────────

  /**
   * Money physically in the drawer right now.
   *
   * FN-06: nothing checked this before a sangria, so the register reached
   * −R$ 4.999.300,00 and the closing screen reported the resulting "difference"
   * in green, as if the drawer had a surplus.
   */
  private async availableBalance(
    tenantId: string,
    session: {
      id: string;
      openingBalance: Prisma.Decimal | number;
      movements: { type: string; amount: Prisma.Decimal | number }[];
    },
  ): Promise<number> {
    // Only CASH payments reach the physical drawer.
    const cashSales = await this.prisma.orderPayment.aggregate({
      _sum: { amount: true },
      where: {
        tenantId,
        paymentMethod: { type: 'CASH' },
        order: { cashRegisterSessionId: session.id },
      },
    });

    return computeSessionTotals({
      openingBalance: session.openingBalance,
      movements: session.movements,
      cashSales: cashSales._sum.amount,
    }).currentBalance;
  }

  /**
   * Vendas em dinheiro por sessão, numa query só — a listagem de caixas
   * precisa do total de várias sessões abertas de uma vez.
   */
  private async cashSalesBySession(
    tenantId: string,
    sessionIds: string[],
  ): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    if (sessionIds.length === 0) return totals;

    const payments = await this.prisma.orderPayment.findMany({
      where: {
        tenantId,
        paymentMethod: { type: 'CASH' },
        order: { cashRegisterSessionId: { in: sessionIds } },
      },
      select: {
        amount: true,
        order: { select: { cashRegisterSessionId: true } },
      },
    });

    const amountsBySession = new Map<string, MoneyLike[]>();
    for (const payment of payments) {
      const sessionId = payment.order?.cashRegisterSessionId;
      if (!sessionId) continue;
      const amounts = amountsBySession.get(sessionId) ?? [];
      amounts.push(payment.amount);
      amountsBySession.set(sessionId, amounts);
    }

    for (const [sessionId, amounts] of amountsBySession) {
      totals.set(sessionId, sumMoney(amounts));
    }

    return totals;
  }

  async closeSession(
    tenantId: string,
    cashRegisterId: string,
    userId: string,
    dto: CloseSessionDto,
  ) {
    const cashRegister = await this.prisma.cashRegister.findFirst({
      where: { id: cashRegisterId, tenantId },
    });

    if (!cashRegister) {
      throw new NotFoundException(
        `Caixa não encontrado`,
      );
    }

    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { cashRegisterId, tenantId, status: 'OPEN' },
      include: {
        movements: true,
      },
    });

    if (!session) {
      throw new BadRequestException(
        `O caixa "${cashRegister.name}" não está aberto`,
      );
    }

    // What the drawer should hold: opening float + supplies − sangrias + cash
    // sales stamped with this session (SCRUM-29). Same computation the sangria
    // validates against, so the two can never disagree (FN-06).
    const expectedBalance = await this.availableBalance(tenantId, session);
    const closingBalance = toMoney(dto.closingBalance);
    const difference = subtractMoney(closingBalance, expectedBalance);

    // Fechar o caixa não é só conferir: é decidir quanto do dinheiro contado
    // fica de troco para amanhã e para onde vai o resto. Sem essa etapa o
    // faturamento do dia dormia na conta da gaveta e a abertura do dia
    // seguinte recontava o fundo de troco.
    const retainedAmount = toMoney(dto.retainedAmount ?? 0);
    if (retainedAmount > closingBalance) {
      throw new BadRequestException(
        `O fundo de troco (${formatBRL(retainedAmount)}) não pode passar do valor contado (${formatBRL(closingBalance)}).`,
      );
    }

    const amountToTransfer = dto.destinationAccountId
      ? subtractMoney(closingBalance, retainedAmount)
      : 0;

    let destination: { id: string; name: string } | null = null;
    if (dto.destinationAccountId && amountToTransfer > 0) {
      if (dto.destinationAccountId === cashRegister.financialAccountId) {
        throw new BadRequestException(
          'A conta de destino deve ser diferente da conta do próprio caixa.',
        );
      }

      destination = await this.prisma.financialAccount.findFirst({
        where: { id: dto.destinationAccountId, tenantId },
        select: { id: true, name: true },
      });

      if (!destination) {
        throw new NotFoundException('Conta de destino não encontrada');
      }
    }

    const closed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.cashRegisterSession.update({
        where: { id: session.id },
        data: {
          status: 'CLOSED',
          closedById: userId,
          closedAt: new Date(),
          closingBalance,
          expectedBalance,
          difference,
          notes: dto.notes,
        },
        include: {
          cashRegister: { select: { id: true, name: true } },
          operator: { select: { id: true, name: true } },
          closedBy: { select: { id: true, name: true } },
          movements: true,
        },
      });

      // FN-15: the counted difference is real money the account does not know
      // about yet — a shortfall leaves the account, a surplus enters it.
      if (difference !== 0) {
        await this.bookOnAccount(tx, {
          tenantId,
          accountId: cashRegister.financialAccountId,
          direction: difference > 0 ? 'in' : 'out',
          amount: Math.abs(difference),
          description: `${difference > 0 ? 'Sobra' : 'Falta'} no fechamento - ${cashRegister.name}`,
          sessionId: session.id,
        });
      }

      // Depois do acerto da diferença a conta vale o valor contado; a
      // transferência deixa nela exatamente o fundo de troco retido. Vai na
      // mesma transação do fechamento de propósito: caixa fechado com o
      // dinheiro do dia ainda contado na gaveta é o pior dos dois mundos.
      if (destination && amountToTransfer > 0) {
        await applyTransfer(tx, {
          tenantId,
          from: {
            id: cashRegister.financialAccountId,
            name: cashRegister.name,
          },
          to: destination,
          amount: amountToTransfer,
          description: `Fechamento de caixa ${cashRegister.name} → ${destination.name}`,
          when: new Date(),
          transferId: randomUUID(),
        });
      }

      return updated;
    });

    this.logger.log(
      `Cash session closed: ${session.id} for register ${cashRegister.name}. ` +
        `Expected: ${expectedBalance}, Counted: ${dto.closingBalance}, Diff: ${difference}`,
    );

    return {
      ...closed,
      transfer:
        destination && amountToTransfer > 0
          ? {
              toAccountId: destination.id,
              toAccountName: destination.name,
              amount: amountToTransfer,
            }
          : null,
      retainedAmount,
    };
  }

  /**
   * FN-15: mirrors a drawer movement on the linked FinancialAccount.
   *
   * The account of a cash register *is* the drawer: money entering the drawer
   * credits it, money leaving debits it. Without this the linked account stayed
   * at R$ 0,00 through a whole day of supplies and sangrias and there was
   * nothing to reconcile against.
   *
   * A register with no linked account simply books nothing — the movement is
   * still recorded, it just has no accounting counterpart.
   */
  private async bookOnAccount(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      accountId: string | null;
      direction: 'in' | 'out';
      amount: number;
      description: string;
      sessionId: string;
    },
  ): Promise<void> {
    if (!input.accountId || input.amount <= 0) return;

    const account = await tx.financialAccount.update({
      where: { id: input.accountId },
      data: {
        balance:
          input.direction === 'in'
            ? { increment: input.amount }
            : { decrement: input.amount },
      },
      select: { balance: true },
    });

    await tx.financialTransaction.create({
      data: {
        tenantId: input.tenantId,
        accountId: input.accountId,
        type: input.direction === 'in' ? 'CREDIT' : 'DEBIT',
        amount: input.amount,
        balanceAfter: account.balance,
        description: input.description,
        referenceType: 'cash-register',
        referenceId: input.sessionId,
      },
    });
  }

  /**
   * Reflete na gaveta uma baixa paga (ou recebida) pela conta de um caixa
   * aberto.
   *
   * A conta de um caixa é a gaveta. Pagar um título por ela — o reembolso de um
   * estorno, a conta de luz, um fornecedor — tira dinheiro físico de dentro
   * dela, mas a baixa só mexia no saldo da conta: no fechamento a contagem não
   * batia e a "diferença" nascia da tela, não do caixa.
   *
   * Conta sem caixa aberto não gera movimento nenhum — é uma conta bancária
   * comum, ou um caixa fechado, e aí o dinheiro não está em gaveta alguma.
   */
  async mirrorSettlementInDrawer(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      accountId: string;
      direction: 'in' | 'out';
      amount: number;
      reason: string;
      userId: string;
    },
  ): Promise<{ sessionId: string } | null> {
    if (input.amount <= 0) return null;

    const session = await tx.cashRegisterSession.findFirst({
      where: {
        tenantId: input.tenantId,
        status: 'OPEN',
        cashRegister: { financialAccountId: input.accountId },
      },
      orderBy: { openedAt: 'asc' },
      select: {
        id: true,
        openingBalance: true,
        cashRegister: { select: { name: true } },
      },
    });
    if (!session) return null;

    // FN-06: uma gaveta não guarda dinheiro negativo. Mesma trava da sangria,
    // porque é a mesma operação vista de outro lugar.
    if (input.direction === 'out') {
      const [movements, cashSales] = await Promise.all([
        tx.cashRegisterMovement.findMany({
          where: { sessionId: session.id },
          select: { type: true, amount: true },
        }),
        tx.orderPayment.aggregate({
          _sum: { amount: true },
          where: {
            tenantId: input.tenantId,
            paymentMethod: { type: 'CASH' },
            order: { cashRegisterSessionId: session.id },
          },
        }),
      ]);

      const available = computeSessionTotals({
        openingBalance: session.openingBalance,
        movements,
        cashSales: cashSales._sum.amount,
      }).currentBalance;

      if (input.amount > available) {
        throw new BadRequestException(
          `Saldo insuficiente no caixa "${session.cashRegister.name}" ` +
            `(disponível: ${formatBRL(available)}).`,
        );
      }
    }

    await tx.cashRegisterMovement.create({
      data: {
        tenantId: input.tenantId,
        sessionId: session.id,
        type: input.direction === 'in' ? 'SUPPLY' : 'WITHDRAW',
        amount: input.amount,
        reason: input.reason.slice(0, 255),
        performedById: input.userId,
      },
    });

    return { sessionId: session.id };
  }

  async supply(
    tenantId: string,
    cashRegisterId: string,
    userId: string,
    dto: CashMovementDto,
  ) {
    const register = await this.loadRegister(tenantId, cashRegisterId);
    const session = await this.getOpenSession(tenantId, cashRegisterId);
    const amount = toMoney(dto.amount);
    if (amount <= 0) {
      throw new BadRequestException('O valor do suprimento deve ser maior que zero');
    }

    const movement = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cashRegisterMovement.create({
        data: {
          tenantId,
          sessionId: session.id,
          type: 'SUPPLY',
          amount,
          reason: dto.reason,
          performedById: userId,
        },
        include: {
          performedBy: { select: { id: true, name: true } },
        },
      });

      await this.bookOnAccount(tx, {
        tenantId,
        accountId: register.financialAccountId,
        direction: 'in',
        amount,
        description: `Suprimento de caixa - ${dto.reason}`,
        sessionId: session.id,
      });

      return created;
    });

    this.logger.log(
      `Cash supply: ${dto.amount} to session ${session.id} by user ${userId}. Reason: ${dto.reason}`,
    );

    return movement;
  }

  async withdraw(
    tenantId: string,
    cashRegisterId: string,
    userId: string,
    dto: CashMovementDto,
  ) {
    const register = await this.loadRegister(tenantId, cashRegisterId);
    const session = await this.getOpenSession(tenantId, cashRegisterId);
    const amount = toMoney(dto.amount);
    if (amount <= 0) {
      throw new BadRequestException('O valor da sangria deve ser maior que zero');
    }

    // FN-06: a drawer cannot hold negative cash.
    const available = await this.availableBalance(tenantId, session);
    if (amount > available) {
      throw new BadRequestException(
        `Saldo insuficiente no caixa (disponível: ${formatBRL(available)})`,
      );
    }

    const movement = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cashRegisterMovement.create({
        data: {
          tenantId,
          sessionId: session.id,
          type: 'WITHDRAW',
          amount,
          reason: dto.reason,
          performedById: userId,
        },
        include: {
          performedBy: { select: { id: true, name: true } },
        },
      });

      await this.bookOnAccount(tx, {
        tenantId,
        accountId: register.financialAccountId,
        direction: 'out',
        amount,
        description: `Sangria de caixa - ${dto.reason}`,
        sessionId: session.id,
      });

      return created;
    });

    this.logger.log(
      `Cash withdrawal: ${dto.amount} from session ${session.id} by user ${userId}. Reason: ${dto.reason}`,
    );

    return movement;
  }

  async getCurrentSession(tenantId: string, cashRegisterId: string) {
    const cashRegister = await this.prisma.cashRegister.findFirst({
      where: { id: cashRegisterId, tenantId },
    });

    if (!cashRegister) {
      throw new NotFoundException(
        `Caixa não encontrado`,
      );
    }

    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { cashRegisterId, tenantId, status: 'OPEN' },
      include: {
        cashRegister: { select: { id: true, name: true } },
        operator: { select: { id: true, name: true } },
        movements: {
          orderBy: { createdAt: 'desc' },
          include: {
            performedBy: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!session) {
      return { success: true, data: null, message: 'No open session' };
    }

    // A tela e o fechamento contam a mesma coisa: as vendas em dinheiro da
    // sessão entram no saldo. Sem elas a tela mostrava R$ 100 enquanto o
    // fechamento esperava R$ 249,90, e o operador conferia contra o número
    // errado — a "diferença" nascia da tela, não da gaveta.
    const cashSalesAgg = await this.prisma.orderPayment.aggregate({
      _sum: { amount: true },
      where: {
        tenantId,
        paymentMethod: { type: 'CASH' },
        order: { cashRegisterSessionId: session.id },
      },
    });

    return {
      ...session,
      totals: computeSessionTotals({
        openingBalance: session.openingBalance,
        movements: session.movements,
        cashSales: cashSalesAgg._sum.amount,
      }),
    };
  }

  // ─── Session History ─────────────────────────────────────────────────

  /**
   * VD-07: the point of sale needs the open session, so `seller` can reach this
   * listing with `cash-registers:read-session`. That permission must not hand it
   * the whole cash history — other operators' closing balances and differences —
   * so a caller without `financial:read` only ever sees open sessions.
   */
  async findAllSessions(
    tenantId: string,
    query: SessionQueryDto,
    scope: { openSessionsOnly?: boolean } = {},
  ): Promise<PaginatedResponse<unknown>> {
    const {
      page = 1,
      limit = 20,
      cashRegisterId,
      status,
      sortBy,
      sortOrder = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.CashRegisterSessionWhereInput = { tenantId };

    if (cashRegisterId) where.cashRegisterId = cashRegisterId;
    if (status) where.status = status as Prisma.EnumCashSessionStatusFilter;
    if (scope.openSessionsOnly) where.status = 'OPEN';

    const [data, total] = await Promise.all([
      this.prisma.cashRegisterSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: buildPrismaOrderBy(sortBy || 'openedAt', sortOrder),
        include: {
          cashRegister: { select: { id: true, name: true } },
          operator: { select: { id: true, name: true } },
          closedBy: { select: { id: true, name: true } },
        },
      }),
      this.prisma.cashRegisterSession.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, { page, limit, sortBy, sortOrder });
  }

  async findOneSession(tenantId: string, sessionId: string) {
    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { id: sessionId, tenantId },
      include: {
        cashRegister: { select: { id: true, name: true } },
        operator: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
        movements: {
          orderBy: { createdAt: 'asc' },
          include: {
            performedBy: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(
        `Sessão de caixa não encontrada`,
      );
    }

    // Calculate totals
    const supplies = session.movements
      .filter((m) => m.type === 'SUPPLY')
      .reduce((sum, m) => sum + Number(m.amount), 0);

    const withdrawals = session.movements
      .filter((m) => m.type === 'WITHDRAW')
      .reduce((sum, m) => sum + Number(m.amount), 0);

    return {
      ...session,
      totals: {
        supplies,
        withdrawals,
      },
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private async loadRegister(tenantId: string, cashRegisterId: string) {
    const register = await this.prisma.cashRegister.findFirst({
      where: { id: cashRegisterId, tenantId },
    });
    if (!register) {
      throw new NotFoundException(
        `Caixa não encontrado`,
      );
    }
    return register;
  }

  private async getOpenSession(tenantId: string, cashRegisterId: string) {
    const cashRegister = await this.prisma.cashRegister.findFirst({
      where: { id: cashRegisterId, tenantId },
    });

    if (!cashRegister) {
      throw new NotFoundException(
        `Caixa não encontrado`,
      );
    }

    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { cashRegisterId, tenantId, status: 'OPEN' },
      // FN-06: os movimentos vêm junto porque toda operação precisa saber o
      // saldo disponível antes de mexer no caixa.
      include: { movements: { select: { type: true, amount: true } } },
    });

    if (!session) {
      throw new BadRequestException(
        `O caixa "${cashRegister.name}" não está aberto. Abra o caixa para continuar.`,
      );
    }

    return session;
  }
}

/**
 * A conta do saldo de gaveta, num lugar só: abertura + suprimentos + vendas em
 * dinheiro − sangrias.
 *
 * Fechamento, detalhe da sessão e card da listagem contam a mesma coisa. Cada
 * um refazendo a soma por conta própria é como a tela chegou a mostrar
 * "abertura R$ 200 + entradas R$ 0 − saídas R$ 0 = saldo atual R$ 500".
 */
export function computeSessionTotals(input: {
  openingBalance: MoneyLike;
  movements: { type: string; amount: MoneyLike }[];
  cashSales: MoneyLike;
}): {
  supplies: number;
  withdrawals: number;
  cashSales: number;
  currentBalance: number;
} {
  const supplies = sumMoney(
    input.movements.filter((m) => m.type === 'SUPPLY').map((m) => m.amount),
  );
  const withdrawals = sumMoney(
    input.movements.filter((m) => m.type === 'WITHDRAW').map((m) => m.amount),
  );
  const cashSales = toMoney(input.cashSales);

  return {
    supplies,
    withdrawals,
    cashSales,
    currentBalance: sumMoney([
      input.openingBalance,
      supplies,
      cashSales,
      -withdrawals,
    ]),
  };
}
