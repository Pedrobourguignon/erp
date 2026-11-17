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
  cardMachineKeys,
  useCardMachines,
  useCreateCardMachine,
  useDeleteCardMachine,
  useUpdateCardMachine,
} from './use-card-machines';
import { paymentMethodKeys } from './use-payment-methods';

const mockedApi = vi.mocked(api);

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { wrapper, invalidate };
}

const payload = {
  name: 'Stone Loja Centro',
  provider: 'Stone',
  debitFeePercentage: 1.5,
  debitSettlementDays: 1,
  creditReceiveMode: 'FLOW' as const,
  creditSettlementDays: 30,
  rates: [{ installments: 1, feePercentage: 3.19 }],
};

describe('cardMachineKeys', () => {
  it('follows the [entity, action, params] convention', () => {
    expect(cardMachineKeys.all).toEqual(['card-machines']);
    expect(cardMachineKeys.list({ search: 'x' })).toEqual([
      'card-machines',
      'list',
      { search: 'x' },
    ]);
  });
});

describe('useCardMachines', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches the machines with the filters', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { data: [], meta: { total: 0 } } });
    const { wrapper } = setup();

    const { result } = renderHook(() => useCardMachines({ search: 'Stone' }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/card-machines', {
      params: { search: 'Stone', isActive: undefined, limit: 100 },
    });
  });

  it('exposes the error instead of an empty list', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('403'));
    const { wrapper } = setup();

    const { result } = renderHook(() => useCardMachines(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// A forma de pagamento mostra dados da maquininha (parcelas, nome): mudar a
// maquininha precisa recarregar as duas listas.
describe('mutations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates and refreshes machines and payment methods', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { data: { id: 'cm-1' } } });
    const { wrapper, invalidate } = setup();

    const { result } = renderHook(() => useCreateCardMachine(), { wrapper });
    await result.current.mutateAsync(payload);

    expect(mockedApi.post).toHaveBeenCalledWith('/card-machines', payload);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: cardMachineKeys.lists() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: paymentMethodKeys.lists() });
  });

  it('updates by id', async () => {
    mockedApi.patch.mockResolvedValueOnce({ data: { data: { id: 'cm-1' } } });
    const { wrapper } = setup();

    const { result } = renderHook(() => useUpdateCardMachine(), { wrapper });
    await result.current.mutateAsync({ id: 'cm-1', name: 'Stone Shopping' });

    expect(mockedApi.patch).toHaveBeenCalledWith('/card-machines/cm-1', {
      name: 'Stone Shopping',
    });
  });

  it('deletes by id and returns whether it was only deactivated', async () => {
    mockedApi.delete.mockResolvedValueOnce({
      data: { data: { id: 'cm-1', deactivated: true, message: 'inativada' } },
    });
    const { wrapper } = setup();

    const { result } = renderHook(() => useDeleteCardMachine(), { wrapper });
    const response = await result.current.mutateAsync('cm-1');

    expect(mockedApi.delete).toHaveBeenCalledWith('/card-machines/cm-1');
    expect(response.data.deactivated).toBe(true);
  });
});
