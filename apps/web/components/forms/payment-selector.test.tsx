import { render, screen } from '@testing-library/react';
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

vi.mock('@/hooks/use-payment-methods', () => ({
  usePaymentMethods: () => ({ data: { data: [debit] }, error: null }),
}));

function Selector() {
  const { control, setValue } = useForm({
    defaultValues: { payments: [{ paymentMethodId: debit.id, amount: 100 }] },
  });
  return (
    <PaymentSelector
      control={control as unknown as Control<FieldValues>}
      setValue={setValue as unknown as UseFormSetValue<FieldValues>}
      totalAmount={100}
    />
  );
}

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
});
