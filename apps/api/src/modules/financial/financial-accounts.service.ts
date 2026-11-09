import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, BankAccountType } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { parseUserDate } from '../../common/utils/date-range.util';
import {
  CreateFinancialAccountDto,
  UpdateFinancialAccountDto,
  FinancialAccountQueryDto,
} from './dto/financial-account.dto';
import { TransferBetweenAccountsDto } from './dto/transfer.dto';
import {
  PaginatedResponse,
  buildPaginatedResponse,
} from '../../common/utils/pagination';
import {
  formatBRL,
  subtractMoney,
  toCents,
  toMoney,
} from '../../common/utils/money.util';

@Injectable()
export class FinancialAccountsService {
  private readonly logger = new Logger(FinancialAccountsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    query: FinancialAccountQueryDto,
  ): Promise<PaginatedResponse<unknown>> {
    const { page = 1, limit = 20, search, type, isActive } = query;
    const skip = (page - 1) * limit;

    // FN-16: conta excluída some das telas, mas continua no banco para não
    // quebrar o extrato das transações que a referenciam.
    const where: Prisma.FinancialAccountWhereInput = { tenantId, deletedAt: null };

    if (type) where.type = type as BankAccountType;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { bankName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.financialAccount.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          type: true,
          code: true,
          bankName: true,
          bankBranch: true,
          bankAccount: true,
          balance: true,
          isActive: true,
          acceptsDirectSales: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              cashRegisters: true,
              paymentMethods: true,
            },
          },
        },
      }),
      this.prisma.financialAccount.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, { page, limit, sortOrder: 'asc' });
  }

  async findOne(tenantId: string, id: string) {
    const account = await this.prisma.financialAccount.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        type: true,
        code: true,
        bankName: true,
        bankBranch: true,
        bankAccount: true,
        balance: true,
        isActive: true,
        acceptsDirectSales: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            cashRegisters: true,
            paymentMethods: true,
            transactions: true,
          },
        },
      },
    });

    if (!account) {
      throw new NotFoundException(
        `Conta financeira não encontrada`,
      );
    }

    return account;
  }

  async create(tenantId: string, dto: CreateFinancialAccountDto) {
    await this.assertNoDuplicate(tenantId, dto.name, dto.code);

    const account = await this.prisma.financialAccount.create({
      data: {
        tenantId,
        name: dto.name,
        type: dto.type as BankAccountType,
        code: dto.code,
        bankName: dto.bankName,
        bankBranch: dto.bankBranch,
        bankAccount: dto.bankAccount,
        acceptsDirectSales: dto.acceptsDirectSales ?? false,
        isActive: dto.isActive ?? true,
      },
    });

    this.logger.log(
      `Financial account created: ${account.name} (${account.id}) for tenant ${tenantId}`,
    );

    return account;
  }


  // ─── FN-16: nome e código não podem repetir ─────────────────────────────

  /**
   * "Banco do Brasil | BB" existia duas vezes e todo combo do sistema ficava
   * ambíguo: o operador não sabia qual conta uma baixa tinha creditado.
   */
  private async assertNoDuplicate(
    tenantId: string,
    name?: string,
    code?: string | null,
    exceptId?: string,
  ): Promise<void> {
    const notItself = exceptId ? { id: { not: exceptId } } : {};

    if (code) {
      const sameCode = await this.prisma.financialAccount.findFirst({
        where: { tenantId, code, deletedAt: null, ...notItself },
        select: { id: true },
      });
      if (sameCode) {
        throw new ConflictException(
          `Já existe uma conta financeira com o código "${code}"`,
        );
      }
    }

    if (name) {
      const sameName = await this.prisma.financialAccount.findFirst({
        where: {
          tenantId,
          name: { equals: name, mode: 'insensitive' },
          deletedAt: null,
          ...notItself,
        },
        select: { id: true },
      });
      if (sameName) {
        throw new ConflictException(
          `Já existe uma conta financeira chamada "${name}"`,
        );
      }
    }
  }

  /**
   * FN-16: uma conta com movimento **nunca** é excluída — vira inativa. Apagar
   * uma conta que já apareceu num extrato deixaria transações órfãs e
   * conciliação impossível. Sem movimento, sai das telas por soft delete.
   */
  async remove(tenantId: string, id: string) {
    const account = await this.prisma.financialAccount.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true, name: true, balance: true },
    });

    if (!account) {
      throw new NotFoundException(
        `Conta financeira não encontrada`,
      );
    }

    // Excluir uma conta com saldo faz o dinheiro sumir dos relatórios sem
    // nunca ter sido movido de verdade — o saldo tem que ir para outra conta
    // primeiro, não para o limbo de uma conta apagada.
    if (toCents(account.balance) !== 0) {
      throw new ConflictException(
        `A conta "${account.name}" tem saldo de ${formatBRL(account.balance)} e não pode ser excluída. Transfira o saldo para outra conta antes de excluir.`,
      );
    }

    const linkedMethods = await this.prisma.paymentMethod.findMany({
      where: { tenantId, defaultAccountId: id },
      select: { name: true },
    });

    if (linkedMethods.length > 0) {
      throw new ConflictException(
        `A conta "${account.name}" é a conta padrão de ${linkedMethods.length} método(s) de pagamento (${linkedMethods.map((m) => m.name).join(', ')}) e não pode ser excluída. Troque a conta padrão desses métodos antes de excluir.`,
      );
    }

    const movements = await this.prisma.financialTransaction.count({
      where: { tenantId, accountId: id },
    });

    if (movements > 0) {
      await this.prisma.financialAccount.update({
        where: { id },
        data: { isActive: false },
      });
      this.logger.log(
        `Financial account ${id} deactivated (${movements} movements) for tenant ${tenantId}`,
      );
      return {
        id,
        deactivated: true,
        message: `A conta "${account.name}" tem movimento e foi inativada em vez de excluída.`,
      };
    }

    await this.prisma.financialAccount.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    this.logger.log(`Financial account ${id} deleted for tenant ${tenantId}`);

    return { id, deactivated: false, message: 'Conta financeira excluída.' };
  }

  async update(tenantId: string, id: string, dto: UpdateFinancialAccountDto) {
    const existing = await this.prisma.financialAccount.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException(
        `Conta financeira não encontrada`,
      );
    }

    await this.assertNoDuplicate(tenantId, dto.name, dto.code, id);

    const updateData: Prisma.FinancialAccountUncheckedUpdateInput = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.type !== undefined) updateData.type = dto.type as BankAccountType;
    if (dto.code !== undefined) updateData.code = dto.code;
    if (dto.bankName !== undefined) updateData.bankName = dto.bankName;
    if (dto.bankBranch !== undefined) updateData.bankBranch = dto.bankBranch;
    if (dto.bankAccount !== undefined) updateData.bankAccount = dto.bankAccount;
    if (dto.acceptsDirectSales !== undefined) updateData.acceptsDirectSales = dto.acceptsDirectSales;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    const updated = await this.prisma.financialAccount.update({
      where: { id },
      data: updateData,
    });

    this.logger.log(
      `Financial account updated: ${updated.name} (${updated.id}) for tenant ${tenantId}`,
    );

    return updated;
  }

  /**
   * Transferência entre contas — SCRUM-14.
   * Debita a origem e credita o destino atomicamente, gerando dois
   * FinancialTransaction vinculados por um transferId compartilhado.
   */
  async transfer(tenantId: string, dto: TransferBetweenAccountsDto) {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException(
        'A conta de origem e a de destino devem ser diferentes',
      );
    }

    const amount = Math.round(dto.amount * 100) / 100;
    if (amount <= 0) {
      throw new BadRequestException('O valor da transferência deve ser maior que zero');
    }

    const [from, to] = await Promise.all([
      this.prisma.financialAccount.findFirst({
        where: { id: dto.fromAccountId, tenantId },
        select: { id: true, name: true, type: true, balance: true },
      }),
      this.prisma.financialAccount.findFirst({
        where: { id: dto.toAccountId, tenantId },
        select: { id: true, name: true },
      }),
    ]);

    if (!from) {
      throw new NotFoundException(
        `Conta de origem não encontrada`,
      );
    }
    if (!to) {
      throw new NotFoundException(
        `Conta de destino não encontrada`,
      );
    }

    const transferId = randomUUID();
    // Same rule as everywhere else: a date the user picked is a civil date.
    const when = dto.date ? parseUserDate(dto.date) : new Date();
    const description =
      dto.description?.trim() || `Transferência ${from.name} → ${to.name}`;

    // FN-17: uma conta do tipo Caixa é dinheiro físico — não existe saldo
    // negativo numa gaveta. Conta bancária pode ficar negativa (limite,
    // cheque especial), mas só com confirmação explícita de quem transfere.
    assertCanGoNegative(from, amount, dto.allowNegativeBalance);

    const result = await this.prisma.$transaction((tx) =>
      applyTransfer(tx, {
        tenantId,
        from,
        to,
        amount,
        description,
        when,
        transferId,
      }),
    );

    this.logger.log(
      `Transfer ${transferId}: ${amount} from ${from.id} to ${to.id} (tenant ${tenantId})`,
    );

    return {
      transferId,
      amount,
      description,
      date: when,
      fromAccountId: from.id,
      toAccountId: to.id,
      sourceBalance: result.sourceBalance,
      destinationBalance: result.destinationBalance,
      debitTransactionId: result.debit.id,
      creditTransactionId: result.credit.id,
    };
  }
}


/**
 * As duas pernas de uma transferência, dentro de uma transação já aberta.
 *
 * O fechamento de caixa precisa mover o dinheiro da gaveta para o banco/cofre
 * na *mesma* transação em que fecha a sessão: uma segunda chamada poderia
 * falhar com o caixa já fechado, e o dinheiro ficaria contado em dois lugares.
 * Por isso a mecânica mora aqui fora do serviço, e não dentro do `$transaction`
 * de `transfer()`.
 */
export async function applyTransfer(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    from: { id: string; name: string };
    to: { id: string; name: string };
    amount: number;
    description: string;
    when: Date;
    transferId: string;
  },
) {
  const { tenantId, from, to, amount, description, when, transferId } = input;

  const source = await tx.financialAccount.update({
    where: { id: from.id },
    data: { balance: { decrement: amount } },
    select: { balance: true },
  });

  const destination = await tx.financialAccount.update({
    where: { id: to.id },
    data: { balance: { increment: amount } },
    select: { balance: true },
  });

  const debit = await tx.financialTransaction.create({
    data: {
      tenantId,
      accountId: from.id,
      type: 'DEBIT',
      amount,
      balanceAfter: source.balance,
      description,
      referenceType: 'transfer',
      referenceId: transferId,
      metadata: { transferId, direction: 'out', counterpartyAccountId: to.id },
      createdAt: when,
    },
  });

  const credit = await tx.financialTransaction.create({
    data: {
      tenantId,
      accountId: to.id,
      type: 'CREDIT',
      amount,
      balanceAfter: destination.balance,
      description,
      referenceType: 'transfer',
      referenceId: transferId,
      metadata: { transferId, direction: 'in', counterpartyAccountId: from.id },
      createdAt: when,
    },
  });

  return {
    sourceBalance: source.balance,
    destinationBalance: destination.balance,
    debit,
    credit,
  };
}

/**
 * FN-17: a transferência de uma conta zerada deixou o Santander em −R$ 250,00
 * sem um aviso sequer. Dinheiro físico não fica negativo; conta bancária fica,
 * mas nunca por acidente.
 */
function assertCanGoNegative(
  account: { name: string; type: string; balance: Prisma.Decimal | number },
  amount: number,
  allowed?: boolean,
): void {
  const balance = toMoney(account.balance);
  const after = subtractMoney(balance, amount);
  if (after >= 0) return;

  if (account.type === 'CASH') {
    throw new BadRequestException(
      `Saldo insuficiente em "${account.name}" (disponível: ${formatBRL(balance)}). Uma conta do tipo Caixa não pode ficar negativa.`,
    );
  }

  if (!allowed) {
    throw new BadRequestException(
      `Esta transferência deixa "${account.name}" com saldo negativo (${formatBRL(after)}). Confirme para continuar.`,
    );
  }
}

