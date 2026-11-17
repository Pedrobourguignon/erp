import type { ApiResponse, ExchangeReceipt, SaleReceipt } from "@erp/shared-types";
import { useMutation } from "@tanstack/react-query";

import api from "@/lib/api";

/**
 * Issuing a receipt is a POST: each call is one more copy, counted and audited
 * on the server (the second one onwards prints "2ª VIA").
 */
export function usePrintSaleReceipt() {
  return useMutation({
    mutationFn: async (orderId: string) => {
      const { data } = await api.post<ApiResponse<SaleReceipt>>(`/orders/${orderId}/receipt`);
      return data.data;
    },
  });
}

export function usePrintAdjustmentReceipt() {
  return useMutation({
    mutationFn: async ({ orderId, adjustmentId }: { orderId: string; adjustmentId: string }) => {
      const { data } = await api.post<ApiResponse<ExchangeReceipt>>(
        `/orders/${orderId}/adjustments/${adjustmentId}/receipt`
      );
      return data.data;
    },
  });
}
