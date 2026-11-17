import type { ApiResponse, PaginatedResponse } from "@erp/shared-types";
import type { CardReceiveMode } from "@erp/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import api from "@/lib/api";

import { paymentMethodKeys } from "./use-payment-methods";

// ─── Types ─────────────────────────────────────────────────────────────

export interface CardMachineRate {
  installments: number;
  feePercentage: number;
}

export interface CardMachine {
  id: string;
  name: string;
  provider: string | null;
  debitFeePercentage: number;
  /** 0 = cai na hora. */
  debitSettlementDays: number;
  creditReceiveMode: CardReceiveMode;
  creditSettlementDays: number;
  isActive: boolean;
  /** Taxa total de cada número de parcelas, de 1x até o máximo. */
  rates: CardMachineRate[];
  _count?: { paymentMethods: number };
}

export interface CardMachineListParams {
  search?: string;
  isActive?: boolean;
}

export interface CardMachinePayload {
  name: string;
  provider?: string;
  debitFeePercentage: number;
  debitSettlementDays: number;
  creditReceiveMode: CardReceiveMode;
  creditSettlementDays: number;
  rates: CardMachineRate[];
  isActive?: boolean;
}

export interface DeleteCardMachineResult {
  id: string;
  deactivated: boolean;
  message: string;
}

// ─── Query keys ────────────────────────────────────────────────────────

export const cardMachineKeys = {
  all: ["card-machines"] as const,
  lists: () => [...cardMachineKeys.all, "list"] as const,
  list: (params: CardMachineListParams) => [...cardMachineKeys.lists(), params] as const,
};

// ─── Hooks ─────────────────────────────────────────────────────────────

export function useCardMachines(params: CardMachineListParams = {}) {
  return useQuery({
    queryKey: cardMachineKeys.list(params),
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<CardMachine>>("/card-machines", {
        params: {
          search: params.search || undefined,
          isActive: params.isActive,
          limit: 100,
        },
      });
      return data;
    },
    placeholderData: (prev) => prev,
  });
}

/** O método de pagamento mostra a maquininha: as duas listas mudam juntas. */
function useInvalidateMachines() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: cardMachineKeys.lists() });
    queryClient.invalidateQueries({ queryKey: paymentMethodKeys.lists() });
  };
}

export function useCreateCardMachine() {
  const invalidate = useInvalidateMachines();
  return useMutation({
    mutationFn: async (payload: CardMachinePayload) => {
      const { data } = await api.post<ApiResponse<CardMachine>>("/card-machines", payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateCardMachine() {
  const invalidate = useInvalidateMachines();
  return useMutation({
    mutationFn: async ({ id, ...payload }: Partial<CardMachinePayload> & { id: string }) => {
      const { data } = await api.patch<ApiResponse<CardMachine>>(
        `/card-machines/${id}`,
        payload
      );
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteCardMachine() {
  const invalidate = useInvalidateMachines();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete<ApiResponse<DeleteCardMachineResult>>(
        `/card-machines/${id}`
      );
      return data;
    },
    onSuccess: invalidate,
  });
}
