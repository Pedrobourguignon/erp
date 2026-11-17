import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ExchangeReceipt, SaleReceipt } from '@erp/shared-types';
import { PrismaService } from '../../../database/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { TenantsService } from '../../tenants/tenants.service';
import {
  buildExchangeReceipt,
  buildSaleReceipt,
  type ReceiptContext,
  type ReceiptStoreData,
} from './receipt-builder';

/** Only what goes on paper: no cost, no internal ids. */
const RECEIPT_ORDER_SELECT = {
  id: true,
  status: true,
  orderNumber: true,
  createdAt: true,
  subtotal: true,
  discount: true,
  shippingCost: true,
  totalAmount: true,
  customer: { select: { name: true, document: true } },
  seller: { select: { name: true } },
  cashRegisterSession: { select: { cashRegister: { select: { name: true } } } },
  items: {
    select: {
      name: true,
      sku: true,
      quantity: true,
      unitPrice: true,
      discount: true,
      totalPrice: true,
    },
    orderBy: { id: 'asc' as const },
  },
  payments: {
    select: {
      paymentMethod: { select: { name: true } },
      amount: true,
      installments: true,
      amountTendered: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
};

const RECEIPT_ADJUSTMENT_SELECT = {
  type: true,
  quantity: true,
  createdAt: true,
  returnedName: true,
  returnedSku: true,
  returnedValue: true,
  newName: true,
  newSku: true,
  newValue: true,
  difference: true,
  abatedAmount: true,
  reason: true,
};

/**
 * Prints the customer receipt (not a fiscal document) of a sale or of an
 * exchange/return. Every print is counted — the second one onwards comes out
 * as "2ª VIA" — and leaves an audit entry with who printed which copy.
 */
@Injectable()
export class OrderReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenants: TenantsService,
  ) {}

  async printSale(tenantId: string, userId: string, orderId: string): Promise<SaleReceipt> {
    const order = await this.findOrder(tenantId, orderId);
    if (order.status === 'CANCELLED') {
      throw new BadRequestException('Pedido cancelado não tem recibo');
    }

    const { receiptPrintCount: copy } = await this.prisma.order.update({
      where: { id: orderId },
      data: { receiptPrintCount: { increment: 1 } },
      select: { receiptPrintCount: true },
    });
    await this.audit.record({
      tenantId,
      userId,
      entity: 'Order',
      entityId: orderId,
      action: 'EXPORT',
      metadata: { document: 'SALE_RECEIPT', copy },
    });

    return buildSaleReceipt(order, await this.context(tenantId, copy));
  }

  async printAdjustment(
    tenantId: string,
    userId: string,
    orderId: string,
    adjustmentId: string,
  ): Promise<ExchangeReceipt> {
    const order = await this.findOrder(tenantId, orderId);
    const adjustment = await this.prisma.orderAdjustment.findFirst({
      where: { id: adjustmentId, orderId, tenantId },
      select: RECEIPT_ADJUSTMENT_SELECT,
    });
    if (!adjustment) {
      throw new NotFoundException('Troca ou devolução não encontrada');
    }

    const { receiptPrintCount: copy } = await this.prisma.orderAdjustment.update({
      where: { id: adjustmentId },
      data: { receiptPrintCount: { increment: 1 } },
      select: { receiptPrintCount: true },
    });
    await this.audit.record({
      tenantId,
      userId,
      entity: 'OrderAdjustment',
      entityId: adjustmentId,
      action: 'EXPORT',
      metadata: { document: 'EXCHANGE_RECEIPT', copy },
    });

    return buildExchangeReceipt(order, adjustment, await this.context(tenantId, copy));
  }

  private async findOrder(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      select: RECEIPT_ORDER_SELECT,
    });
    if (!order) {
      throw new NotFoundException('Pedido não encontrado');
    }
    return order;
  }

  /** The store header, read through the tenants service (it owns that data). */
  private async context(tenantId: string, copy: number): Promise<ReceiptContext> {
    const tenant = await this.tenants.findById(tenantId);
    const store: ReceiptStoreData = {
      name: tenant.name,
      document: tenant.document,
      phone: tenant.phone,
      addressStreet: tenant.addressStreet,
      addressNumber: tenant.addressNumber,
      addressComplement: tenant.addressComplement,
      addressNeighborhood: tenant.addressNeighborhood,
      addressCity: tenant.addressCity,
      addressState: tenant.addressState,
      addressZipCode: tenant.addressZipCode,
      receiptFormat: tenant.receiptFormat,
      receiptFooter: tenant.receiptFooter,
    };
    return { copy, printedAt: new Date(), store };
  }
}
