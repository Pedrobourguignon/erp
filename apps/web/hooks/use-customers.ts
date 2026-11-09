import type { Customer, PaginatedResponse, ApiResponse } from "@erp/shared-types";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import api from "@/lib/api";

// ─── Types ──────────────────────────────────────────────────────────────

export type CustomerDocumentType = "CPF" | "CNPJ";
export type CustomerSegment = "regular" | "vip" | "wholesale" | "inactive";

export interface CustomerAddress {
  id?: string;
  label: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  isDefault: boolean;
}

export interface CustomerDetail extends Customer {
  documentType: CustomerDocumentType;
  /** Opcional no cadastro: a API devolve `null` quando não foi informado. */
  phone: string | null;
  segment: CustomerSegment;
  totalOrders: number;
  totalSpent: number;
  addresses: CustomerAddress[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerListItem extends Customer {
  documentType: CustomerDocumentType;
  /** Opcional no cadastro: a API devolve `null` quando não foi informado. */
  phone: string | null;
  segment: CustomerSegment;
  totalOrders: number;
  totalSpent: number;
}

export interface CustomerListParams {
  page?: number;
  limit?: number;
  search?: string;
  segment?: CustomerSegment;
  /** FT-07: aceito pela API desde sempre e ausente na tela. */
  documentType?: CustomerDocumentType;
  tag?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface CustomerFormData {
  documentType: CustomerDocumentType;
  name: string;
  document: string;
  email: string;
  phone: string;
  segment?: CustomerSegment;
}

// ─── Query keys ─────────────────────────────────────────────────────────

export const customerKeys = {
  all: ["customers"] as const,
  lists: () => [...customerKeys.all, "list"] as const,
  list: (params: CustomerListParams) => [...customerKeys.lists(), params] as const,
  details: () => [...customerKeys.all, "detail"] as const,
  detail: (id: string) => [...customerKeys.details(), id] as const,
};

// ─── Hooks ──────────────────────────────────────────────────────────────

export function useCustomers(params: CustomerListParams = {}) {
  return useQuery({
    queryKey: customerKeys.list(params),
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<CustomerListItem>>("/customers", {
        params: {
          page: params.page ?? 1,
          limit: params.limit ?? 20,
          search: params.search || undefined,
          segment: params.segment || undefined,
          documentType: params.documentType || undefined,
          tag: params.tag || undefined,
          sortBy: params.sortBy || undefined,
          sortOrder: params.sortOrder || undefined,
        },
      });
      return data;
    },
    placeholderData: (prev) => prev,
  });
}

export function useCustomer(
  id: string,
  options?: Omit<UseQueryOptions<ApiResponse<CustomerDetail>>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: customerKeys.detail(id),
    queryFn: async () => {
      const { data } = await api.get<ApiResponse<CustomerDetail>>(`/customers/${id}`);
      return data;
    },
    enabled: !!id,
    ...options,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CustomerFormData) => {
      const { data } = await api.post<ApiResponse<CustomerDetail>>("/customers", payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...payload }: CustomerFormData & { id: string }) => {
      const { data } = await api.patch<ApiResponse<CustomerDetail>>(
        `/customers/${id}`,
        payload
      );
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      queryClient.invalidateQueries({ queryKey: customerKeys.detail(variables.id) });
    },
  });
}

export function useDeleteCustomer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/customers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
    },
  });
}

// ─── Addresses (AE-16) ──────────────────────────────────────────────────

export interface CustomerAddressPayload {
  label?: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  isDefault?: boolean;
}

export function useCustomerAddresses(customerId: string, enabled = true) {
  return useQuery({
    queryKey: [...customerKeys.detail(customerId), "addresses"] as const,
    queryFn: async () => {
      const { data } = await api.get<ApiResponse<CustomerAddress[]>>(
        `/customers/${customerId}/addresses`
      );
      return data.data;
    },
    enabled: enabled && !!customerId,
  });
}

/** Both the address list and the customer detail embed the addresses. */
function invalidateCustomer(
  queryClient: ReturnType<typeof useQueryClient>,
  customerId: string
) {
  queryClient.invalidateQueries({ queryKey: customerKeys.detail(customerId) });
  queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
}

export function useCreateCustomerAddress(customerId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CustomerAddressPayload) => {
      const { data } = await api.post<ApiResponse<CustomerAddress>>(
        `/customers/${customerId}/addresses`,
        payload
      );
      return data.data;
    },
    onSuccess: () => invalidateCustomer(queryClient, customerId),
  });
}

export function useUpdateCustomerAddress(customerId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      addressId,
      ...payload
    }: Partial<CustomerAddressPayload> & { addressId: string }) => {
      const { data } = await api.patch<ApiResponse<CustomerAddress>>(
        `/customers/${customerId}/addresses/${addressId}`,
        payload
      );
      return data.data;
    },
    onSuccess: () => invalidateCustomer(queryClient, customerId),
  });
}

export function useDeleteCustomerAddress(customerId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (addressId: string) => {
      await api.delete(`/customers/${customerId}/addresses/${addressId}`);
    },
    onSuccess: () => invalidateCustomer(queryClient, customerId),
  });
}
