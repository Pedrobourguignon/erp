import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CashRegister } from '@/hooks/use-cash-registers';

const withdraw = vi.fn();
const supply = vi.fn();
const updateRegister = vi.fn();
const addToast = vi.fn();
let permissions: string[] = ['financial:create', 'financial:update'];

vi.mock('@/hooks/use-cash-registers', () => ({
  useCashWithdraw: () => ({ mutateAsync: withdraw, isPending: false }),
  useCashSupply: () => ({ mutateAsync: supply, isPending: false }),
  useUpdateCashRegister: () => ({ mutateAsync: updateRegister, isPending: false }),
}));

vi.mock('@/hooks/use-financial-accounts', () => ({
  useFinancialAccounts: () => ({
    data: {
      data: [
        { id: 'acc-gaveta', name: 'Gaveta Caixa 01' },
        { id: 'acc-cofre', name: 'Cofre' },
        { id: 'acc-banco', name: 'Santander' },
      ],
    },
  }),
}));

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    can: (p: string) => permissions.includes(p),
    isLoaded: true,
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ addToast }),
}));

import { DrawerTransferDialog } from './drawer-transfer-dialog';

function makeRegister(overrides: Partial<CashRegister> = {}): CashRegister {
  return {
    id: 'reg-1',
    name: 'Caixa 01',
    financialAccountId: 'acc-gaveta',
    vaultAccountId: null,
    vaultAccount: null,
    isActive: true,
    ...overrides,
  };
}

const withVault = () =>
  makeRegister({ vaultAccountId: 'acc-cofre', vaultAccount: { id: 'acc-cofre', name: 'Cofre' } });

function fill(amountDigits: string, reason: string) {
  fireEvent.change(screen.getByPlaceholderText('0,00'), { target: { value: amountDigits } });
  fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: reason } });
}

const CASES = [
  {
    direction: 'withdraw' as const,
    mutation: withdraw,
    field: 'destinationAccountId',
    accountLabel: /Para onde vai o dinheiro/,
    confirm: 'Confirmar sangria',
    missing: 'Escolha para qual conta vai o dinheiro.',
  },
  {
    direction: 'supply' as const,
    mutation: supply,
    field: 'sourceAccountId',
    accountLabel: /De onde vem o dinheiro/,
    confirm: 'Confirmar suprimento',
    missing: 'Escolha de qual conta vem o dinheiro.',
  },
];

describe.each(CASES)('DrawerTransferDialog ($direction) — transferência com a gaveta', (c) => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions = ['financial:create', 'financial:update'];
    withdraw.mockResolvedValue({});
    supply.mockResolvedValue({});
    updateRegister.mockResolvedValue({});
  });

  it('já vem com o cofre do caixa e o envia', async () => {
    render(<DrawerTransferDialog direction={c.direction} register={withVault()} onClose={vi.fn()} />);

    expect(screen.getByRole('combobox', { name: c.accountLabel })).toHaveTextContent('Cofre');

    fill('50000', 'Movimento');
    fireEvent.click(screen.getByRole('button', { name: c.confirm }));

    await waitFor(() =>
      expect(c.mutation).toHaveBeenCalledWith({
        id: 'reg-1',
        amount: 500,
        reason: 'Movimento',
        [c.field]: 'acc-cofre',
      }),
    );
    expect(updateRegister).not.toHaveBeenCalled();
  });

  it('não oferece a própria gaveta como a outra conta', () => {
    render(<DrawerTransferDialog direction={c.direction} register={makeRegister()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('combobox', { name: c.accountLabel }));

    expect(screen.getByRole('option', { name: 'Cofre' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Gaveta Caixa 01' })).not.toBeInTheDocument();
  });

  it('sem cofre, recusa confirmar sem escolher a conta', async () => {
    render(<DrawerTransferDialog direction={c.direction} register={makeRegister()} onClose={vi.fn()} />);

    fill('10000', 'Movimento');
    fireEvent.click(screen.getByRole('button', { name: c.confirm }));

    expect(await screen.findByText(c.missing)).toBeInTheDocument();
    expect(c.mutation).not.toHaveBeenCalled();
  });

  it('grava a conta escolhida como cofre do caixa quando pedido', async () => {
    render(<DrawerTransferDialog direction={c.direction} register={makeRegister()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('combobox', { name: c.accountLabel }));
    fireEvent.click(screen.getByRole('option', { name: 'Cofre' }));
    fireEvent.click(screen.getByLabelText(/Usar sempre esta conta/));
    fill('10000', 'Movimento');
    fireEvent.click(screen.getByRole('button', { name: c.confirm }));

    await waitFor(() => expect(c.mutation).toHaveBeenCalled());
    expect(updateRegister).toHaveBeenCalledWith({ id: 'reg-1', vaultAccountId: 'acc-cofre' });
  });

  it('não mostra a opção de cofre para quem não pode editar o caixa', () => {
    permissions = ['financial:create'];
    render(<DrawerTransferDialog direction={c.direction} register={makeRegister()} onClose={vi.fn()} />);

    expect(screen.queryByLabelText(/Usar sempre esta conta/)).not.toBeInTheDocument();
  });

  it('mostra o motivo que a API deu quando a operação é recusada', async () => {
    c.mutation.mockRejectedValueOnce(
      new AxiosError('Bad Request', '400', undefined, undefined, {
        status: 400,
        data: { message: 'Saldo insuficiente em "Cofre" (disponível: R$ 80,00)' },
      } as AxiosResponse),
    );
    render(<DrawerTransferDialog direction={c.direction} register={withVault()} onClose={vi.fn()} />);

    fill('10000', 'Movimento');
    fireEvent.click(screen.getByRole('button', { name: c.confirm }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.stringContaining('Saldo insuficiente'), 'error'),
    );
  });
});

describe('DrawerTransferDialog — o que não é sangria', () => {
  it('na sangria, explica que pagar algo com o dinheiro do caixa é despesa', () => {
    render(<DrawerTransferDialog direction="withdraw" register={makeRegister()} onClose={vi.fn()} />);

    expect(screen.getByText(/não é sangria/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /lançamentos/i })).toHaveAttribute(
      'href',
      '/financeiro/lancamentos',
    );
  });

  it('no suprimento, explica que receber um pagamento em dinheiro não é suprimento', () => {
    render(<DrawerTransferDialog direction="supply" register={makeRegister()} onClose={vi.fn()} />);

    expect(screen.getByText(/não é suprimento/)).toBeInTheDocument();
  });
});
