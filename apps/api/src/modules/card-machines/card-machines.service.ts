import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CardReceiveMode, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { PaginatedResponse, buildPaginatedResponse } from '../../common/utils/pagination';
import {
  CardMachineQueryDto,
  CardMachineRateDto,
  CreateCardMachineDto,
  UpdateCardMachineDto,
} from './dto/card-machine.dto';

const WITH_RATES = {
  rates: {
    select: { installments: true, feePercentage: true },
    orderBy: { installments: 'asc' as const },
  },
  _count: { select: { paymentMethods: true } },
};

@Injectable()
export class CardMachinesService {
  private readonly logger = new Logger(CardMachinesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    query: CardMachineQueryDto,
  ): Promise<PaginatedResponse<unknown>> {
    const { page = 1, limit = 20, search, isActive } = query;
    const where: Prisma.CardMachineWhereInput = { tenantId };
    if (isActive !== undefined) where.isActive = isActive;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const [data, total] = await Promise.all([
      this.prisma.cardMachine.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { name: 'asc' },
        include: WITH_RATES,
      }),
      this.prisma.cardMachine.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, { page, limit, sortOrder: 'asc' });
  }

  async findOne(tenantId: string, id: string) {
    const machine = await this.prisma.cardMachine.findFirst({
      where: { id, tenantId },
      include: WITH_RATES,
    });
    if (!machine) throw new NotFoundException('Maquininha não encontrada');
    return machine;
  }

  async create(tenantId: string, dto: CreateCardMachineDto) {
    const rates = normalizeRates(dto.rates ?? []);

    const machine = await this.prisma.cardMachine.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        provider: dto.provider?.trim() || null,
        debitFeePercentage: dto.debitFeePercentage ?? 0,
        debitSettlementDays: dto.debitSettlementDays ?? 1,
        creditReceiveMode: (dto.creditReceiveMode ?? 'FLOW') as CardReceiveMode,
        creditSettlementDays: dto.creditSettlementDays ?? 30,
        isActive: dto.isActive ?? true,
        rates: { create: rates },
      },
      include: WITH_RATES,
    });

    this.logger.log(`Card machine created: ${machine.id} for tenant ${tenantId}`);
    return machine;
  }

  async update(tenantId: string, id: string, dto: UpdateCardMachineDto) {
    await this.assertExists(tenantId, id);
    const rates = dto.rates !== undefined ? normalizeRates(dto.rates) : undefined;

    const data: Prisma.CardMachineUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.provider !== undefined) data.provider = dto.provider?.trim() || null;
    if (dto.debitFeePercentage !== undefined) data.debitFeePercentage = dto.debitFeePercentage;
    if (dto.debitSettlementDays !== undefined) data.debitSettlementDays = dto.debitSettlementDays;
    if (dto.creditReceiveMode !== undefined)
      data.creditReceiveMode = dto.creditReceiveMode as CardReceiveMode;
    if (dto.creditSettlementDays !== undefined)
      data.creditSettlementDays = dto.creditSettlementDays;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (rates) {
        // A tabela é trocada inteira: é o que a tela edita e evita sobra de
        // linhas antigas acima do novo máximo.
        await tx.cardMachineRate.deleteMany({ where: { cardMachineId: id } });
        if (rates.length > 0) {
          await tx.cardMachineRate.createMany({
            data: rates.map((r) => ({ cardMachineId: id, ...r })),
          });
        }
      }
      return tx.cardMachine.update({ where: { id }, data, include: WITH_RATES });
    });

    this.logger.log(`Card machine updated: ${id} for tenant ${tenantId}`);
    return updated;
  }

  async remove(tenantId: string, id: string) {
    const machine = await this.assertExists(tenantId, id);

    // Um método de cartão aponta para ela — apagar deixaria o método sem taxas
    // e prazos. Mesma regra do FN-16: usada vira inativa, nunca usada some.
    const linked = await this.prisma.paymentMethod.count({
      where: { tenantId, cardMachineId: id },
    });

    if (linked > 0) {
      await this.prisma.cardMachine.update({ where: { id }, data: { isActive: false } });
      this.logger.log(`Card machine ${id} deactivated (${linked} methods) for tenant ${tenantId}`);
      return {
        id,
        deactivated: true,
        message: `A maquininha "${machine.name}" está vinculada a formas de pagamento e foi inativada em vez de excluída.`,
      };
    }

    await this.prisma.cardMachine.delete({ where: { id } });
    this.logger.log(`Card machine ${id} deleted for tenant ${tenantId}`);
    return { id, deactivated: false, message: 'Maquininha excluída.' };
  }

  private async assertExists(tenantId: string, id: string) {
    const machine = await this.prisma.cardMachine.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true },
    });
    if (!machine) throw new NotFoundException('Maquininha não encontrada');
    return machine;
  }
}

/**
 * A tabela vai de 1x até o máximo, sem buracos: com 1x, 2x e 4x o vendedor
 * poderia escolher 3x e a venda não teria taxa nenhuma.
 */
function normalizeRates(rates: CardMachineRateDto[]): CardMachineRateDto[] {
  const sorted = [...rates]
    .map((r) => ({ installments: r.installments, feePercentage: r.feePercentage }))
    .sort((a, b) => a.installments - b.installments);

  sorted.forEach((rate, index) => {
    const expected = index + 1;
    if (rate.installments === expected) return;
    if (rate.installments < expected) {
      throw new BadRequestException(
        `A taxa de ${rate.installments}x aparece mais de uma vez na tabela.`,
      );
    }
    throw new BadRequestException(
      `Falta a taxa de ${expected}x. A tabela precisa ir de 1x até o máximo de parcelas, sem pular nenhuma.`,
    );
  });

  return sorted;
}
