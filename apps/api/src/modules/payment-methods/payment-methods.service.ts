import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, PaymentMethodType } from '@prisma/client';
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
        include: {
          defaultAccount: {
            select: { id: true, name: true, type: true },
          },
        },
      }),
      this.prisma.paymentMethod.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, { page, limit, sortOrder: 'asc' });
  }

  async findOne(tenantId: string, id: string) {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id, tenantId },
      include: {
        defaultAccount: {
          select: { id: true, name: true, type: true },
        },
      },
    });

    if (!method) {
      throw new NotFoundException(
        `Forma de pagamento não encontrada`,
      );
    }

    return method;
  }

  async create(tenantId: string, dto: CreatePaymentMethodDto) {
    assertImmediateHasAccount(dto.type, dto.defaultAccountId);
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
        feePercentage: dto.feePercentage,
        settlementDays: dto.settlementDays,
        autoSettle: dto.autoSettle ?? false,
        requiresAuthorization: dto.requiresAuthorization ?? false,
        fiscalCode: dto.fiscalCode,
        isActive: dto.isActive ?? true,
      },
      include: {
        defaultAccount: {
          select: { id: true, name: true, type: true },
        },
      },
    });

    this.logger.log(
      `Payment method created: ${method.name} (${method.id}) for tenant ${tenantId}`,
    );

    return method;
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
    if (dto.autoSettle !== undefined) updateData.autoSettle = dto.autoSettle;
    if (dto.requiresAuthorization !== undefined) updateData.requiresAuthorization = dto.requiresAuthorization;
    if (dto.fiscalCode !== undefined) updateData.fiscalCode = dto.fiscalCode;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    const updated = await this.prisma.paymentMethod.update({
      where: { id },
      data: updateData,
      include: {
        defaultAccount: {
          select: { id: true, name: true, type: true },
        },
      },
    });

    this.logger.log(
      `Payment method updated: ${updated.name} (${updated.id}) for tenant ${tenantId}`,
    );

    return updated;
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
