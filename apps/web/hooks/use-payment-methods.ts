import type { PaginatedResponse, ApiResponse } from "@erp/shared-types";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import api from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────

export type PaymentMethodType =
  | "CASH"
  | "CREDIT_CARD"
  | "DEBIT_CARD"
  | "PIX"
  | "BOLETO"
  | "BANK_TRANSFER"
  | "CHECK"
  | "STORE_CREDIT"
  | "OTHER";

export interface PaymentMethod {
  id: string;
  name: string;
  type: PaymentMethodType;
  defaultAccountId: string | null;
  /**
   * VD-11: the API has always returned this and the local type dropped it, so
   * the screen that tells the operator to "configure a conta vinculada" could
   * not show which account was linked. Same class as AE-13 — a retyped
   * response silently loses a field and the column just looks empty.
   */
  defaultAccount?: { id: string; name: string; type: string } | null;
  feePercentage: number;
  settlementDays: number;
  /** Baixa os títulos desta forma sozinho, no dia da liquidação. */
  autoSettle: boolean;
  requiresAuthorization: boolean;
  fiscalCode: string | null;
  isActive: boolean;
}

// ─── Params ────────────────────────────────────────────────────────────

export interface PaymentMethodListParams {
  search?: string;
  /** FT-05: aceitos pela API desde sempre e ausentes na tela. */
  type?: PaymentMethodType;
  isActive?: boolean;
  limit?: number;
}

// ─── Query keys ────────────────────────────────────────────────────────

export const paymentMethodKeys = {
  all: ["payment-methods"] as const,
  lists: () => [...paymentMethodKeys.all, "list"] as const,
  list: (params: PaymentMethodListParams) =>
    [...paymentMethodKeys.lists(), params] as const,
};

// ─── Hooks ─────────────────────────────────────────────────────────────

export function usePaymentMethods(params: PaymentMethodListParams = {}) {
  return useQuery({
    queryKey: paymentMethodKeys.list(params),
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<PaymentMethod>>(
        "/payment-methods",
        {
          params: {
            search: params.search || undefined,
            type: params.type || undefined,
            isActive: params.isActive,
            limit: params.limit ?? 100,
          },
        }
      );
      return data;
    },
    placeholderData: (prev) => prev,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────

export interface CreatePaymentMethodPayload {
  name: string;
  type: PaymentMethodType;
  defaultAccountId?: string;
  feePercentage?: number;
  settlementDays?: number;
  autoSettle?: boolean;
  requiresAuthorization?: boolean;
  fiscalCode?: string;
  isActive?: boolean;
}

export interface UpdatePaymentMethodPayload extends Partial<CreatePaymentMethodPayload> {
  id: string;
}

export function useCreatePaymentMethod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreatePaymentMethodPayload) => {
      const { data } = await api.post<ApiResponse<PaymentMethod>>(
        "/payment-methods",
        payload
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: paymentMethodKeys.lists(),
      });
    },
  });
}

export function useUpdatePaymentMethod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdatePaymentMethodPayload) => {
      const { data } = await api.patch<ApiResponse<PaymentMethod>>(
        `/payment-methods/${id}`,
        payload
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: paymentMethodKeys.lists(),
      });
    },
  });
}

export interface DeletePaymentMethodResult {
  id: string;
  deactivated: boolean;
  message: string;
}

export function useDeletePaymentMethod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete<ApiResponse<DeletePaymentMethodResult>>(
        `/payment-methods/${id}`
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: paymentMethodKeys.lists(),
      });
    },
  });
}
