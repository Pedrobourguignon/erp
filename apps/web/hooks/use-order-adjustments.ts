import type { ApiResponse, OrderItemAdjustmentResult } from "@erp/shared-types";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import api from "@/lib/api";

import { orderKeys } from "./use-orders";

/**
 * Receber ou devolver a diferença no ato. A conta sai da forma de pagamento,
 * como numa venda: dinheiro passa pela gaveta do caixa.
 */
export type AdjustmentSettlementPayload = {
  paymentMethodId: string;
  /** Só quando há mais de um caixa aberto e o dinheiro é em espécie. */
  cashRegisterSessionId?: string;
};

export type ExchangeOrderItemPayload = {
  id: string; // pedido
  orderItemId: string;
  newProductId: string;
  newVariantId?: string;
  quantity?: number;
  reason?: string;
  settlement?: AdjustmentSettlementPayload;
};

export type ReturnOrderItemPayload = {
  id: string; // pedido
  orderItemId: string;
  quantity?: number;
  reason: string;
  settlement?: AdjustmentSettlementPayload;
};

/**
 * Uma troca/devolução mexe em quatro lugares: o pedido, o estoque, o
 * financeiro (título da diferença) e, se paga em dinheiro, a gaveta do caixa.
 */
function invalidateAfterAdjustment(queryClient: QueryClient, orderId: string) {
  queryClient.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
  queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
  queryClient.invalidateQueries({ queryKey: ["inventory"] });
  queryClient.invalidateQueries({ queryKey: ["products"] });
  queryClient.invalidateQueries({ queryKey: ["financial-entries"] });
  queryClient.invalidateQueries({ queryKey: ["cash-registers"] });
}

export function useExchangeOrderItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...payload }: ExchangeOrderItemPayload) => {
      const { data } = await api.post<ApiResponse<OrderItemAdjustmentResult>>(
        `/orders/${id}/exchange`,
        payload
      );
      return data;
    },
    onSuccess: (_data, variables) => invalidateAfterAdjustment(queryClient, variables.id),
  });
}

export function useReturnOrderItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason, ...payload }: ReturnOrderItemPayload) => {
      const trimmed = reason?.trim();
      if (!trimmed) {
        throw new Error("Informe o motivo da devolução.");
      }
      const { data } = await api.post<ApiResponse<OrderItemAdjustmentResult>>(
        `/orders/${id}/return-item`,
        { ...payload, reason: trimmed }
      );
      return data;
    },
    onSuccess: (_data, variables) => invalidateAfterAdjustment(queryClient, variables.id),
  });
}
