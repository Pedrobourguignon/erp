import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import api from '@/lib/api';

import { useExchangeOrderItem, useReturnOrderItem } from './use-order-adjustments';

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

const invalidatedKeys = (spy: ReturnType<typeof setup>['invalidate']) =>
  spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);

describe('useExchangeOrderItem', () => {
  beforeEach(() => vi.clearAllMocks());

  it('envia a troca para /orders/:id/exchange sem o id do pedido no corpo', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { data: { difference: 30 } } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useExchangeOrderItem(), { wrapper });

    const response = await result.current.mutateAsync({
      id: 'o1',
      orderItemId: 'i1',
      newProductId: 'p2',
      newVariantId: 'v-g',
      quantity: 1,
      settlement: { paymentMethodId: 'pm-cash' },
    });

    expect(mockedApi.post).toHaveBeenCalledWith('/orders/o1/exchange', {
      orderItemId: 'i1',
      newProductId: 'p2',
      newVariantId: 'v-g',
      quantity: 1,
      settlement: { paymentMethodId: 'pm-cash' },
    });
    expect(response.data.difference).toBe(30);
  });

  it('invalida pedido, estoque, financeiro e caixa', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { data: {} } });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useExchangeOrderItem(), { wrapper });

    await result.current.mutateAsync({ id: 'o1', orderItemId: 'i1', newProductId: 'p2' });

    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining([
        ['orders', 'detail', 'o1'],
        ['orders', 'list'],
        ['inventory'],
        ['products'],
        ['financial-entries'],
        ['cash-registers'],
      ]),
    );
  });
});

describe('useReturnOrderItem', () => {
  beforeEach(() => vi.clearAllMocks());

  it('envia a devolução para /orders/:id/return-item com o motivo aparado', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { data: { difference: -90 } } });
    const { wrapper } = setup();
    const { result } = renderHook(() => useReturnOrderItem(), { wrapper });

    await result.current.mutateAsync({
      id: 'o1',
      orderItemId: 'i1',
      quantity: 1,
      reason: '  Defeito  ',
    });

    expect(mockedApi.post).toHaveBeenCalledWith('/orders/o1/return-item', {
      orderItemId: 'i1',
      quantity: 1,
      reason: 'Defeito',
    });
  });

  it('recusa devolução sem motivo, sem chamar a API', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useReturnOrderItem(), { wrapper });

    await expect(
      result.current.mutateAsync({ id: 'o1', orderItemId: 'i1', reason: ' ' }),
    ).rejects.toThrow(/motivo/i);
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('invalida o caixa: um reembolso em dinheiro sai da gaveta', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { data: {} } });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useReturnOrderItem(), { wrapper });

    await result.current.mutateAsync({ id: 'o1', orderItemId: 'i1', reason: 'x' });

    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining([['cash-registers'], ['financial-entries']]),
    );
  });
});
