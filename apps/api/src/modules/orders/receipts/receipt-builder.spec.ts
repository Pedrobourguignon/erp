import { Prisma } from '@prisma/client';
import {
  buildExchangeReceipt,
  buildSaleReceipt,
  formatStoreAddress,
  receiptCustomerDocument,
  type ReceiptContext,
  type ReceiptOrder,
} from './receipt-builder';

const D = (value: string | number) => new Prisma.Decimal(value);

const context: ReceiptContext = {
  copy: 1,
  printedAt: new Date('2026-11-17T18:30:00.000Z'),
  store: {
    name: 'Loja Exemplo LTDA',
    document: '12345678000195',
    phone: '11987654321',
    addressStreet: 'Rua das Flores',
    addressNumber: '123',
    addressComplement: null,
    addressNeighborhood: 'Centro',
    addressCity: 'São Paulo',
    addressState: 'SP',
    addressZipCode: '01001000',
    receiptFormat: 'THERMAL_80',
    receiptFooter: 'Trocas em até 30 dias.',
  },
};

function makeOrder(overrides: Partial<ReceiptOrder> = {}): ReceiptOrder {
  return {
    orderNumber: 'PED-000042',
    createdAt: new Date('2026-11-17T18:00:00.000Z'),
    subtotal: D('300.00'),
    discount: D('10.00'),
    shippingCost: D('0'),
    totalAmount: D('290.00'),
    customer: { name: 'Maria Souza', document: '52998224725' },
    seller: { name: 'João Vendedor' },
    cashRegisterSession: { cashRegister: { name: 'Caixa 01' } },
    items: [
      { name: 'Camiseta', sku: 'CAM-01', quantity: 2, unitPrice: D('100.00'), discount: D('0'), totalPrice: D('200.00') },
      { name: 'Boné', sku: 'BON-01', quantity: 1, unitPrice: D('100.00'), discount: D('0'), totalPrice: D('100.00') },
    ],
    payments: [
      { paymentMethod: { name: 'Crédito' }, amount: D('100.00'), installments: 3, amountTendered: null },
      { paymentMethod: { name: 'Dinheiro' }, amount: D('190.00'), installments: 1, amountTendered: D('200.00') },
    ],
    ...overrides,
  };
}

describe('receiptCustomerDocument', () => {
  it('masks a CPF, keeping only the middle digits', () => {
    expect(receiptCustomerDocument('52998224725')).toBe('CPF ***.982.247-**');
  });

  it('prints a CNPJ in full: it is company data', () => {
    expect(receiptCustomerDocument('12345678000195')).toBe('CNPJ 12.345.678/0001-95');
  });

  it.each([null, '', '123'])('prints nothing for %p', (document) => {
    expect(receiptCustomerDocument(document)).toBeNull();
  });
});

describe('formatStoreAddress', () => {
  it('joins the address in one line', () => {
    expect(formatStoreAddress(context.store)).toBe(
      'Rua das Flores, 123 - Centro - São Paulo/SP - CEP 01001-000',
    );
  });

  it('separates the complement from the number', () => {
    expect(formatStoreAddress({ ...context.store, addressComplement: 'Sala 42' })).toBe(
      'Rua das Flores, 123, Sala 42 - Centro - São Paulo/SP - CEP 01001-000',
    );
  });

  it('is null when the store never filled the street', () => {
    expect(formatStoreAddress({ ...context.store, addressStreet: null })).toBeNull();
  });
});

describe('buildSaleReceipt', () => {
  it('carries the header the paper needs', () => {
    const receipt = buildSaleReceipt(makeOrder(), context);

    expect(receipt).toMatchObject({
      kind: 'SALE',
      format: 'THERMAL_80',
      footer: 'Trocas em até 30 dias.',
      copy: 1,
      printedAt: '2026-11-17T18:30:00.000Z',
      orderNumber: 'PED-000042',
      soldAt: '2026-11-17T18:00:00.000Z',
      seller: 'João Vendedor',
      cashRegister: 'Caixa 01',
      store: {
        name: 'Loja Exemplo LTDA',
        document: '12.345.678/0001-95',
        phone: '11987654321',
      },
      customer: { name: 'Maria Souza', document: 'CPF ***.982.247-**' },
    });
  });

  it('turns the money into exact numbers', () => {
    const receipt = buildSaleReceipt(makeOrder(), context);

    expect(receipt.subtotal).toBe(300);
    expect(receipt.discount).toBe(10);
    expect(receipt.total).toBe(290);
    expect(receipt.items[0]).toEqual({
      name: 'Camiseta', sku: 'CAM-01', quantity: 2, unitPrice: 100, discount: 0, total: 200,
    });
  });

  it('splits the installments the way the sale did', () => {
    const [credit] = buildSaleReceipt(makeOrder(), context).payments;

    expect(credit).toEqual({
      method: 'Crédito',
      amount: 100,
      installments: 3,
      installmentValues: [33.33, 33.33, 33.34],
      tendered: null,
      change: null,
    });
  });

  it('prints the change of a cash payment', () => {
    const [, cash] = buildSaleReceipt(makeOrder(), context).payments;

    expect(cash.tendered).toBe(200);
    expect(cash.change).toBe(10);
  });

  it('has no customer block for a sale without a customer', () => {
    expect(buildSaleReceipt(makeOrder({ customer: null }), context).customer).toBeNull();
  });

  it('has no document line for a customer registered without one', () => {
    const receipt = buildSaleReceipt(
      makeOrder({ customer: { name: 'Consumidor', document: null } }),
      context,
    );

    expect(receipt.customer).toEqual({ name: 'Consumidor', document: null });
  });

  it('marks a reprint with its copy number', () => {
    expect(buildSaleReceipt(makeOrder(), { ...context, copy: 2 }).copy).toBe(2);
  });

  it('never leaks the full CPF anywhere in the receipt', () => {
    const json = JSON.stringify(buildSaleReceipt(makeOrder(), context));

    expect(json).not.toContain('52998224725');
    expect(json).not.toContain('529.982.247-25');
  });
});

describe('buildExchangeReceipt', () => {
  const adjustment = {
    type: 'EXCHANGE' as const,
    quantity: 1,
    createdAt: new Date('2026-11-20T15:00:00.000Z'),
    returnedName: 'Camiseta P',
    returnedSku: 'CAM-P',
    returnedValue: D('95.00'),
    newName: 'Camiseta M',
    newSku: 'CAM-M',
    newValue: D('120.00'),
    difference: D('25.00'),
    abatedAmount: D('0'),
    reason: 'Tamanho errado',
  };
  const order = makeOrder();

  it('shows what came back, what went out and the difference', () => {
    const receipt = buildExchangeReceipt(order, adjustment, context);

    expect(receipt).toMatchObject({
      kind: 'EXCHANGE',
      orderNumber: 'PED-000042',
      adjustedAt: '2026-11-20T15:00:00.000Z',
      returned: { name: 'Camiseta P', sku: 'CAM-P', quantity: 1, value: 95 },
      received: { name: 'Camiseta M', sku: 'CAM-M', quantity: 1, value: 120 },
      difference: 25,
      abatedAmount: 0,
      reason: 'Tamanho errado',
      customer: { name: 'Maria Souza', document: 'CPF ***.982.247-**' },
    });
  });

  it('has no received item on a plain return', () => {
    const receipt = buildExchangeReceipt(
      order,
      { ...adjustment, type: 'RETURN', newName: null, newSku: null, newValue: D('0'), difference: D('-95.00') },
      context,
    );

    expect(receipt.kind).toBe('RETURN');
    expect(receipt.received).toBeNull();
    expect(receipt.difference).toBe(-95);
  });
});
