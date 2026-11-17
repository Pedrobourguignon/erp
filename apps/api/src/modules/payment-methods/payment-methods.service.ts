import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, PaymentMethodType } from '@prisma/client';
import { cardMaxInstallments } from '@erp/validators';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
  PaymentMethodQueryDto,
} from './dto/payment-method.dto';
import {
  PaginatedResponse,
  buildPaginatedResponse,
  buildPrismaOrderBy,
} from '../../common/utils/pagination';

/**
 * O que a tela de venda precisa da maquininha: só quantas parcelas ela aceita.
 * As taxas ficam de fora — quem vende lê métodos (`payment-methods:read`), não
 * o contrato com a operadora.
 */
const METHOD_INCLUDE = {
  defaultAccount: { select: { id: true, name: true, type: true } },
  cardMachine: {
    select: {
      id: true,
      name: true,
      provider: true,
      isActive: true,
      creditReceiveMode: true,
      creditSettlementDays: true,
      rates: { select: { installments: true }, orderBy: { installments: 'asc' as const } },
    },
  },
};

@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger(PaymentMethodsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    query: PaymentMethodQueryDto,
  ): Promise<PaginatedResponse<unknown>> {
    const { page = 1, limit = 20, search, type, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentMethodWhereInput = { tenantId };

    if (type) where.type = type as Prisma.EnumPaymentMethodTypeFilter;
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.paymentMethod.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: METHOD_INCLUDE,
      }),
      this.prisma.paymentMethod.count({ where }),
    ]);

    return buildPaginatedResponse(data.map(withEffectiveInstallments), total, {
      page,
      limit,
      sortOrder: 'asc',
    });
  }

  async findOne(tenantId: string, id: string) {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id, tenantId },
      include: METHOD_INCLUDE,
    });

    if (!method) {
      throw new NotFoundException(
        `Forma de pagamento não encontrada`,
      );
    }

    return withEffectiveInstallments(method);
  }

  async create(tenantId: string, dto: CreatePaymentMethodDto) {
    assertImmediateHasAccount(dto.type, dto.defaultAccountId);
    assertImmediateNotSplit(dto.type, dto.maxInstallments);
    const cardMachineId = await this.resolveCardMachine(tenantId, dto.type, dto.cardMachineId);
    const isCard = isCardType(dto.type);
    assertAnticipationRules({
      autoSettle: dto.autoSettle,
      defaultAccountId: dto.defaultAccountId,
    });

    if (dto.defaultAccountId) {
      const account = await this.prisma.financialAccount.findFirst({
        where: { id: dto.defaultAccountId, tenantId },
      });
      if (!account) {
        throw new NotFoundException(
          `Conta financeira não encontrada`,
        );
      }
    }

    const method = await this.prisma.paymentMethod.create({
      data: {
        tenantId,
        name: dto.name,
        type: dto.type as PaymentMethodType,
        defaultAccountId: dto.defaultAccountId,
        // No cartão, taxa, prazo e parcelas vêm da maquininha.
        feePercentage: isCard ? null : dto.feePercentage,
        settlementDays: isCard ? null : dto.settlementDays,
        maxInstallments: isCard ? 1 : (dto.maxInstallments ?? 1),
        cardMachineId,
        autoSettle: dto.autoSettle ?? false,
        requiresAuthorization: dto.requiresAuthorization ?? false,
        fiscalCode: dto.fiscalCode,
        isActive: dto.isActive ?? true,
      },
      include: METHOD_INCLUDE,
    });

    this.logger.log(
      `Payment method created: ${method.name} (${method.id}) for tenant ${tenantId}`,
    );

    return withEffectiveInstallments(method);
  }

  async update(tenantId: string, id: string, dto: UpdatePaymentMethodDto) {
    const existing = await this.prisma.paymentMethod.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException(
        `Forma de pagamento não encontrada`,
      );
    }

    // VD-11: o tipo resultante da edição é o que vale — trocar um boleto para
    // dinheiro sem vincular conta recria exatamente o bug.
    assertImmediateHasAccount(
      dto.type ?? existing.type,
      dto.defaultAccountId !== undefined
        ? dto.defaultAccountId
        : existing.defaultAccountId,
    );

    assertImmediateNotSplit(
      dto.type ?? existing.type,
      dto.maxInstallments ?? existing.maxInstallments,
    );

    const resultingType = dto.type ?? existing.type;
    const cardMachineId = await this.resolveCardMachine(
      tenantId,
      resultingType,
      dto.cardMachineId !== undefined ? dto.cardMachineId : existing.cardMachineId,
    );

    // O que vale é o método como ficará depois da edição.
    assertAnticipationRules({
      autoSettle: dto.autoSettle !== undefined ? dto.autoSettle : existing.autoSettle,
      defaultAccountId:
        dto.defaultAccountId !== undefined ? dto.defaultAccountId : existing.defaultAccountId,
    });

    if (dto.defaultAccountId) {
      const account = await this.prisma.financialAccount.findFirst({
        where: { id: dto.defaultAccountId, tenantId },
      });
      if (!account) {
        throw new NotFoundException(
          `Conta financeira não encontrada`,
        );
      }
    }

    const updateData: Prisma.PaymentMethodUncheckedUpdateInput = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.type !== undefined) updateData.type = dto.type as PaymentMethodType;
    if (dto.defaultAccountId !== undefined) updateData.defaultAccountId = dto.defaultAccountId;
    if (dto.feePercentage !== undefined) updateData.feePercentage = dto.feePercentage;
    if (dto.settlementDays !== undefined) updateData.settlementDays = dto.settlementDays;
    if (dto.maxInstallments !== undefined) updateData.maxInstallments = dto.maxInstallments;
    if (dto.autoSettle !== undefined) updateData.autoSettle = dto.autoSettle;
    if (dto.requiresAuthorization !== undefined) updateData.requiresAuthorization = dto.requiresAuthorization;
    if (dto.fiscalCode !== undefined) updateData.fiscalCode = dto.fiscalCode;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    updateData.cardMachineId = cardMachineId;
    if (isCardType(resultingType)) {
      updateData.feePercentage = null;
      updateData.settlementDays = null;
      updateData.maxInstallments = 1;
    }

    const updated = await this.prisma.paymentMethod.update({
      where: { id },
      data: updateData,
      include: METHOD_INCLUDE,
    });

    this.logger.log(
      `Payment method updated: ${updated.name} (${updated.id}) for tenant ${tenantId}`,
    );

    return withEffectiveInstallments(updated);
  }

  /**
   * Crédito e débito precisam de uma maquininha ativa da mesma empresa; os
   * demais tipos nunca ficam vinculados a uma.
   */
  private async resolveCardMachine(
    tenantId: string,
    type: string | undefined,
    cardMachineId: string | null | undefined,
  ): Promise<string | null> {
    if (!isCardType(type)) return null;
    if (!cardMachineId) {
      throw new BadRequestException(
        'Escolha a maquininha desta forma de pagamento — é dela que vêm as taxas, os prazos e as parcelas do cartão.',
      );
    }

    const machine = await this.prisma.cardMachine.findFirst({
      where: { id: cardMachineId, tenantId },
      select: { id: true, name: true, isActive: true },
    });
    if (!machine) {
      throw new BadRequestException('Maquininha não encontrada');
    }
    if (!machine.isActive) {
      throw new BadRequestException(
        `A maquininha "${machine.name}" está inativa. Reative-a em Configurações > Maquininhas ou escolha outra.`,
      );
    }
    return machine.id;
  }

  async remove(tenantId: string, id: string) {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true },
    });

    if (!method) {
      throw new NotFoundException(
        `Forma de pagamento não encontrada`,
      );
    }

    // Um pedido antigo aponta para este método por `paymentMethodId` — apagar
    // de verdade quebraria o histórico de vendas já fechadas. Mesma regra do
    // FN-16 nas contas financeiras: usado vira inativo, nunca usado some.
    const [orderPayments, receivables, payables] = await Promise.all([
      this.prisma.orderPayment.count({ where: { tenantId, paymentMethodId: id } }),
      this.prisma.accountsReceivable.count({ where: { tenantId, paymentMethodId: id } }),
      this.prisma.accountsPayable.count({ where: { tenantId, paymentMethodId: id } }),
    ]);
    const usageCount = orderPayments + receivables + payables;

    if (usageCount > 0) {
      await this.prisma.paymentMethod.update({
        where: { id },
        data: { isActive: false },
      });
      this.logger.log(
        `Payment method ${id} deactivated (${usageCount} references) for tenant ${tenantId}`,
      );
      return {
        id,
        deactivated: true,
        message: `A forma de pagamento "${method.name}" já foi usada e foi inativada em vez de excluída.`,
      };
    }

    await this.prisma.paymentMethod.delete({ where: { id } });
    this.logger.log(`Payment method ${id} deleted for tenant ${tenantId}`);

    return { id, deactivated: false, message: 'Forma de pagamento excluída.' };
  }
}

/**
 * Tipos liquidados na hora: o dinheiro entra na conta no momento da venda, então
 * a conta precisa existir. Sem ela a API recusa a venda (SCRUM-30) — ou pior,
 * o operador escolhe um método `OTHER` que passa na validação e gera recebível
 * pendente para uma venda já paga (VD-11).
 */
const IMMEDIATE_METHOD_TYPES = ['CASH', 'PIX', 'DEBIT_CARD'];

function assertImmediateHasAccount(
  type: string | undefined,
  defaultAccountId: string | null | undefined,
): void {
  if (!type || !IMMEDIATE_METHOD_TYPES.includes(type)) return;
  if (defaultAccountId) return;

  throw new BadRequestException(
    'Métodos de pagamento à vista (dinheiro, PIX, débito) exigem uma conta financeira vinculada — é nela que o dinheiro entra no momento da venda.',
  );
}

/**
 * Dinheiro, PIX e débito entram inteiros na hora — parcelar um deles geraria
 * recebíveis futuros para um dinheiro que já está na conta.
 */
function assertImmediateNotSplit(
  type: string | undefined,
  maxInstallments: number | null | undefined,
): void {
  if (!type || !IMMEDIATE_METHOD_TYPES.includes(type)) return;
  if (!maxInstallments || maxInstallments <= 1) return;

  throw new BadRequestException(
    'Um método de dinheiro, PIX ou débito não pode ser parcelado — o valor entra inteiro na conta no momento da venda. Deixe o máximo de parcelas em 1.',
  );
}

/**
 * Uma baixa automática sem conta para creditar falharia em silêncio todo dia.
 */
function assertAnticipationRules(method: {
  autoSettle?: boolean | null;
  defaultAccountId?: string | null;
}): void {
  if (method.autoSettle && !method.defaultAccountId) {
    throw new BadRequestException(
      'A baixa automática precisa de uma conta financeira vinculada — é nela que o dinheiro entra no dia.',
    );
  }
}

const CARD_METHOD_TYPES = ['CREDIT_CARD', 'DEBIT_CARD'];

function isCardType(type: string | undefined | null): boolean {
  return !!type && CARD_METHOD_TYPES.includes(type);
}

/**
 * Quantas parcelas a venda pode oferecer: no crédito, a maior linha da tabela
 * da maquininha; no débito, nunca parcela; nos demais, o máximo do método.
 */
function withEffectiveInstallments<
  T extends {
    type: string;
    maxInstallments: number;
    cardMachine?: { rates: { installments: number }[] } | null;
  },
>(method: T): T {
  if (method.type === 'DEBIT_CARD') return { ...method, maxInstallments: 1 };
  if (method.type === 'CREDIT_CARD') {
    return {
      ...method,
      maxInstallments: method.cardMachine ? cardMaxInstallments(method.cardMachine) : 1,
    };
  }
  return method;
}
