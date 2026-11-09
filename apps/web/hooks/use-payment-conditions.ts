import type { PaginatedResponse, ApiResponse } from "@erp/shared-types";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import api from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────

export type PaymentConditionType =
  | "CASH"
  | "INSTALLMENT"
  | "ENTRY_PLUS_INSTALLMENT";

export interface PaymentCondition {
  id: string;
  name: string;
  code: string;
  type: PaymentConditionType;
  installments: number;
  daysBetweenInstallments: number;
  entryPercentage: number;
  isActive: boolean;
  /**
   * SCRUM-52: métodos a que esta condição fica restrita. Vazio = aparece para
   * qualquer método que mostre condição (comportamento anterior).
   */
  paymentMethodIds: string[];
  paymentMethods?: { id: string; name: string }[];
}

export interface CreatePaymentConditionPayload {
  name: string;
  code: string;
  type: PaymentConditionType;
  installments: number;
  daysBetweenInstallments: number;
  entryPercentage: number;
  paymentMethodIds?: string[];
}

export interface UpdatePaymentConditionPayload
  extends Partial<CreatePaymentConditionPayload> {
  id: string;
}

// ─── Params ────────────────────────────────────────────────────────────

export interface PaymentConditionListParams {
  search?: string;
  /** FT-05: aceitos pela API desde sempre e ausentes na tela. */
  type?: PaymentConditionType;
  isActive?: boolean;
  limit?: number;
}

// ─── Query keys ────────────────────────────────────────────────────────

export const paymentConditionKeys = {
  all: ["payment-conditions"] as const,
  lists: () => [...paymentConditionKeys.all, "list"] as const,
  list: (params: PaymentConditionListParams) =>
    [...paymentConditionKeys.lists(), params] as const,
};

// ─── Hooks ─────────────────────────────────────────────────────────────

export function usePaymentConditions(
  params: PaymentConditionListParams = {}
) {
  return useQuery({
    queryKey: paymentConditionKeys.list(params),
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<PaymentCondition>>(
        "/payment-conditions",
        {
          params: {
            search: params.search || undefined,
            type: params.type || undefined,
            isActive: params.isActive,
            limit: params.limit ?? 20,
          },
        }
      );
      return data;
    },
    placeholderData: (prev) => prev,
  });
}

export function useCreatePaymentCondition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreatePaymentConditionPayload) => {
      const { data } = await api.post<ApiResponse<PaymentCondition>>(
        "/payment-conditions",
        payload
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: paymentConditionKeys.lists(),
      });
    },
  });
}

export function useUpdatePaymentCondition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdatePaymentConditionPayload) => {
      const { data } = await api.patch<ApiResponse<PaymentCondition>>(
        `/payment-conditions/${id}`,
        payload
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: paymentConditionKeys.lists(),
      });
    },
  });
}

export function useDeletePaymentCondition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/payment-conditions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: paymentConditionKeys.lists(),
      });
    },
  });
}
