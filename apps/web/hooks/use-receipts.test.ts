import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  default: { post: vi.fn() },
}));

import api from '@/lib/api';

import { usePrintAdjustmentReceipt, usePrintSaleReceipt } from './use-receipts';

const post = vi.mocked(api.post);

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

describe('receipt hooks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues the sale receipt with a POST (each call is one more copy)', async () => {
    post.mockResolvedValue({ data: { success: true, data: { kind: 'SALE', copy: 1 } } });
    const { result } = renderHook(() => usePrintSaleReceipt(), { wrapper });

    let receipt: unknown;
    await act(async () => {
      receipt = await result.current.mutateAsync('order-1');
    });

    expect(post).toHaveBeenCalledWith('/orders/order-1/receipt');
    expect(receipt).toEqual({ kind: 'SALE', copy: 1 });
  });

  it('issues the receipt of one exchange', async () => {
    post.mockResolvedValue({ data: { success: true, data: { kind: 'EXCHANGE', copy: 2 } } });
    const { result } = renderHook(() => usePrintAdjustmentReceipt(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ orderId: 'order-1', adjustmentId: 'adj-1' });
    });

    expect(post).toHaveBeenCalledWith('/orders/order-1/adjustments/adj-1/receipt');
  });
});
