import type {
  ExchangeReceipt,
  ReceiptCustomer,
  ReceiptFormat,
  ReceiptHeader,
  SaleReceipt,
} from '@erp/shared-types';
import { formatDocument, onlyDigits, splitInstallments } from '@erp/validators';
import { subtractMoney, toMoney, type MoneyLike } from '../../../common/utils/money.util';

/**
 * The customer receipt (not a fiscal document), built from data already read.
 *
 * Pure on purpose: what goes on paper — the masked CPF, the change, the split
 * of the installments — is decided here and tested without a database.
 */

export interface ReceiptStoreData {
  name: string;
  document: string;
  phone: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressNeighborhood: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZipCode: string | null;
  receiptFormat: ReceiptFormat;
  receiptFooter: string | null;
}

export interface ReceiptContext {
  /** 1 = original; 2 onwards = reprint. */
  copy: number;
  printedAt: Date;
  store: ReceiptStoreData;
}

export interface ReceiptOrder {
  orderNumber: string;
  createdAt: Date;
  subtotal: MoneyLike;
  discount: MoneyLike;
  shippingCost: MoneyLike;
  totalAmount: MoneyLike;
  customer: { name: string; document: string | null } | null;
  seller: { name: string } | null;
  cashRegisterSession: { cashRegister: { name: string } } | null;
  items: Array<{
    name: string;
    sku: string;
    quantity: number;
    unitPrice: MoneyLike;
    discount: MoneyLike;
    totalPrice: MoneyLike;
  }>;
  payments: Array<{
    paymentMethod: { name: string };
    amount: MoneyLike;
    installments: number;
    amountTendered: MoneyLike | null;
  }>;
}

export interface ReceiptAdjustment {
  type: 'EXCHANGE' | 'RETURN';
  quantity: number;
  createdAt: Date;
  returnedName: string;
  returnedSku: string;
  returnedValue: MoneyLike;
  newName: string | null;
  newSku: string | null;
  newValue: MoneyLike;
  difference: MoneyLike;
  abatedAmount: MoneyLike;
  reason: string | null;
}

/**
 * LGPD: a CPF on paper left on the counter is a personal data leak, so only
 * the middle digits survive. A CNPJ is public company data and prints in full.
 */
export function receiptCustomerDocument(document: string | null | undefined): string | null {
  const digits = onlyDigits(document);
  if (digits.length === 11) {
    return `CPF ***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  }
  if (digits.length === 14) {
    return `CNPJ ${formatDocument(digits)}`;
  }
  return null;
}

export function formatStoreAddress(store: ReceiptStoreData): string | null {
  if (!store.addressStreet) {return null;}
  const street = [store.addressStreet, store.addressNumber, store.addressComplement]
    .filter(Boolean)
    .join(', ');
  const city = [store.addressCity, store.addressState].filter(Boolean).join('/');
  const zip = onlyDigits(store.addressZipCode);
  return [
    street,
    store.addressNeighborhood,
    city,
    zip.length === 8 ? `CEP ${zip.slice(0, 5)}-${zip.slice(5)}` : null,
  ]
    .filter(Boolean)
    .join(' - ');
}

function customerOf(order: ReceiptOrder): ReceiptCustomer | null {
  if (!order.customer) {return null;}
  return {
    name: order.customer.name,
    document: receiptCustomerDocument(order.customer.document),
  };
}

function headerOf(order: ReceiptOrder, context: ReceiptContext): ReceiptHeader {
  const { store } = context;
  return {
    format: store.receiptFormat,
    footer: store.receiptFooter,
    copy: context.copy,
    printedAt: context.printedAt.toISOString(),
    store: {
      name: store.name,
      document: formatDocument(store.document),
      phone: store.phone,
      address: formatStoreAddress(store),
    },
    orderNumber: order.orderNumber,
    customer: customerOf(order),
  };
}

export function buildSaleReceipt(order: ReceiptOrder, context: ReceiptContext): SaleReceipt {
  return {
    ...headerOf(order, context),
    kind: 'SALE',
    soldAt: order.createdAt.toISOString(),
    seller: order.seller?.name ?? null,
    cashRegister: order.cashRegisterSession?.cashRegister.name ?? null,
    items: order.items.map((item) => ({
      name: item.name,
      sku: item.sku,
      quantity: item.quantity,
      unitPrice: toMoney(item.unitPrice),
      discount: toMoney(item.discount),
      total: toMoney(item.totalPrice),
    })),
    subtotal: toMoney(order.subtotal),
    discount: toMoney(order.discount),
    shippingCost: toMoney(order.shippingCost),
    total: toMoney(order.totalAmount),
    payments: order.payments.map((payment) => {
      const amount = toMoney(payment.amount);
      const tendered = payment.amountTendered === null ? null : toMoney(payment.amountTendered);
      return {
        method: payment.paymentMethod.name,
        amount,
        installments: payment.installments,
        installmentValues: splitInstallments(amount, payment.installments),
        tendered,
        change: tendered === null ? null : subtractMoney(tendered, amount),
      };
    }),
  };
}

export function buildExchangeReceipt(
  order: ReceiptOrder,
  adjustment: ReceiptAdjustment,
  context: ReceiptContext,
): ExchangeReceipt {
  const isExchange = adjustment.type === 'EXCHANGE' && adjustment.newName !== null;
  return {
    ...headerOf(order, context),
    kind: adjustment.type,
    adjustedAt: adjustment.createdAt.toISOString(),
    returned: {
      name: adjustment.returnedName,
      sku: adjustment.returnedSku,
      quantity: adjustment.quantity,
      value: toMoney(adjustment.returnedValue),
    },
    received: isExchange
      ? {
          name: adjustment.newName as string,
          sku: adjustment.newSku ?? '',
          quantity: adjustment.quantity,
          value: toMoney(adjustment.newValue),
        }
      : null,
    difference: toMoney(adjustment.difference),
    abatedAmount: toMoney(adjustment.abatedAmount),
    reason: adjustment.reason,
  };
}
