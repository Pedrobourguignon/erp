import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createRegister = vi.fn();

vi.mock('@/hooks/use-cash-registers', () => ({
  useCreateCashRegister: () => ({ mutateAsync: createRegister, isPending: false }),
  useCloseCashRegister: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/use-financial-accounts', () => ({
  useFinancialAccounts: () => ({
    data: {
      data: [
        { id: 'acc-gaveta', name: 'Gaveta' },
        { id: 'acc-cofre', name: 'Cofre' },
      ],
    },
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

import { CreateCashRegisterDialog } from './cash-register-dialogs';

function pick(label: RegExp, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

describe('CreateCashRegisterDialog — cofre do caixa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createRegister.mockResolvedValue({});
  });

  it('cadastra o caixa com o cofre', async () => {
    render(<CreateCashRegisterDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Nome/), { target: { value: 'Caixa 01' } });
    pick(/Conta Financeira/, 'Gaveta');
    pick(/Cofre do caixa/, 'Cofre');
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() =>
      expect(createRegister).toHaveBeenCalledWith({
        name: 'Caixa 01',
        financialAccountId: 'acc-gaveta',
        vaultAccountId: 'acc-cofre',
      }),
    );
  });

  it('o cofre é opcional', async () => {
    render(<CreateCashRegisterDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Nome/), { target: { value: 'Caixa 01' } });
    pick(/Conta Financeira/, 'Gaveta');
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() =>
      expect(createRegister).toHaveBeenCalledWith({ name: 'Caixa 01', financialAccountId: 'acc-gaveta' }),
    );
  });

  it('não oferece a conta da própria gaveta como cofre', () => {
    render(<CreateCashRegisterDialog open onOpenChange={vi.fn()} />);

    pick(/Conta Financeira/, 'Gaveta');
    fireEvent.click(screen.getByRole('combobox', { name: /Cofre do caixa/ }));

    expect(screen.queryByRole('option', { name: 'Gaveta' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cofre' })).toBeInTheDocument();
  });
});
