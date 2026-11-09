import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma, PaymentConditionType } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { CreatePaymentConditionDto } from './dto/create-payment-condition.dto';
import { UpdatePaymentConditionDto } from './dto/update-payment-condition.dto';
import { PaymentConditionQueryDto } from './dto/payment-condition-query.dto';
import {
  PaginatedResponse,
  buildPaginatedResponse,
  buildPrismaOrderBy,
} from '../../common/utils/pagination';

@Injectable()
export class PaymentConditionsService {
  private readonly logger = new Logger(PaymentConditionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    query: PaymentConditionQueryDto,
  ): Promise<PaginatedResponse<unknown>> {
    const {
      page = 1,
      limit = 20,
      search,
      sortBy,
      sortOrder = 'desc',
      type,
      isActive,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.PaymentConditionWhereInput = { tenantId };

    if (type) where.type = type as Prisma.EnumPaymentConditionTypeFilter;
    if (isActive !== undefined) where.isActive = isActive;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.paymentCondition.findMany({
        where,
        skip,
        take: limit,
        orderBy: buildPrismaOrderBy(sortBy, sortOrder),
        include: { paymentMethods: { select: { id: true, name: true } } },
      }),
      this.prisma.paymentCondition.count({ where }),
    ]);

    return buildPaginatedResponse(
      data.map(withMethodIds),
      total,
      { page, limit, sortBy, sortOrder },
    );
  }

  async findOne(tenantId: string, id: string) {
    const condition = await this.prisma.paymentCondition.findFirst({
      where: { id, tenantId },
      include: { paymentMethods: { select: { id: true, name: true } } },
    });

    if (!condition) {
      throw new NotFoundException(
        `Condição de pagamento não encontrada`,
      );
    }

    return withMethodIds(condition);
  }

  /**
   * SCRUM-52: o vínculo só pode apontar para métodos do próprio tenant — sem
   * isto, o id de outro tenant passaria despercebido e a condição pareceria
   * vinculada sem nunca aparecer filtrada para ninguém.
   */
  private async assertMethodsBelongToTenant(
    tenantId: string,
    paymentMethodIds: string[],
  ): Promise<void> {
    if (paymentMethodIds.length === 0) return;

    const found = await this.prisma.paymentMethod.findMany({
      where: { id: { in: paymentMethodIds }, tenantId },
      select: { id: true },
    });

    if (found.length !== new Set(paymentMethodIds).size) {
      throw new BadRequestException(
        'Um ou mais métodos de pagamento informados não existem para este tenant.',
      );
    }
  }

  async create(tenantId: string, dto: CreatePaymentConditionDto) {
    // Check for duplicate code in tenant
    const existing = await this.prisma.paymentCondition.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });

    if (existing) {
      throw new ConflictException(
        `Já existe uma condição de pagamento com o código "${dto.code}"`,
      );
    }

    const methodIds = dto.paymentMethodIds ?? [];
    await this.assertMethodsBelongToTenant(tenantId, methodIds);

    const condition = await this.prisma.paymentCondition.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        type: dto.type as PaymentConditionType,
        installments: dto.installments ?? 1,
        daysBetweenInstallments: dto.daysBetweenInstallments ?? 0,
        entryPercentage: dto.entryPercentage ?? 0,
        isActive: dto.isActive ?? true,
        paymentMethods: { connect: methodIds.map((id) => ({ id })) },
      },
      include: { paymentMethods: { select: { id: true, name: true } } },
    });

    this.logger.log(
      `Payment condition created: ${condition.name} (${condition.id}) for tenant ${tenantId}`,
    );

    return withMethodIds(condition);
  }

  async update(tenantId: string, id: string, dto: UpdatePaymentConditionDto) {
    const existing = await this.prisma.paymentCondition.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException(
        `Condição de pagamento não encontrada`,
      );
    }

    // If code is being changed, check for duplicates
    if (dto.code && dto.code !== existing.code) {
      const duplicate = await this.prisma.paymentCondition.findUnique({
        where: { tenantId_code: { tenantId, code: dto.code } },
      });

      if (duplicate) {
        throw new ConflictException(
          `Já existe uma condição de pagamento com o código "${dto.code}"`,
        );
      }
    }

    if (dto.paymentMethodIds !== undefined) {
      await this.assertMethodsBelongToTenant(tenantId, dto.paymentMethodIds);
    }

    const updated = await this.prisma.paymentCondition.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.type !== undefined && { type: dto.type as PaymentConditionType }),
        ...(dto.installments !== undefined && { installments: dto.installments }),
        ...(dto.daysBetweenInstallments !== undefined && { daysBetweenInstallments: dto.daysBetweenInstallments }),
        ...(dto.entryPercentage !== undefined && { entryPercentage: dto.entryPercentage }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        // `set` replaces the whole link list — omitting the field leaves the
        // existing links untouched (checked above), sending `[]` clears them.
        ...(dto.paymentMethodIds !== undefined && {
          paymentMethods: { set: dto.paymentMethodIds.map((mid) => ({ id: mid })) },
        }),
      } as Prisma.PaymentConditionUncheckedUpdateInput,
      include: { paymentMethods: { select: { id: true, name: true } } },
    });

    this.logger.log(
      `Payment condition updated: ${updated.name} (${updated.id}) for tenant ${tenantId}`,
    );

    return withMethodIds(updated);
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.paymentCondition.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException(
        `Condição de pagamento não encontrada`,
      );
    }

    // Soft deactivation rather than hard delete
    const updated = await this.prisma.paymentCondition.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.log(
      `Payment condition deactivated: ${updated.name} (${updated.id}) for tenant ${tenantId}`,
    );

    return { success: true, message: 'Payment condition deactivated' };
  }
}

/**
 * Flattens the included relation into the id list the frontend filters by.
 *
 * `entryPercentage` é `Decimal` no Prisma e sai como **string** no JSON
 * ("0", "50.5"). O contrato do frontend declara `number`, e o formulário de
 * edição recusava o valor calado: o campo Entrada só aparece no tipo
 * "Entrada + Parcelas", então em qualquer outro tipo o erro ficava invisível
 * e o Salvar só emitia o toast de campo inválido. Normaliza aqui, na
 * fronteira, para o JSON bater com o tipo declarado.
 */
function withMethodIds<
  T extends {
    paymentMethods: { id: string; name: string }[];
    entryPercentage: Prisma.Decimal;
  },
>(condition: T) {
  return {
    ...condition,
    entryPercentage: Number(condition.entryPercentage),
    paymentMethodIds: condition.paymentMethods.map((m) => m.id),
  };
}
