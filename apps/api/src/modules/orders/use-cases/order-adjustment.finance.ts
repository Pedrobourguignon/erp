import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { civilDaysFrom } from '../../../common/utils/date-range.util';
import { subtractMoney, sumMoney, toMoney } from '../../../common/utils/money.util';
import { settlesAtSale } from '../../../common/constants/payment.constants';
import { FinancialSettlementsService } from '../../financial/financial-settlements.service';
import { OrderAdjustmentSettlementDto } from '../dto/order-adjustment-settlement.dto';

type Tx = Prisma.TransactionClient;

const OPEN_RECEIVABLE_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] as const;

export interface SettlementPlan {
  paymentMethodId: string;
  /** null = forma que liquida depois: o título fica em aberto. */
  accountId: string | null;
}

export interface DifferenceInput {
  orderId: string;
  orderNumber: string;
  customerId: string | null;
  adjustmentId: string;
  /** > 0 cliente paga; < 0 loja devolve. */
  difference: number;
  label: 'troca' | 'devolução';
  settlement: SettlementPlan | null;
}

export interface DifferenceOutcome {
  receivableId: string | null;
  payableId: string | null;
  abatedAmount: number;
  refundAmount: number;
  settled: boolean;
}

/**
 * O lado financeiro de uma troca/devolução: o título da diferença, o
 * abatimento do que o cliente ainda deve e a baixa no ato.
 *
 * Segue o modelo do estorno — quem cria a obrigação é o título, quem move
 * dinheiro é a baixa — só que a baixa pode acontecer no mesmo ato, pelo mesmo
 * `FinancialSettlementsService` de /financeiro/lancamentos, e por isso também
 * espelha na gaveta quando a conta é a de um caixa aberto.
 */
@Injectable()
export class OrderAdjustmentFinance {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: FinancialSettlementsService,
  ) {}

  /**
   * A conta sai da forma de pagamento, como numa venda: dinheiro é a gaveta de
   * um caixa aberto (o da venda, se ainda estiver; senão o único aberto ou o
   * escolhido), PIX/débito é a conta da forma. Forma que liquida depois não
   * tem conta agora — o título fica em aberto.
   */
  async planSettlement(
    tenantId: string,
    order: { cashRegisterSessionId: string | null },
    dto: OrderAdjustmentSettlementDto,
  ): Promise<SettlementPlan> {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: dto.paymentMethodId, tenantId },
      select: { id: true, name: true, type: true, settlementDays: true, defaultAccountId: true },
    });
    if (!method) throw new NotFoundException('Forma de pagamento não encontrada');

    if (!settlesAtSale(method.type, method.settlementDays)) {
      return { paymentMethodId: method.id, accountId: null };
    }

    if (method.type === 'CASH') {
      const accountId = await this.resolveDrawerAccount(tenantId, order, dto.cashRegisterSessionId);
      return { paymentMethodId: method.id, accountId };
    }

    if (!method.defaultAccountId) {
      throw new BadRequestException(
        `A forma de pagamento "${method.name}" não possui conta financeira vinculada. ` +
          'Vincule uma conta em Configurações > Métodos de Pagamento.',
      );
    }
    return { paymentMethodId: method.id, accountId: method.defaultAccountId };
  }

  private async resolveDrawerAccount(
    tenantId: string,
    order: { cashRegisterSessionId: string | null },
    chosenSessionId?: string,
  ): Promise<string> {
    const preferredId = chosenSessionId ?? order.cashRegisterSessionId;
    if (preferredId) {
      const preferred = await this.prisma.cashRegisterSession.findFirst({
        where: { id: preferredId, tenantId, status: 'OPEN' },
        select: { id: true, cashRegister: { select: { financialAccountId: true } } },
      });
      if (preferred) return preferred.cashRegister.financialAccountId;
      if (chosenSessionId) {
        throw new BadRequestException('O caixa escolhido não está aberto.');
      }
    }

    const open = await this.prisma.cashRegisterSession.findMany({
      where: { tenantId, status: 'OPEN' },
      select: { id: true, cashRegister: { select: { financialAccountId: true } } },
    });
    if (open.length === 0) {
      throw new BadRequestException(
        'Não há caixa aberto para movimentar dinheiro. Abra o caixa ou escolha outra forma de pagamento.',
      );
    }
    if (open.length > 1) {
      throw new BadRequestException(
        'Há mais de um caixa aberto: informe por qual deles o dinheiro passa.',
      );
    }
    return open[0].cashRegister.financialAccountId;
  }

  async recordDifference(
    tx: Tx,
    tenantId: string,
    userId: string,
    input: DifferenceInput,
  ): Promise<DifferenceOutcome> {
    const empty: DifferenceOutcome = {
      receivableId: null,
      payableId: null,
      abatedAmount: 0,
      refundAmount: 0,
      settled: false,
    };
    const diff = input.difference;
    if (diff === 0) return empty;

    const metadata = { kind: 'ORDER_ADJUSTMENT', orderId: input.orderId, adjustmentId: input.adjustmentId };
    const label = input.label;

    if (diff > 0) {
      const receivable = await tx.accountsReceivable.create({
        data: {
          tenantId,
          orderId: input.orderId,
          customerId: input.customerId,
          description: `Diferença de ${label} - ${input.orderNumber}`,
          amount: diff,
          status: 'PENDING',
          dueDate: civilDaysFrom(new Date(), 0),
          paymentMethodId: input.settlement?.paymentMethodId ?? null,
          metadata,
        },
        select: { id: true },
      });
      const settled = await this.settle(tx, tenantId, userId, input.settlement, receivable.id, 'RECEIVABLE');
      return { ...empty, receivableId: receivable.id, settled };
    }

    const owed = -diff;
    const abatedAmount = await this.abateOpenReceivables(tx, tenantId, input.orderId, owed);
    const refundAmount = subtractMoney(owed, abatedAmount);
    if (refundAmount <= 0) return { ...empty, abatedAmount };

    const payable = await tx.accountsPayable.create({
      data: {
        tenantId,
        description: `Reembolso de ${label} - ${input.orderNumber}`,
        amount: refundAmount,
        status: 'PENDING',
        dueDate: civilDaysFrom(new Date(), 0),
        paymentMethodId: input.settlement?.paymentMethodId ?? null,
        metadata: { ...metadata, customerId: input.customerId },
      },
      select: { id: true },
    });
    const settled = await this.settle(tx, tenantId, userId, input.settlement, payable.id, 'PAYABLE');
    return { ...empty, payableId: payable.id, abatedAmount, refundAmount, settled };
  }

  /**
   * Quem ainda não pagou não recebe reembolso: o valor devolvido reduz primeiro
   * o que o cliente deve neste pedido (das últimas parcelas para as primeiras).
   * Só o que exceder vira título a pagar.
   */
  private async abateOpenReceivables(
    tx: Tx,
    tenantId: string,
    orderId: string,
    owed: number,
  ): Promise<number> {
    const open = await tx.accountsReceivable.findMany({
      where: { tenantId, orderId, status: { in: [...OPEN_RECEIVABLE_STATUSES] }, deletedAt: null },
      orderBy: { dueDate: 'desc' },
      select: { id: true, amount: true, paidAmount: true, status: true },
    });

    let remaining = owed;
    let abated = 0;
    for (const receivable of open) {
      if (remaining <= 0) break;
      const outstanding = subtractMoney(receivable.amount, receivable.paidAmount);
      if (outstanding <= 0) continue;

      const cut = Math.min(outstanding, remaining);
      const newAmount = subtractMoney(receivable.amount, cut);
      const paid = toMoney(receivable.paidAmount);

      const data =
        newAmount > paid
          ? { amount: newAmount }
          : paid > 0
            ? { amount: newAmount, status: 'PAID' as const, paidAt: new Date() }
            : { status: 'CANCELLED' as const };
      await tx.accountsReceivable.update({ where: { id: receivable.id }, data });

      remaining = subtractMoney(remaining, cut);
      abated = sumMoney([abated, cut]);
    }
    return abated;
  }

  private async settle(
    tx: Tx,
    tenantId: string,
    userId: string,
    settlement: SettlementPlan | null,
    titleId: string,
    kind: 'RECEIVABLE' | 'PAYABLE',
  ): Promise<boolean> {
    const accountId = settlement?.accountId;
    if (!accountId) return false;
    await this.settlements.settleWithin(tx, tenantId, titleId, { kind, accountId }, userId);
    return true;
  }
}
