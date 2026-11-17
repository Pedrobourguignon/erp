import type { SaleReceipt } from '@erp/shared-types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const printSale = vi.fn();
const printAdjustment = vi.fn();
const addToast = vi.fn();
// What was in the frame when the dialog opened (the frame is gone right after).
let printed: { body: string; head: string } | null = null;
const printWindow = vi.fn((w: Window) => {
  printed = { body: w.document.body.textContent ?? '', head: w.document.head.innerHTML };
});

vi.mock('@/hooks/use-receipts', () => ({
  usePrintSaleReceipt: () => ({ mutateAsync: printSale, isPending: false }),
  usePrintAdjustmentReceipt: () => ({ mutateAsync: printAdjustment, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/lib/print-window', () => ({ printWindow: (w: Window) => printWindow(w) }));

import { TooltipProvider } from '@/components/ui/tooltip';

import { PrintReceiptButton } from './print-receipt-button';

const receipt: SaleReceipt = {
  kind: 'SALE',
  format: 'THERMAL_58',
  footer: null,
  copy: 1,
  printedAt: '2026-11-17T18:30:00.000Z',
  store: { name: 'Loja Exemplo LTDA', document: '12.345.678/0001-95', phone: null, address: null },
  orderNumber: 'PED-000042',
  customer: null,
  soldAt: '2026-11-17T18:00:00.000Z',
  seller: null,
  cashRegister: null,
  items: [],
  subtotal: 0,
  discount: 0,
  shippingCost: 0,
  total: 0,
  payments: [],
};

const frame = () =>
  document.querySelector<HTMLIFrameElement>('iframe[title="Recibo para impressão"]');

describe('PrintReceiptButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    printed = null;
    printSale.mockResolvedValue(receipt);
  });

  it('prints nothing until the seller clicks', () => {
    render(<PrintReceiptButton orderId="order-1" />);

    expect(printSale).not.toHaveBeenCalled();
    expect(frame()).toBeNull();
  });

  it('issues the sale receipt and prints it in the store format', async () => {
    render(<PrintReceiptButton orderId="order-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Imprimir recibo/ }));

    await waitFor(() => expect(printWindow).toHaveBeenCalledTimes(1));
    expect(printSale).toHaveBeenCalledWith('order-1');
    expect(printed?.body).toContain('RECIBO DE VENDA');
    // jsdom has no layout: the receipt measures 0 and gets the minimum roll.
    expect(printed?.head).toMatch(/size: 58mm \d+mm/);
  });

  it('removes the frame once the print dialog closes', async () => {
    render(<PrintReceiptButton orderId="order-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Imprimir recibo/ }));

    await waitFor(() => expect(printWindow).toHaveBeenCalled());
    await waitFor(() => expect(frame()).toBeNull());
  });

  it('issues the receipt of an exchange when given one', async () => {
    printAdjustment.mockResolvedValue({ ...receipt, kind: 'EXCHANGE' });
    render(<PrintReceiptButton orderId="order-1" adjustmentId="adj-1" label="Imprimir comprovante" />);
    fireEvent.click(screen.getByRole('button', { name: /Imprimir comprovante/ }));

    await waitFor(() =>
      expect(printAdjustment).toHaveBeenCalledWith({ orderId: 'order-1', adjustmentId: 'adj-1' })
    );
  });

  // Atalho na coluna de ações da tabela de pedidos: só o ícone, mas com nome.
  it('works as an icon-only shortcut with an accessible name', async () => {
    render(
      <TooltipProvider>
        <PrintReceiptButton orderId="order-1" iconOnly />
      </TooltipProvider>
    );

    const button = screen.getByRole('button', { name: 'Imprimir recibo' });
    expect(button).not.toHaveTextContent('Imprimir recibo');
    fireEvent.click(button);

    await waitFor(() => expect(printWindow).toHaveBeenCalledTimes(1));
    expect(printSale).toHaveBeenCalledWith('order-1');
  });

  it('tells why when the receipt cannot be issued', async () => {
    printSale.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: 'Pedido cancelado não tem recibo' } },
    });
    render(<PrintReceiptButton orderId="order-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Imprimir recibo/ }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(expect.any(String), 'error'));
    expect(printWindow).not.toHaveBeenCalled();
  });
});
