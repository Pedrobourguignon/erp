import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { useForm, type Control, type FieldValues, type UseFormSetValue } from 'react-hook-form';
import { describe, it, expect, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import type { PaymentMethod } from '@/hooks/use-payment-methods';

import { PaymentSelector } from './payment-selector';

const debit: PaymentMethod = {
  id: 'pm-debit',
  name: 'Cartão de Débito',
  type: 'DEBIT_CARD',
  defaultAccountId: 'acc-1',
  feePercentage: 0,
  settlementDays: 0,
  autoSettle: false,
  // Flag antiga, ainda gravada no banco.
  requiresAuthorization: true,
  fiscalCode: null,
  maxInstallments: 1,
  isActive: true,
};

const cash: PaymentMethod = {
  ...debit,
  id: 'pm-cash',
  name: 'Dinheiro',
  type: 'CASH',
  requiresAuthorization: false,
};

vi.mock('@/hooks/use-payment-methods', () => ({
  usePaymentMethods: () => ({ data: { data: [debit, cash] }, error: null }),
}));

function Selector({ methodId = debit.id, total = 100 }: { methodId?: string; total?: number }) {
  const { control, setValue } = useForm({
    defaultValues: { payments: [{ paymentMethodId: methodId, amount: 100, methodType: '' }] },
  });
  return (
    <PaymentSelector
      control={control as unknown as Control<FieldValues>}
      setValue={setValue as unknown as UseFormSetValue<FieldValues>}
      totalAmount={total}
    />
  );
}

const renderSelector = (props: { methodId?: string; total?: number } = {}) =>
  render(
    <TooltipProvider>
      <Selector {...props} />
    </TooltipProvider>,
  );

describe('PaymentSelector', () => {
  // "Exige autorização" saiu do cadastro do método; um método que ficou com a
  // flag no banco não pode pedir um código que a venda não exige mais.
  it('does not ask for an authorization code even if the method still has the old flag', () => {
    render(
      <TooltipProvider>
        <Selector />
      </TooltipProvider>,
    );

    expect(screen.getByText('Forma de Pagamento')).toBeInTheDocument();
    expect(screen.queryByText(/autoriza/i)).not.toBeInTheDocument();
  });

  // O vendedor apaga o "R$ 100,00" para digitar o que o cliente entregou. Cada
  // tecla passa por valores abaixo do total, e a linha voltava sozinha para o
  // total: só dava para acrescentar dígitos (R$ 100,00 → R$ 1.000,00).
  describe('typing the amount handed over on a single cash line', () => {
    const received = () => screen.getByLabelText('Valor Recebido') as HTMLInputElement;

    it('keeps a value below the total while the seller is typing', () => {
      renderSelector({ methodId: cash.id });

      fireEvent.change(received(), { target: { value: '15' } });

      expect(received()).toHaveValue('0,15');
    });

    it('accepts any amount above the total typed from scratch', () => {
      renderSelector({ methodId: cash.id });

      fireEvent.change(received(), { target: { value: '' } });
      fireEvent.change(received(), { target: { value: '15000' } });

      expect(received()).toHaveValue('150,00');
    });

    it('still follows the total when the cart changes', () => {
      const { rerender } = renderSelector({ methodId: cash.id, total: 100 });

      rerender(
        <TooltipProvider>
          <Selector methodId={cash.id} total={120} />
        </TooltipProvider>,
      );

      expect(received()).toHaveValue('120,00');
    });

    it('does not pull back an amount handed over above the new total', () => {
      const { rerender } = renderSelector({ methodId: cash.id, total: 100 });
      fireEvent.change(received(), { target: { value: '50000' } });

      rerender(
        <TooltipProvider>
          <Selector methodId={cash.id} total={120} />
        </TooltipProvider>,
      );

      expect(received()).toHaveValue('500,00');
    });
  });
});
