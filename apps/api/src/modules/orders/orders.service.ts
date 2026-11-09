import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, OrderStatus } from '@prisma/client';
import { canAdjustOrderItems, getAllowedTransitions } from '@erp/constants';
import { toDateRange } from '../../common/utils/date-range.util';
import {
  calculateItemTotal,
  calculateOrderTotals,
  maxItemDiscount,
  roundMoney,
} from '@erp/validators';
import { PrismaService } from '../../database/prisma/prisma.service';
import { isImmediatePayment } from '../../common/constants/payment.constants';
import {
  CreateOrderDto,
  UpdateOrderStatusDto,
  CancelOrderDto,
  OrderQueryDto,
} from './dto/order.dto';
import {
  PaginatedResponse,
  buildPaginatedResponse,
  buildPrismaOrderBy,
} from '../../common/utils/pagination';
import {
  OrderCreatedEvent,
  OrderConfirmedEvent,
  OrderShippedEvent,
  OrderDeliveredEvent,
  OrderCancelledEvent,
  OrderCounterSaleEvent,
} from '../../events/event-types';
import { formatBRL } from '../../common/utils/money.util';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * List orders with pagination and filters.
   */
  async findAll(
    tenantId: string,
    query: OrderQueryDto,
  ): Promise<PaginatedResponse<any>> {
    const {
      page = 1,
      limit = 20,
      search,
      sortBy,
      sortOrder = 'desc',
      status,
      origin,
      customerId,
      dateFrom,
      dateTo,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (status) where.status = status as any;
    if (origin) where.origin = origin as any;
    if (customerId) where.customerId = customerId;

    // VD-09: `lte: new Date(dateTo)` is midnight *starting* the final day, so
    // filtering "today" returned nothing — every order of the day is after it.
    const createdAt = toDateRange(dateFrom, dateTo);
    if (createdAt) where.createdAt = createdAt;

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: buildPrismaOrderBy(sortBy, sortOrder),
        include: {
          customer: { select: { id: true, name: true, email: true } },
          seller: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    // Same reason as in findOne: the list's quick actions render from this.
    const rows = data.map((order) => ({
      ...order,
      allowedTransitions: this.allowedTransitionsFor(order),
      // AE-14: o dashboard lê `customerName` plano; a API só devolvia
      // `customer.name` aninhado, e a coluna CLIENTE ficava vazia com o nome
      // ali do lado no banco.
      customerName: order.customer?.name ?? null,
    }));

    return buildPaginatedResponse(rows, total, { page, limit, sortBy, sortOrder });
  }

  /**
   * Get order detail with items, customer, and status history.
   */
  async findOne(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        customer: true,
        seller: { select: { id: true, name: true, email: true } },
        salesChannel: { select: { id: true, name: true, type: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            variant: { select: { id: true, name: true, sku: true } },
          },
        },
        payments: {
          include: {
            paymentMethod: { select: { id: true, name: true, type: true } },
            paymentCondition: { select: { id: true, name: true, code: true } },
            financialAccount: { select: { id: true, name: true } },
          },
        },
        receivables: {
          orderBy: { dueDate: 'asc' },
          select: {
            id: true,
            description: true,
            installment: true,
            totalInstallments: true,
            amount: true,
            paidAmount: true,
            status: true,
            dueDate: true,
            paidAt: true,
            paymentMethod: { select: { name: true } },
          },
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
        adjustments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            quantity: true,
            returnedName: true,
            returnedSku: true,
            returnedValue: true,
            newName: true,
            newSku: true,
            newValue: true,
            difference: true,
            abatedAmount: true,
            receivableId: true,
            payableId: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado');
    }

    // `changedBy` is a bare userId with no relation, so the timeline would show
    // an opaque cuid without this lookup (VD-06).
    const changedByIds = [
      ...new Set(
        order.statusHistory
          .map((entry) => entry.changedBy)
          .filter((userId): userId is string => Boolean(userId)),
      ),
    ];
    const changedByUsers = changedByIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: changedByIds }, tenantId },
          select: { id: true, name: true },
        })
      : [];
    const userNameById = new Map(changedByUsers.map((u) => [u.id, u.name]));

    // The UI renders its status buttons from allowedTransitions. Keeping the
    // state machine on the server is what stops front and back from drifting
    // apart (VD-02: the UI offered PICKING -> SHIPPED, always rejected by the API).
    return {
      ...order,
      allowedTransitions: this.allowedTransitionsFor(order),
      canAdjustItems: canAdjustOrderItems(order.status as never),
      statusHistory: order.statusHistory.map((entry) => ({
        ...entry,
        changedByName: entry.changedBy
          ? userNameById.get(entry.changedBy) ?? null
          : null,
      })),
    };
  }

  /**
   * Actions the UI may offer for an order.
   *
   * It is the state machine plus one exception: a counter sale is born
   * COMPLETED, which is terminal, and reversing it (VD-14) is the only thing
   * left to do with it. `RETURNED` here is served by `POST /orders/:id/reverse`,
   * not by `PATCH /status` — the transition itself stays invalid.
   */
  private allowedTransitionsFor(order: {
    status: string;
    origin: string;
  }): string[] {
    const transitions = getAllowedTransitions(order.status as never);
    if (order.origin === 'BALCAO' && order.status === 'COMPLETED') {
      return [...transitions, 'RETURNED'];
    }
    return transitions;
  }

  /**
   * Create a new order: validate items, calculate totals, reserve stock.
   */
  async create(tenantId: string, userId: string, dto: CreateOrderDto) {
    // Validate all products exist and belong to tenant
    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId, deletedAt: null },
      select: { id: true, sku: true, name: true, salePrice: true },
    });

    if (products.length !== new Set(productIds).size) {
      const foundIds = new Set(products.map((p) => p.id));
      const missing = productIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`Produtos não encontrados: ${missing.join(', ')}`);
    }

    const productMap = new Map(products.map((p) => [p.id, p]));

    // Generate sequential order number
    const orderNumber = await this.generateOrderNumber(tenantId);

    // VD-10: the cart limits the discount to the line value in its zod schema,
    // but the API only ran `calculateItemTotal`, which **clamps** the result at
    // zero. A discount of R$ 80 on a R$ 50 line was therefore accepted and
    // stored as a completed sale of R$ 0,00 — the screen validated, the
    // database did not. The rule belongs here too.
    for (const item of dto.items) {
      const discount = roundMoney(item.discount ?? 0);
      if (discount <= 0) continue;

      const maximum = maxItemDiscount(item);
      if (discount > maximum) {
        const product = productMap.get(item.productId)!;
        throw new BadRequestException(
          `O desconto de ${formatBRL(discount)} em ${product.name} (${product.sku}) passa do valor da linha: máximo ${formatBRL(maximum)}.`,
        );
      }
    }

    // VD-10: same arithmetic the cart runs, from @erp/validators — two
    // implementations of it is what made the screen total and the stored total
    // disagree.
    const itemsData = dto.items.map((item) => {
      const product = productMap.get(item.productId)!;

      return {
        productId: item.productId,
        variantId: item.variantId,
        sku: product.sku,
        name: product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: roundMoney(item.discount ?? 0),
        totalPrice: calculateItemTotal(item),
      };
    });

    const {
      subtotal,
      discount: orderDiscount,
      shippingCost,
      total: totalAmount,
    } = calculateOrderTotals({
      items: dto.items,
      discount: dto.discount,
      shippingCost: dto.shippingCost,
    });

    // Same reasoning as the per-item check: `calculateOrderTotals` caps the
    // order discount at the subtotal, so an excessive one was accepted and
    // quietly reduced instead of refused.
    const requestedDiscount = roundMoney(dto.discount ?? 0);
    if (requestedDiscount > subtotal) {
      throw new BadRequestException(
        `O desconto de ${formatBRL(requestedDiscount)} passa do subtotal do pedido (${formatBRL(subtotal)}).`,
      );
    }

    const isCounterSale = dto.origin === 'BALCAO';

    // A sale must be registered with an open cash register — both the counter
    // sale (BALCAO) and the order-based sale (MANUAL / venda por pedido). The
    // rule is enforced at creation. Marketplace/API origins are external
    // integrations and are exempt.
    const resolvedOrigin = dto.origin ?? 'MANUAL';
    const requiresOpenCashRegister =
      resolvedOrigin === 'BALCAO' || resolvedOrigin === 'MANUAL';

    // FN-05: a loja pode ter dois PDVs abertos ao mesmo tempo — isso é
    // legítimo. O que não pode é o sistema escolher por conta própria: pegar a
    // primeira sessão aberta carimbava a venda no caixa errado e quebrava o
    // fechamento dos dois. Com mais de um caixa aberto, quem vende diz qual.
    let openCashRegisterSessionId: string | null = null;
    if (requiresOpenCashRegister) {
      const openSessions = await this.prisma.cashRegisterSession.findMany({
        where: { tenantId, status: 'OPEN' },
        select: { id: true },
      });

      if (openSessions.length === 0) {
        throw new ConflictException(
          isCounterSale
            ? 'Não é possível registrar venda no balcão sem um caixa aberto. Abra o caixa para continuar.'
            : 'Não é possível registrar a venda sem um caixa aberto. Abra o caixa para continuar.',
        );
      }

      if (dto.cashRegisterSessionId) {
        const chosen = openSessions.find(
          (session) => session.id === dto.cashRegisterSessionId,
        );
        if (!chosen) {
          throw new ConflictException(
            'O caixa informado não está aberto. Selecione um caixa aberto para registrar a venda.',
          );
        }
        openCashRegisterSessionId = chosen.id;
      } else if (openSessions.length > 1) {
        throw new ConflictException(
          'Há mais de um caixa aberto: informe em qual deles a venda deve ser registrada.',
        );
      } else {
        openCashRegisterSessionId = openSessions[0].id;
      }
    }

    // Counter sales require a customer
    if (isCounterSale && !dto.customerId) {
      throw new BadRequestException('Cliente é obrigatório para vendas no balcão');
    }

    // For counter sales, validate stock upfront (sale is immediate)
    if (isCounterSale) {
      await this.validateStockForConfirmation(tenantId, itemsData);
    }

    // Validate payments if provided
    const finalTotal = Math.max(totalAmount, 0);
    const payments = dto.payments ?? [];

    if (payments.length > 0) {
      const paymentSum = payments.reduce((sum, p) => sum + p.amount, 0);
      if (Math.abs(paymentSum - finalTotal) > 0.01) {
        throw new BadRequestException(
          `A soma dos pagamentos (${formatBRL(paymentSum)}) difere do total do pedido (${formatBRL(finalTotal)})`,
        );
      }

      // Validate payment methods exist and belong to tenant
      const methodIds = payments.map((p) => p.paymentMethodId);
      const methods = await this.prisma.paymentMethod.findMany({
        where: { id: { in: methodIds }, tenantId },
        select: {
          id: true,
          name: true,
          type: true,
          requiresAuthorization: true,
          defaultAccountId: true,
        },
      });

      const methodMap = new Map(methods.map((m) => [m.id, m]));
      for (const payment of payments) {
        const method = methodMap.get(payment.paymentMethodId);
        if (!method) {
          throw new BadRequestException(
            `Forma de pagamento ${payment.paymentMethodId} não encontrada`,
          );
        }
        if (method.requiresAuthorization && !payment.authorizationCode) {
          throw new BadRequestException(
            'Código de autorização é obrigatório para pagamentos com cartão',
          );
        }
        // Resolve financialAccountId from method default if not provided
        if (!payment.financialAccountId && method.defaultAccountId) {
          payment.financialAccountId = method.defaultAccountId;
        }
        // An immediate payment credits a bank account as soon as the sale is
        // registered — without a linked account the money would vanish, so the
        // sale is refused instead of silently skipping the credit.
        if (isImmediatePayment(method.type) && !payment.financialAccountId) {
          throw new BadRequestException(
            `A forma de pagamento "${method.name}" não possui conta financeira vinculada. ` +
              'Vincule uma conta em Configurações > Métodos de Pagamento para registrar a venda.',
          );
        }
      }

      // Validate payment conditions if provided
      const conditionIds = payments
        .filter((p) => p.paymentConditionId)
        .map((p) => p.paymentConditionId!);
      if (conditionIds.length > 0) {
        const conditions = await this.prisma.paymentCondition.findMany({
          where: { id: { in: conditionIds }, tenantId },
          select: { id: true, installments: true },
        });
        const conditionMap = new Map(conditions.map((c) => [c.id, c]));
        for (const payment of payments) {
          if (payment.paymentConditionId && !conditionMap.has(payment.paymentConditionId)) {
            throw new BadRequestException(
              `Condição de pagamento ${payment.paymentConditionId} não encontrada`,
            );
          }
          // VD-05: the number of installments belongs to the condition, not to
          // the client. The old code only filled it in when the field was
          // absent, and the PDV always sent `installments: 1` — so "3x sem
          // juros" generated a single receivable for the whole amount.
          if (payment.paymentConditionId) {
            const cond = conditionMap.get(payment.paymentConditionId);
            if (cond) payment.installments = cond.installments;
          }
        }
      }
    }

    // Create order in a transaction
    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          tenantId,
          orderNumber,
          status: isCounterSale ? 'COMPLETED' : 'PENDING',
          origin: (dto.origin as any) || 'MANUAL',
          // Both in-store sales settle on the spot, so both are linked to the
          // open session: cash paid on either one lands in the drawer and must
          // show up in its expected balance. External origins stay unlinked.
          cashRegisterSessionId: openCashRegisterSessionId,
          customerId: dto.customerId || null,
          salesChannelId: dto.salesChannelId,
          sellerId: dto.sellerId ?? userId,
          subtotal,
          discount: orderDiscount,
          shippingCost: isCounterSale ? 0 : shippingCost,
          totalAmount: finalTotal,
          shippingMethod: isCounterSale ? null : dto.shippingMethod,
          shippingAddress: isCounterSale ? undefined : (dto.shippingAddress as any),
          notes: dto.notes,
          internalNotes: dto.internalNotes,
          items: {
            create: itemsData,
          },
          statusHistory: {
            create: {
              fromStatus: null,
              toStatus: isCounterSale ? 'COMPLETED' : 'PENDING',
              // O histórico do pedido é lido pelo usuário: nasce em pt-BR.
              notes: isCounterSale ? 'Venda no balcão' : 'Pedido criado',
              changedBy: userId,
            },
          },
        },
        include: {
          items: true,
          customer: { select: { id: true, name: true } },
          statusHistory: true,
        },
      });

      // Create OrderPayment records
      if (payments.length > 0) {
        await tx.orderPayment.createMany({
          data: payments.map((p) => ({
            tenantId,
            orderId: created.id,
            paymentMethodId: p.paymentMethodId,
            paymentConditionId: p.paymentConditionId || null,
            financialAccountId: p.financialAccountId || null,
            amount: p.amount,
            installments: p.installments ?? 1,
            authorizationCode: p.authorizationCode || null,
          })),
        });
      }

      return created;
    });

    if (isCounterSale) {
      // Counter sale: deduct stock directly and create receivable via event
      this.eventEmitter.emit(
        'order.counter_sale',
        new OrderCounterSaleEvent(
          order.id,
          tenantId,
          userId,
          Number(order.totalAmount),
          order.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
          })),
        ),
      );
      this.logger.log(`Counter sale created: ${order.orderNumber} (${order.id}) for tenant ${tenantId}`);
    } else {
      // Regular order: stock reservation happens on confirmation
      this.eventEmitter.emit(
        'order.created',
        new OrderCreatedEvent(order.id, tenantId, userId, order.items),
      );
      this.logger.log(`Order created: ${order.orderNumber} (${order.id}) for tenant ${tenantId}`);
    }

    return order;
  }

  /**
   * Transition order status with state machine validation.
   */
  async updateStatus(
    tenantId: string,
    id: string,
    userId: string,
    dto: UpdateOrderStatusDto,
  ) {
    // VD-01: cancelling is not a plain column change — it has to release the
    // reserved stock and cancel the receivable. There is exactly one place that
    // does all of it, so any caller asking for CANCELLED is routed there.
    if (dto.status === 'CANCELLED') {
      return this.cancel(tenantId, id, userId, {
        reason: dto.notes?.trim() || 'Cancelado pelo usuário',
      });
    }

    const order = await this.prisma.order.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado');
    }

    const currentStatus = order.status;
    const newStatus = dto.status;

    // Validate transition
    const allowedTransitions = getAllowedTransitions(currentStatus);
    if (!allowedTransitions.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${currentStatus} to ${newStatus}. Allowed: ${allowedTransitions.join(', ') || 'none'}`,
      );
    }

    // Validate sufficient available stock before confirming
    if (newStatus === 'CONFIRMED') {
      await this.validateStockForConfirmation(tenantId, order.items);
    }

    const additionalData: Record<string, unknown> = {};
    if (newStatus === 'SHIPPED') {
      additionalData.shippedAt = new Date();
    }
    if (newStatus === 'DELIVERED') {
      additionalData.deliveredAt = new Date();
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          status: newStatus as OrderStatus,
          ...additionalData,
        },
        include: {
          items: true,
          customer: { select: { id: true, name: true } },
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: currentStatus,
          toStatus: newStatus as OrderStatus,
          notes: dto.notes,
          changedBy: userId,
        },
      });

      return updatedOrder;
    });

    // Emit appropriate events
    if (newStatus === 'CONFIRMED') {
      this.eventEmitter.emit(
        'order.confirmed',
        new OrderConfirmedEvent(
          order.id,
          tenantId,
          userId,
          Number(order.totalAmount),
          order.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
          })),
        ),
      );
    }
    if (newStatus === 'SHIPPED') {
      this.eventEmitter.emit(
        'order.shipped',
        new OrderShippedEvent(
          order.id,
          tenantId,
          userId,
          order.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
          })),
        ),
      );
    }
    if (newStatus === 'DELIVERED') {
      this.eventEmitter.emit(
        'order.delivered',
        new OrderDeliveredEvent(order.id, tenantId),
      );
    }

    this.logger.log(`Order ${order.orderNumber} status: ${currentStatus} -> ${newStatus}`);
    return updated;
  }

  /**
   * Cancel an order with reason, release reserved stock.
   */
  async cancel(
    tenantId: string,
    id: string,
    userId: string,
    dto: CancelOrderDto,
  ) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado');
    }

    const allowedTransitions = getAllowedTransitions(order.status);
    if (!allowedTransitions.includes('CANCELLED')) {
      throw new BadRequestException(
        `Cannot cancel order in status ${order.status}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: dto.reason,
        },
        include: {
          items: true,
          customer: { select: { id: true, name: true } },
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: order.status,
          toStatus: 'CANCELLED',
          notes: dto.reason,
          changedBy: userId,
        },
      });

      return updatedOrder;
    });

    // Emit cancellation event (stock release happens in event handler, only if was confirmed+)
    this.eventEmitter.emit(
      'order.cancelled',
      new OrderCancelledEvent(order.id, tenantId, userId, order.items, dto.reason, order.status),
    );

    this.logger.log(`Order ${order.orderNumber} cancelled by ${userId}`);
    return updated;
  }

  /**
   * Get order status timeline.
   */
  async getTimeline(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });

    if (!order) {
      throw new NotFoundException('Pedido não encontrado');
    }

    const history = await this.prisma.orderStatusHistory.findMany({
      where: { orderId: id },
      orderBy: { createdAt: 'asc' },
    });

    return history;
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  /**
   * Validate that there is sufficient available stock for all order items.
   */
  private async validateStockForConfirmation(
    tenantId: string,
    items: Array<{ productId: string; variantId?: string | null; quantity: number }>,
  ): Promise<void> {
    const insufficientItems: string[] = [];

    for (const item of items) {
      const inventoryItem = await this.prisma.inventoryItem.findFirst({
        where: {
          tenantId,
          productId: item.productId,
          variantId: item.variantId ?? null,
          available: { gte: item.quantity },
        },
        include: { product: { select: { name: true, sku: true } } },
      });

      if (!inventoryItem) {
        const product = await this.prisma.product.findUnique({
          where: { id: item.productId },
          select: { name: true, sku: true },
        });
        insufficientItems.push(
          `${product?.name ?? item.productId} (${product?.sku ?? 'N/A'}): ${item.quantity} required`,
        );
      }
    }

    if (insufficientItems.length > 0) {
      throw new BadRequestException(
        `Estoque insuficiente para confirmar o pedido: ${insufficientItems.join('; ')}`,
      );
    }
  }

  /**
   * Generate sequential order number per tenant (e.g. PED-000001).
   */
  private async generateOrderNumber(tenantId: string): Promise<string> {
    const lastOrder = await this.prisma.order.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { orderNumber: true },
    });

    let nextNumber = 1;
    if (lastOrder?.orderNumber) {
      const match = lastOrder.orderNumber.match(/(\d+)$/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    return `PED-${nextNumber.toString().padStart(6, '0')}`;
  }
}
