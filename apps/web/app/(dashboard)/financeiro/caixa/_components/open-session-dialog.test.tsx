import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CashRegister } from '@/hooks/use-cash-registers';

const openRegister = vi.fn();

vi.mock('@/hooks/use-cash-registers', () => ({
  useOpenCashRegister: () => ({ mutateAsync: openRegister, isPending: false }),
}));

vi.mock('@/hooks/use-financial-accounts', () => ({
  useFinancialAccounts: () => ({
    data: {
      data: [
        { id: 'acc-gaveta', name: 'Gaveta Caixa 01', balance: 50 },
        { id: 'acc-cofre', name: 'Cofre', balance: 500 },
        { id: 'acc-banco', name: 'Santander', balance: 0 },
      ],
    },
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

import { OpenSessionDialog } from './open-session-dialog';

function makeRegister(overrides: Partial<CashRegister> = {}): CashRegister {
  return {
    id: 'reg-1',
    name: 'Caixa 01',
    financialAccountId: 'acc-gaveta',
    vaultAccountId: 'acc-cofre',
    vaultAccount: { id: 'acc-cofre', name: 'Cofre' },
    isActive: true,
    ...overrides,
  };
}

const declare = (digits: string) =>
  fireEvent.change(screen.getByLabelText(/Saldo de abertura/i), { target: { value: digits } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
const sourceSelect = () => screen.queryByRole('combobox', { name: /De onde vem o dinheiro/ });

describe('OpenSessionDialog — o fundo que falta vem de uma conta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openRegister.mockResolvedValue({});
  });

  it('abre com o saldo da gaveta sem pedir conta nenhuma', async () => {
    render(<OpenSessionDialog register={makeRegister()} onClose={vi.fn()} />);

    expect(sourceSelect()).not.toBeInTheDocument();
    submit();

    await waitFor(() => expect(openRegister).toHaveBeenCalledWith({ id: 'reg-1', openingBalance: 50 }));
  });

  it('declarando mais que a gaveta, pede a origem já com o cofre e a envia', async () => {
    render(<OpenSessionDialog register={makeRegister()} onClose={vi.fn()} />);

    declare('12000');

    expect(screen.getByText(/R\$\s70,00/)).toBeInTheDocument();
    expect(sourceSelect()).toHaveTextContent('Cofre');
    submit();

    await waitFor(() =>
      expect(openRegister).toHaveBeenCalledWith({
        id: 'reg-1',
        openingBalance: 120,
        sourceAccountId: 'acc-cofre',
      }),
    );
  });

  it('sem cofre, recusa abrir com dinheiro a mais sem dizer de onde ele vem', async () => {
    render(
      <OpenSessionDialog register={makeRegister({ vaultAccountId: null, vaultAccount: null })} onClose={vi.fn()} />,
    );

    declare('12000');
    submit();

    expect(await screen.findByText('Escolha de qual conta vem o dinheiro.')).toBeInTheDocument();
    expect(openRegister).not.toHaveBeenCalled();
  });

  it('não oferece a própria gaveta como origem', () => {
    render(<OpenSessionDialog register={makeRegister()} onClose={vi.fn()} />);

    declare('12000');
    fireEvent.click(sourceSelect()!);

    expect(screen.getByRole('option', { name: 'Santander' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Gaveta Caixa 01' })).not.toBeInTheDocument();
  });

  it('declarando menos que a gaveta, avisa que saiu dinheiro sem registro', () => {
    render(<OpenSessionDialog register={makeRegister()} onClose={vi.fn()} />);

    declare('2000');

    expect(screen.getByText(/Faltam/)).toBeInTheDocument();
    expect(sourceSelect()).not.toBeInTheDocument();
  });
});
