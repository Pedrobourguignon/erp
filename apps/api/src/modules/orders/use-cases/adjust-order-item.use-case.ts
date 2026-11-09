import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  calculateItemAdjustment,
  type ItemAdjustmentResult,
} from '@erp/validators';
import { canAdjustOrderItems } from '@erp/constants';
import { PrismaService } from '../../../database/prisma/prisma.service';
import {
  formatBRL,
  subtractMoney,
  sumMoney,
  toMoney,
} from '../../../common/utils/money.util';
import { OrderAdjustmentSettlementDto } from '../dto/order-adjustment-settlement.dto';
import { OrderAdjustmentFinance, type SettlementPlan } from './order-adjustment.finance';
import { issueReplacementStock, returnItemToStock } from './order-adjustment.stock';
import { translateOrderStatus } from '../order-status.rules';

type Tx = Prisma.TransactionClient;

export interface AdjustOrderItemCommand {
  orderItemId: string;
  quantity?: number;
  /** Ausente = devolução sem troca. */
  replacement?: { productId: string; variantId?: string | null };
  reason?: string;
  settlement?: OrderAdjustmentSettlementDto;
}

interface LoadedItem {
  id: string;
  productId: string;
  variantId: string | null;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: Prisma.Decimal | number;
  discount: Prisma.Decimal | number;
  totalPrice: Prisma.Decimal | number;
  ncm: string | null;
  cfop: string | null;
}

interface LoadedOrder {
  id: string;
  orderNumber: string;
  status: string;
  customerId: string | null;
  cashRegisterSessionId: string | null;
  discount: Prisma.Decimal | number;
  shippingCost: Prisma.Decimal | number;
  items: LoadedItem[];
}

interface Replacement {
  productId: string;
  variantId: string | null;
  sku: string;
  name: string;
  ncm: string | null;
  unitPrice: number;
  sameProduct: boolean;
  stock: { id: string; warehouseId: string };
}

interface Plan {
  order: LoadedOrder;
  item: LoadedItem;
  quantity: number;
  replacement: Replacement | null;
  math: ItemAdjustmentResult;
  returnWarehouseId: string;
  settlement: SettlementPlan | null;
  reason: string | null;
}

/**
 * Troca ou devolução de parte de um pedido já entregue — o núcleo comum aos
 * endpoints `POST /orders/:id/exchange` e `POST /orders/:id/return-item`.
 *
 * Numa única transação: devolve as unidades ao estoque (e baixa o produto
 * novo), ajusta as linhas e os totais do pedido, registra o `OrderAdjustment`
 * e lança a diferença — título a receber se o cliente paga, abatimento do que
 * ele ainda deve e título a pagar pelo resto se a loja devolve. Com
 * `settlement`, o título é baixado no mesmo ato e, se for dinheiro, a gaveta
 * do caixa acompanha.
 */
@Injectable()
export class AdjustOrderItemUseCase {
  private readonly logger = new Logger(AdjustOrderItemUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: OrderAdjustmentFinance,
  ) {}

  async execute(
    tenantId: string,
    orderId: string,
    userId: string,
    command: AdjustOrderItemCommand,
  ) {
    const plan = await this.plan(tenantId, orderId, command);

    const outcome = await this.prisma.$transaction((tx) =>
      this.apply(tx, tenantId, userId, plan),
    );

    this.logger.log(
      `${plan.replacement ? 'Exchange' : 'Return'} on order ${plan.order.orderNumber}: ` +
        `item ${plan.item.id} x${plan.quantity} (diff ${plan.math.difference}, ` +
        `settled ${outcome.settled}) by ${userId} tenant ${tenantId}`,
    );

    return {
      adjustmentId: outcome.adjustmentId,
      type: plan.replacement ? 'EXCHANGE' : 'RETURN',
      orderId,
      orderItemId: plan.item.id,
      newOrderItemId: outcome.newOrderItemId,
      quantity: plan.quantity,
      returnedValue: plan.math.returnedValue,
      newValue: plan.math.newNetValue,
      difference: plan.math.difference,
      differenceKind:
        plan.math.difference > 0 ? 'RECEIVABLE' : plan.math.difference < 0 ? 'PAYABLE' : 'NONE',
      abatedAmount: outcome.abatedAmount,
      refundAmount: outcome.refundAmount,
      receivableId: outcome.receivableId,
      payableId: outcome.payableId,
      settled: outcome.settled,
      subtotal: plan.math.order.subtotal,
      discount: plan.math.order.discount,
      totalAmount: outcome.totalAmount,
      status: outcome.status,
    };
  }

  // ─── Planejamento (só leituras; tudo que pode recusar, recusa aqui) ─────

  private async plan(
    tenantId: string,
    orderId: string,
    command: AdjustOrderItemCommand,
  ): Promise<Plan> {
    const order = await this.loadOrder(tenantId, orderId);
    const item = order.items.find((i) => i.id === command.orderItemId);
    if (!item) throw new NotFoundException('Item do pedido não encontrado');

    const quantity = command.quantity ?? item.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > item.quantity) {
      throw new BadRequestException(
        `Quantidade inválida para "${item.name}": informe de 1 a ${item.quantity} unidade(s).`,
      );
    }

    const replacement = command.replacement
      ? await this.resolveReplacement(tenantId, item, command.replacement, quantity)
      : null;

    const math = calculateItemAdjustment({
      item: {
        quantity: item.quantity,
        totalPrice: toMoney(item.totalPrice),
        discount: toMoney(item.discount),
      },
      quantity,
      order: {
        subtotal: subtotalOf(order.items),
        discount: toMoney(order.discount),
      },
      replacement: !replacement
        ? null
        : replacement.sameProduct
          ? { keepPrice: true }
          : { unitPrice: replacement.unitPrice },
    });

    const returnWarehouseId = await this.resolveReturnWarehouse(tenantId);
    const settlement =
      command.settlement && math.difference !== 0
        ? await this.finance.planSettlement(tenantId, order, command.settlement)
        : null;

    return {
      order,
      item,
      quantity,
      replacement,
      math,
      returnWarehouseId,
      settlement,
      reason: command.reason?.trim() || null,
    };
  }

  private async loadOrder(tenantId: string, orderId: string): Promise<LoadedOrder> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        customerId: true,
        cashRegisterSessionId: true,
        discount: true,
        shippingCost: true,
        items: {
          select: {
            id: true,
            productId: true,
            variantId: true,
            sku: true,
            name: true,
            quantity: true,
            unitPrice: true,
            discount: true,
            totalPrice: true,
            ncm: true,
            cfop: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Pedido não encontrado');

    // Troca e devolução só fazem sentido sobre mercadoria que já está com o
    // cliente. Antes disso o pedido se edita; depois de cancelado ou devolvido
    // não há o que trocar.
    if (!canAdjustOrderItems(order.status)) {
      throw new BadRequestException(
        `Não é possível trocar ou devolver itens do pedido ${order.orderNumber}: ` +
          `ele está ${translateOrderStatus(order.status).toLowerCase()}. ` +
          'Troca e devolução valem para pedidos entregues ou concluídos.',
      );
    }
    return order;
  }

  private async resolveReplacement(
    tenantId: string,
    item: LoadedItem,
    target: { productId: string; variantId?: string | null },
    quantity: number,
  ): Promise<Replacement> {
    const product = await this.prisma.product.findFirst({
      where: { id: target.productId, tenantId, deletedAt: null },
      select: { id: true, sku: true, name: true, salePrice: true, ncm: true },
    });
    if (!product) throw new NotFoundException('Produto da troca não encontrado');

    const variantId = target.variantId || null;
    const variant = variantId
      ? await this.prisma.productVariant.findFirst({
          where: { id: variantId, productId: product.id },
          select: { id: true, sku: true, name: true, salePrice: true },
        })
      : null;
    if (variantId && !variant) {
      throw new BadRequestException('A variante escolhida não pertence ao produto da troca.');
    }

    if (product.id === item.productId && variantId === item.variantId) {
      throw new BadRequestException(
        `"${item.name}" seria trocado por ele mesmo. Escolha outro tamanho, cor ou produto.`,
      );
    }

    const name = variant?.name ?? product.name;
    const stock = await this.prisma.inventoryItem.findFirst({
      where: { tenantId, productId: product.id, variantId, available: { gte: quantity } },
      orderBy: { warehouse: { isDefault: 'desc' } },
      select: { id: true, warehouseId: true },
    });
    if (!stock) {
      throw new BadRequestException(
        `Estoque insuficiente de "${name}" para a troca: nenhum depósito tem ${quantity} unidade(s) disponível(is).`,
      );
    }

    return {
      productId: product.id,
      variantId,
      sku: variant?.sku ?? product.sku,
      name,
      ncm: product.ncm ?? null,
      unitPrice: toMoney(variant?.salePrice ?? product.salePrice),
      sameProduct: product.id === item.productId,
      stock,
    };
  }

  private async resolveReturnWarehouse(tenantId: string): Promise<string> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { tenantId, isActive: true },
      orderBy: { isDefault: 'desc' },
      select: { id: true },
    });
    if (!warehouse) {
      throw new BadRequestException(
        'Nenhum depósito ativo para receber o item devolvido. Cadastre ou ative um depósito.',
      );
    }
    return warehouse.id;
  }

  // ─── Execução (dentro da transação) ─────────────────────────────────────

  private async apply(tx: Tx, tenantId: string, userId: string, plan: Plan) {
    const { order, item, quantity, replacement, math } = plan;
    const reference = replacement ? 'order_exchange' : 'order_return';

    if (replacement) {
      await issueReplacementStock(tx, tenantId, order.id, userId, replacement, quantity);
    }
    await returnItemToStock(tx, tenantId, order.id, userId, item, quantity, plan.returnWarehouseId, reference);

    if (math.remainingItem.quantity === 0) {
      await tx.orderItem.delete({ where: { id: item.id } });
    } else {
      await tx.orderItem.update({ where: { id: item.id }, data: math.remainingItem });
    }

    const newOrderItemId = replacement
      ? await this.createReplacementLine(tx, order.id, item, replacement, quantity, math)
      : null;

    const { totalAmount, status } = await this.updateOrder(tx, plan, userId, newOrderItemId);

    const adjustment = await tx.orderAdjustment.create({
      data: this.adjustmentData(tenantId, userId, plan, newOrderItemId),
      select: { id: true },
    });

    const finance = await this.finance.recordDifference(tx, tenantId, userId, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      adjustmentId: adjustment.id,
      difference: math.difference,
      label: replacement ? 'troca' : 'devolução',
      settlement: plan.settlement,
    });
    if (finance.receivableId || finance.payableId || finance.abatedAmount > 0) {
      await tx.orderAdjustment.update({
        where: { id: adjustment.id },
        data: {
          receivableId: finance.receivableId,
          payableId: finance.payableId,
          abatedAmount: finance.abatedAmount,
        },
      });
    }

    return { adjustmentId: adjustment.id, newOrderItemId, totalAmount, status, ...finance };
  }

  private async createReplacementLine(
    tx: Tx,
    orderId: string,
    item: LoadedItem,
    replacement: Replacement,
    quantity: number,
    math: ItemAdjustmentResult,
  ): Promise<string> {
    // Troca de tamanho herda o preço que o cliente pagou; produto diferente
    // entra pelo preço de tabela de hoje.
    const unitPrice = replacement.sameProduct ? toMoney(item.unitPrice) : replacement.unitPrice;
    const line = await tx.orderItem.create({
      data: {
        orderId,
        productId: replacement.productId,
        variantId: replacement.variantId,
        sku: replacement.sku,
        name: replacement.name,
        quantity,
        unitPrice,
        discount: math.newItemDiscount,
        totalPrice: math.newValue,
        ncm: replacement.ncm ?? item.ncm,
        cfop: item.cfop,
        metadata: { exchangedFromItemId: item.id },
      },
      select: { id: true },
    });
    return line.id;
  }

  private async updateOrder(tx: Tx, plan: Plan, userId: string, newOrderItemId: string | null) {
    const { order, item, math } = plan;
    const totalAmount = sumMoney([
      subtractMoney(math.order.subtotal, math.order.discount),
      order.shippingCost,
    ]);
    const nothingLeft =
      !newOrderItemId &&
      math.remainingItem.quantity === 0 &&
      order.items.every((i) => i.id === item.id);
    const status = nothingLeft ? 'RETURNED' : order.status;

    await tx.order.update({
      where: { id: order.id },
      data: {
        subtotal: math.order.subtotal,
        discount: math.order.discount,
        totalAmount,
        ...(nothingLeft ? { status: 'RETURNED' as const } : {}),
      },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status as never,
        toStatus: status as never,
        changedBy: userId,
        notes: this.historyNote(plan),
      },
    });

    return { totalAmount, status };
  }

  private historyNote(plan: Plan): string {
    const { item, quantity, replacement, math, reason } = plan;
    const diff = math.difference;
    const money =
      diff > 0
        ? `cliente paga ${formatBRL(diff)}`
        : diff < 0
          ? `loja devolve ${formatBRL(-diff)}`
          : 'sem diferença';
    const what = replacement
      ? `Troca: ${quantity}x ${item.name} → ${replacement.name}`
      : `Devolução: ${quantity}x ${item.name}`;
    return [`${what} (${money})`, reason].filter(Boolean).join(' — ').slice(0, 1000);
  }

  private adjustmentData(
    tenantId: string,
    userId: string,
    plan: Plan,
    newOrderItemId: string | null,
  ): Prisma.OrderAdjustmentUncheckedCreateInput {
    const { order, item, quantity, replacement, math } = plan;
    return {
      tenantId,
      orderId: order.id,
      type: replacement ? 'EXCHANGE' : 'RETURN',
      quantity,
      orderItemId: item.id,
      returnedProductId: item.productId,
      returnedVariantId: item.variantId,
      returnedSku: item.sku,
      returnedName: item.name,
      returnedGross: math.returnedGross,
      discountShare: math.discountShare,
      returnedValue: math.returnedValue,
      newOrderItemId,
      newProductId: replacement?.productId ?? null,
      newVariantId: replacement?.variantId ?? null,
      newSku: replacement?.sku ?? null,
      newName: replacement?.name ?? null,
      newUnitPrice: replacement
        ? replacement.sameProduct
          ? toMoney(item.unitPrice)
          : replacement.unitPrice
        : null,
      newValue: math.newValue,
      difference: math.difference,
      reason: plan.reason,
      createdById: userId,
    };
  }
}

function subtotalOf(items: { totalPrice: Prisma.Decimal | number }[]): number {
  return sumMoney(items.map((i) => i.totalPrice));
}
