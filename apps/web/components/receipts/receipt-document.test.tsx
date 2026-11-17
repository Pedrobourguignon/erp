import type { ExchangeReceipt, SaleReceipt } from '@erp/shared-types';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { ReceiptDocument } from './receipt-document';

const header = {
  format: 'THERMAL_80' as const,
  footer: 'Trocas em até 30 dias.',
  copy: 1,
  printedAt: '2026-11-17T18:30:00.000Z',
  store: {
    name: 'Loja Exemplo LTDA',
    document: '12.345.678/0001-95',
    phone: '(11) 3456-7890',
    address: 'Rua das Flores, 123 - Centro - São Paulo/SP - CEP 01001-000',
  },
  orderNumber: 'PED-000042',
  customer: { name: 'Maria Souza', document: 'CPF ***.982.247-**' },
};

const sale: SaleReceipt = {
  ...header,
  kind: 'SALE',
  soldAt: '2026-11-17T18:00:00.000Z',
  seller: 'João Vendedor',
  cashRegister: 'Caixa 01',
  items: [
    { name: 'Camiseta', sku: 'CAM-01', quantity: 2, unitPrice: 100, discount: 0, total: 200 },
  ],
  subtotal: 200,
  discount: 10,
  shippingCost: 0,
  total: 190,
  payments: [
    { method: 'Crédito', amount: 100, installments: 3, installmentValues: [33.33, 33.33, 33.34], tendered: null, change: null },
    { method: 'Dinheiro', amount: 90, installments: 1, installmentValues: [90], tendered: 100, change: 10 },
  ],
};

const exchange: ExchangeReceipt = {
  ...header,
  kind: 'EXCHANGE',
  adjustedAt: '2026-11-20T15:00:00.000Z',
  returned: { name: 'Camiseta P', sku: 'CAM-P', quantity: 1, value: 95 },
  received: { name: 'Camiseta M', sku: 'CAM-M', quantity: 1, value: 120 },
  difference: 25,
  abatedAmount: 0,
  reason: 'Tamanho errado',
};

const text = () => document.body.textContent ?? '';

describe('ReceiptDocument — sale', () => {
  it('says it is not a fiscal document', () => {
    render(<ReceiptDocument receipt={sale} />);

    expect(screen.getByText('NÃO É DOCUMENTO FISCAL')).toBeInTheDocument();
  });

  it('prints the store header, the order and who sold it', () => {
    render(<ReceiptDocument receipt={sale} />);

    expect(text()).toContain('Loja Exemplo LTDA');
    expect(text()).toContain('CNPJ 12.345.678/0001-95');
    expect(text()).toContain('Rua das Flores, 123');
    expect(text()).toContain('PED-000042');
    expect(text()).toContain('João Vendedor');
    expect(text()).toContain('Caixa 01');
  });

  it('prints the customer with the masked document', () => {
    render(<ReceiptDocument receipt={sale} />);

    expect(text()).toContain('Maria Souza');
    expect(text()).toContain('CPF ***.982.247-**');
  });

  it('has no customer block on a sale without a customer', () => {
    render(<ReceiptDocument receipt={{ ...sale, customer: null }} />);

    expect(screen.queryByText(/Cliente/)).not.toBeInTheDocument();
  });

  it('prints the items, the discount and the total', () => {
    render(<ReceiptDocument receipt={sale} />);

    expect(text()).toContain('Camiseta');
    expect(text()).toMatch(/2 x R\$\s100,00/);
    expect(text()).toMatch(/Desconto-R\$\s10,00/);
    expect(text()).toMatch(/TOTALR\$\s190,00/);
  });

  it('prints the installments and the change of the cash payment', () => {
    render(<ReceiptDocument receipt={sale} />);

    expect(text()).toMatch(/2x de R\$\s33,33 \+ 1x de R\$\s33,34/);
    expect(text()).toMatch(/RecebidoR\$\s100,00/);
    expect(text()).toMatch(/TrocoR\$\s10,00/);
  });

  it('prints the store footer', () => {
    render(<ReceiptDocument receipt={sale} />);

    expect(text()).toContain('Trocas em até 30 dias.');
  });

  it('marks a reprint', () => {
    render(<ReceiptDocument receipt={{ ...sale, copy: 2 }} />);

    expect(screen.getByText('2ª VIA')).toBeInTheDocument();
  });

  it('does not mark the original', () => {
    render(<ReceiptDocument receipt={sale} />);

    expect(screen.queryByText(/VIA/)).not.toBeInTheDocument();
  });

  // Um nome de 255 caracteres sem espaço não pode vazar do papel de 58 mm.
  it('breaks an unbroken product name instead of overflowing the paper', () => {
    const name = 'X'.repeat(255);
    render(<ReceiptDocument receipt={{ ...sale, format: 'THERMAL_58', items: [{ ...sale.items[0], name }] }} />);

    expect(screen.getByText(name)).toHaveClass('break-all');
  });
});

describe('ReceiptDocument — sale with every item returned', () => {
  it('draws no empty item section', () => {
    const { container } = render(<ReceiptDocument receipt={{ ...sale, items: [] }} />);

    expect(container.querySelector('ul')).toBeNull();
  });
});

describe('ReceiptDocument — exchange', () => {
  it('shows what came back and what the customer took', () => {
    render(<ReceiptDocument receipt={exchange} />);

    expect(screen.getByText('COMPROVANTE DE TROCA')).toBeInTheDocument();
    expect(text()).toContain('Camiseta P');
    expect(text()).toContain('Camiseta M');
    expect(text()).toMatch(/Diferença paga pelo clienteR\$\s25,00/);
    expect(text()).toContain('Tamanho errado');
    expect(text()).toContain('NÃO É DOCUMENTO FISCAL');
  });

  it('shows the refund of a return', () => {
    render(
      <ReceiptDocument
        receipt={{ ...exchange, kind: 'RETURN', received: null, difference: -95 }}
      />
    );

    expect(screen.getByText('COMPROVANTE DE DEVOLUÇÃO')).toBeInTheDocument();
    expect(text()).toMatch(/Devolvido ao clienteR\$\s95,00/);
  });

  it('shows the part taken off what the customer still owed', () => {
    render(
      <ReceiptDocument
        receipt={{ ...exchange, kind: 'RETURN', received: null, difference: -95, abatedAmount: 40 }}
      />
    );

    expect(text()).toMatch(/Abatido de parcelas em abertoR\$\s40,00/);
  });
});
