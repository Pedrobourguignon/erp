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
  useCustomers,
  useCustomer,
  useCreateCustomer,
  useUpdateCustomer,
  useDeleteCustomer,
  customerKeys,
} from './use-customers';

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

describe('customerKeys', () => {
  it('should generate correct query keys', () => {
    expect(customerKeys.all).toEqual(['customers']);
    expect(customerKeys.lists()).toEqual(['customers', 'list']);
    expect(customerKeys.list({ page: 2 })).toEqual(['customers', 'list', { page: 2 }]);
    expect(customerKeys.details()).toEqual(['customers', 'detail']);
    expect(customerKeys.detail('c1')).toEqual(['customers', 'detail', 'c1']);
  });
});

describe('useCustomers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch customers with default params', async () => {
    const mockData = {
      data: [{ id: 'c1', name: 'Customer A' }],
      meta: { page: 1, limit: 20, total: 1 },
    };
    mockedApi.get.mockResolvedValueOnce({ data: mockData });

    const { result } = renderHook(() => useCustomers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedApi.get).toHaveBeenCalledWith('/customers', {
      params: {
        page: 1,
        limit: 20,
        search: undefined,
        segment: undefined,
        sortBy: undefined,
        sortOrder: undefined,
      },
    });
    expect(result.current.data).toEqual(mockData);
  });

  it('should pass custom params', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { data: [], meta: {} } });

    const { result } = renderHook(
      () => useCustomers({ page: 3, limit: 10, search: 'john', segment: 'vip' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedApi.get).toHaveBeenCalledWith('/customers', {
      params: expect.objectContaining({
        page: 3,
        limit: 10,
        search: 'john',
        segment: 'vip',
      }),
    });
  });

  it('should handle API error', async () => {
    mockedApi.get.mockRejectedValueOnce(new Error('Server error'));

    const { result } = renderHook(() => useCustomers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe('useCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch a customer by id', async () => {
    const mockData = { data: { id: 'c1', name: 'Customer A' } };
    mockedApi.get.mockResolvedValueOnce({ data: mockData });

    const { result } = renderHook(() => useCustomer('c1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockedApi.get).toHaveBeenCalledWith('/customers/c1');
    expect(result.current.data).toEqual(mockData);
  });

  it('should not fetch when id is empty', async () => {
    const { result } = renderHook(() => useCustomer(''), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedApi.get).not.toHaveBeenCalled();
  });
});

describe('useCreateCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should POST to /customers', async () => {
    const mockResponse = { data: { id: 'c2', name: 'New Customer' } };
    mockedApi.post.mockResolvedValueOnce({ data: mockResponse });

    const { result } = renderHook(() => useCreateCustomer(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      documentType: 'CPF',
      name: 'New Customer',
      document: '12345678900',
      email: 'new@test.com',
      phone: '11999999999',
      birthDate: null,
    });

    expect(mockedApi.post).toHaveBeenCalledWith('/customers', {
      documentType: 'CPF',
      name: 'New Customer',
      document: '12345678900',
      email: 'new@test.com',
      phone: '11999999999',
      birthDate: null,
    });
  });
});

describe('useUpdateCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should PATCH to /customers/:id', async () => {
    const mockResponse = { data: { id: 'c1', name: 'Updated' } };
    mockedApi.patch.mockResolvedValueOnce({ data: mockResponse });

    const { result } = renderHook(() => useUpdateCustomer(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      id: 'c1',
      documentType: 'CPF',
      name: 'Updated',
      document: '12345678900',
      email: 'upd@test.com',
      phone: '11999999999',
      birthDate: null,
    });

    expect(mockedApi.patch).toHaveBeenCalledWith('/customers/c1', {
      documentType: 'CPF',
      name: 'Updated',
      document: '12345678900',
      email: 'upd@test.com',
      phone: '11999999999',
      birthDate: null,
    });
  });
});

describe('useDeleteCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should DELETE /customers/:id', async () => {
    mockedApi.delete.mockResolvedValueOnce({});

    const { result } = renderHook(() => useDeleteCustomer(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync('c1');

    expect(mockedApi.delete).toHaveBeenCalledWith('/customers/c1');
  });
});
