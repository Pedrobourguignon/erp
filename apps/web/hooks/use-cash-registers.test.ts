import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import api from '@/lib/api';

import {
  useCashRegisterSession,
  useCashRegisterSessions,
  useCloseCashRegister,
  useCashWithdraw,
  useCashSupply,
  useOpenCashRegister,
  useUpdateCashRegister,
  cashRegisterKeys,
} from './use-cash-registers';

const mockedApi = vi.mocked(api);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe('cashRegisterKeys', () => {
  it('should generate correct query keys', () => {
    expect(cashRegisterKeys.all).toEqual(['cash-registers']);
    expect(cashRegisterKeys.session('reg-1')).toEqual([
      'cash-registers',
      'session',
      'reg-1',
    ]);
    expect(cashRegisterKeys.sessionList({ status: 'OPEN' })).toEqual([
      'cash-registers',
      'sessions',
      { status: 'OPEN' },
    ]);
  });
});

describe('useCashRegisterSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch the current session keyed by the cash-register id', async () => {
    // SCRUM-8: the endpoint expects the cash-register id, not the session id
    mockedApi.get.mockResolvedValueOnce({
      data: { success: true, data: { id: 'sess-1', status: 'OPEN' } },
    });

    const { result } = renderHook(() => useCashRegisterSession('reg-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedApi.get).toHaveBeenCalledWith('/cash-registers/reg-1/session');
  });

  it('should not fetch when id is empty', () => {
    renderHook(() => useCashRegisterSession(''), { wrapper: createWrapper() });

    expect(mockedApi.get).not.toHaveBeenCalled();
  });
});

describe('useCashRegisterSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch the session history with default pagination', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { data: [], meta: { page: 1, limit: 20, total: 0 } },
    });

    const { result } = renderHook(() => useCashRegisterSessions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedApi.get).toHaveBeenCalledWith('/cash-register-sessions', {
      params: {
        cashRegisterId: undefined,
        status: undefined,
        page: 1,
        limit: 20,
      },
    });
  });

  it('should forward status and pagination params', async () => {
    mockedApi.get.mockResolvedValueOnce({
      data: { data: [], meta: { page: 2, limit: 5, total: 0 } },
    });

    const { result } = renderHook(
      () => useCashRegisterSessions({ status: 'OPEN', page: 2, limit: 5 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedApi.get).toHaveBeenCalledWith('/cash-register-sessions', {
      params: {
        cashRegisterId: undefined,
        status: 'OPEN',
        page: 2,
        limit: 5,
      },
    });
  });
});

// ─── FN-11: fechar o caixa tem que atualizar o histórico de sessões ──────

describe('cash register mutations invalidate the session history', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invalidates the whole cash-registers prefix when a session closes', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: {} } });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useCloseCashRegister(), { wrapper });
    await result.current.mutateAsync({ id: 'reg-1', closingBalance: 100 });

    // Invalidating only `lists()` left `sessionList(params)` untouched: the
    // operator closed the register and the table still read "Aberto".
    expect(spy).toHaveBeenCalledWith({ queryKey: cashRegisterKeys.all });
  });
});

describe('useCashWithdraw — sangria vai para uma conta', () => {
  beforeEach(() => vi.clearAllMocks());

  it('envia a conta de destino junto com valor e motivo', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: {} } });
    const { result } = renderHook(() => useCashWithdraw(), { wrapper: createWrapper() });

    await result.current.mutateAsync({
      id: 'reg-1',
      amount: 500,
      reason: 'Excesso na gaveta',
      destinationAccountId: 'acc-cofre',
    });

    expect(mockedApi.post).toHaveBeenCalledWith('/cash-registers/reg-1/withdraw', {
      amount: 500,
      reason: 'Excesso na gaveta',
      destinationAccountId: 'acc-cofre',
    });
  });

  it('invalida o saldo das contas financeiras: o destino acabou de receber dinheiro', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: {} } });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useCashWithdraw(), { wrapper });
    await result.current.mutateAsync({
      id: 'reg-1',
      amount: 500,
      reason: 'Sangria',
      destinationAccountId: 'acc-cofre',
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: cashRegisterKeys.all });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['financial-accounts'] });
  });
});

describe('useCashSupply — suprimento vem de uma conta', () => {
  beforeEach(() => vi.clearAllMocks());

  it('envia a conta de origem junto com valor e motivo', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: {} } });
    const { result } = renderHook(() => useCashSupply(), { wrapper: createWrapper() });

    await result.current.mutateAsync({
      id: 'reg-1',
      amount: 200,
      reason: 'Troco',
      sourceAccountId: 'acc-cofre',
    });

    expect(mockedApi.post).toHaveBeenCalledWith('/cash-registers/reg-1/supply', {
      amount: 200,
      reason: 'Troco',
      sourceAccountId: 'acc-cofre',
    });
  });

  it('invalida o saldo das contas financeiras: a origem acabou de perder dinheiro', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: {} } });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useCashSupply(), { wrapper });
    await result.current.mutateAsync({ id: 'reg-1', amount: 200, reason: 'Troco', sourceAccountId: 'acc-cofre' });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['financial-accounts'] });
  });
});

describe('useOpenCashRegister — o fundo que falta vem de uma conta', () => {
  beforeEach(() => vi.clearAllMocks());

  it('envia a conta de origem do fundo de troco', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: {} } });
    const { result } = renderHook(() => useOpenCashRegister(), { wrapper: createWrapper() });

    await result.current.mutateAsync({ id: 'reg-1', openingBalance: 120, sourceAccountId: 'acc-cofre' });

    expect(mockedApi.post).toHaveBeenCalledWith('/cash-registers/reg-1/open', {
      openingBalance: 120,
      sourceAccountId: 'acc-cofre',
    });
  });

  it('invalida o saldo das contas: o cofre pode ter acabado de perder dinheiro', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { success: true, data: {} } });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useOpenCashRegister(), { wrapper });
    await result.current.mutateAsync({ id: 'reg-1', openingBalance: 120 });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['financial-accounts'] });
  });
});

describe('useUpdateCashRegister', () => {
  beforeEach(() => vi.clearAllMocks());

  it('grava o cofre do caixa', async () => {
    mockedApi.patch.mockResolvedValueOnce({ data: { success: true, data: {} } });
    const { result } = renderHook(() => useUpdateCashRegister(), { wrapper: createWrapper() });

    await result.current.mutateAsync({ id: 'reg-1', vaultAccountId: 'acc-cofre' });

    expect(mockedApi.patch).toHaveBeenCalledWith('/cash-registers/reg-1', {
      vaultAccountId: 'acc-cofre',
    });
  });
});
