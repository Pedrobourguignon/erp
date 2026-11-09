import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canTransition } from '@erp/constants';
import { roundMoney } from '@erp/validators';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { ReverseSaleDto } from '../dto/reverse-sale.dto';
import { translateOrderStatus } from '../order-status.rules';

type Tx = Prisma.TransactionClient;

interface OrderItemToReturn {
  productId: string;
  variantId: string | null;
  quantity: number;
}

/**
 * VD-14: reversal of a finished sale.
 *
 * A counter sale is born COMPLETED and the detail screen offered no action at
 * all — a wrong sale at the PDV could not be undone through the application,
 * and `DELIVERED → RETURNED` existed in the API with no button. Both cases are
 * the same operation: give the goods back to stock, undo the money and leave a
 * trace of who did it and why.
 */
@Injectable()
export class ReverseSaleUseCase {
  private readonly logger = new Logger(ReverseSaleUseCase.name);

  constructor(private readonly prisma: PrismaService) {}

  async execute(
    tenantId: string,
    orderId: string,
    userId: string,
    dto: ReverseSaleDto,
  ) {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('Informe o motivo do estorno.');
    }

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException('Pedido não encontrado');
    }

    this.assertReversible(order);
    await this.assertCashSessionStillOpen(tenantId, order);

    // O estorno registra a obrigação e para por aí. Quem move dinheiro é a
    // baixa do título em /financeiro/lancamentos, onde o operador escolhe de
    // qual conta ele sai — e é lá que a gaveta é debitada, se a conta escolhida
    // for a de um caixa aberto. Tirar da gaveta aqui adiantava um pagamento que
    // ainda não foi decidido: uma venda no PIX (que entrou no Santander) saía do
    // caixa e o deixava em −R$ 299,90.

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { isDefault: 'desc' },
      select: { id: true },
    });
    if (!warehouse) {
      throw new BadRequestException(
        'Nenhum depósito ativo para registrar a devolução do estoque.',
      );
    }

    // Everything the customer actually paid comes back as an obligation to them.
    const settled = await this.prisma.accountsReceivable.findMany({
      where: { orderId, tenantId, status: { in: ['PAID', 'PARTIALLY_PAID'] } },
      select: { id: true, paidAmount: true },
    });
    const refundedAmount = roundMoney(
      settled.reduce((sum, r) => sum + Number(r.paidAmount ?? 0), 0),
    );

    const result = await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        await this.returnItemToStock(
          tx,
          tenantId,
          orderId,
          userId,
          item,
          warehouse.id,
        );
      }

      await tx.accountsReceivable.updateMany({
        where: {
          orderId,
          tenantId,
          status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
        data: { status: 'CANCELLED' },
      });

      // The fee the acquirer would have charged on this sale is no longer owed.
      // A fee already paid stays: it was a real cost, and the reversal does not
      // give it back.
      await tx.accountsPayable.updateMany({
        where: {
          tenantId,
          status: { in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] },
          AND: [
            { metadata: { path: ['kind'], equals: 'PAYMENT_FEE' } },
            { metadata: { path: ['orderId'], equals: orderId } },
          ],
        },
        data: { status: 'CANCELLED' },
      });

      let payableId: string | null = null;
      if (refundedAmount > 0) {
        const payable = await tx.accountsPayable.create({
          data: {
            tenantId,
            description: `Estorno de venda - ${order.orderNumber}`,
            amount: refundedAmount,
            status: 'PENDING',
            dueDate: new Date(),
            metadata: { reversal: true, orderId, reason },
          },
          select: { id: true },
        });
        payableId = payable.id;

      }



      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: 'RETURNED', cancelReason: reason },
        select: { id: true, status: true, orderNumber: true },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: 'RETURNED',
          changedBy: userId,
          notes: `Estorno: ${reason}`,
        },
      });

      return { updated, payableId };
    });

    this.logger.log(
      `Order ${order.orderNumber} reversed by ${userId} (refund ${refundedAmount}) for tenant ${tenantId}`,
    );

    return {
      orderId,
      status: result.updated.status,
      returnedItems: order.items.length,
      refundedAmount,
      payableId: result.payableId,
    };
  }

  /**
   * A sale can be reversed when the state machine allows `RETURNED`, plus the
   * counter-sale case: those are born COMPLETED, which is terminal for every
   * other purpose.
   */
  private assertReversible(order: { status: string; origin: string }): void {
    const isCounterSale = order.origin === 'BALCAO' && order.status === 'COMPLETED';
    if (isCounterSale || canTransition(order.status as never, 'RETURNED')) return;

    throw new BadRequestException(
      `Não é possível estornar um pedido ${translateOrderStatus(
        order.status,
      ).toLowerCase()}.`,
    );
  }

  /**
   * Time policy: a counter sale is only reversible while the cash session that
   * registered it is still open. After the closing count, the reversal has to
   * go through the financial module so the closed session stays balanced.
   */
  private async assertCashSessionStillOpen(
    tenantId: string,
    order: { cashRegisterSessionId: string | null; orderNumber: string },
  ): Promise<void> {
    if (!order.cashRegisterSessionId) return;

    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { id: order.cashRegisterSessionId, tenantId },
      select: { id: true, status: true },
    });

    if (session && session.status !== 'OPEN') {
      throw new BadRequestException(
        `O caixa da venda ${order.orderNumber} já foi fechado. ` +
          'Registre a devolução pelo módulo financeiro.',
      );
    }
  }

  private async returnItemToStock(
    tx: Tx,
    tenantId: string,
    orderId: string,
    userId: string,
    item: OrderItemToReturn,
    warehouseId: string,
  ): Promise<void> {
    const existing = await tx.inventoryItem.findFirst({
      where: {
        tenantId,
        productId: item.productId,
        variantId: item.variantId ?? null,
        warehouseId,
      },
      select: { id: true },
    });

    if (existing) {
      await tx.inventoryItem.update({
        where: { id: existing.id },
        data: {
          quantity: { increment: item.quantity },
          available: { increment: item.quantity },
        },
      });
    } else {
      await tx.inventoryItem.create({
        data: {
          tenantId,
          productId: item.productId,
          variantId: item.variantId ?? null,
          warehouseId,
          quantity: item.quantity,
          available: item.quantity,
          reserved: 0,
        },
      });
    }

    await tx.inventoryMovement.create({
      data: {
        tenantId,
        productId: item.productId,
        variantId: item.variantId ?? null,
        type: 'RETURN',
        reason: 'RETURN_CUSTOMER',
        quantity: item.quantity,
        toWarehouseId: warehouseId,
        referenceType: 'order_reversal',
        referenceId: orderId,
        notes: 'Estorno de venda - retorno ao estoque',
        userId,
      },
    });
  }
}
