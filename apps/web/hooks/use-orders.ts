import type {
  Order,
  OrderStatus,
  OrderStatusHistoryEntry,
  OrderOrigin,
  PaginatedResponse,
  ApiResponse,
} from "@erp/shared-types";
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import api from "@/lib/api";

export type { OrderStatusHistoryEntry };

// ─── Extended order types for frontend ──────────────────────────────────

export interface OrderListItem extends Order {
  customerName?: string;
  customer?: { id: string; name: string; email?: string };
  createdAt: string;
  itemCount: number;
  marketplace?: string;
}

export interface OrderPayment {
  id: string;
  paymentMethod: { id: string; name: string; type: string };
  paymentCondition?: { id: string; name: string; code: string };
  financialAccount?: { id: string; name: string };
  amount: number;
  installments?: number;
  authorizationCode?: string;
}

export interface OrderDetail extends OrderListItem {
  items: OrderItem[];
  customer: OrderCustomer;
  payments?: OrderPayment[];
  receivables: OrderReceivable[];
  /**
   * VD-06: the API returns `statusHistory`, never `history`, and the shipping
   * fields live on the order root — see `Order` in `@erp/shared-types`.
   */
  statusHistory: OrderStatusHistoryEntry[];
  seller?: { id: string; name: string };
  salesChannel?: { id: string; name: string; type: string };
  /** Caixa em que a venda foi registrada — onde o dinheiro de uma troca volta, se ainda aberto. */
  cashRegisterSessionId?: string | null;
}

export interface OrderItem {
  id: string;
  productId: string;
  /** Tamanho/cor vendido — a troca de tamanho oferece as outras variantes. */
  variantId?: string | null;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  totalPrice: number;
  imageUrl?: string;
  product?: { id: string; name: string; sku: string };
}

export interface CustomerAddress {
  id?: string;
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

export interface OrderCustomer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  document?: string;
  addresses?: CustomerAddress[];
}

export interface OrderReceivable {
  id: string;
  description?: string;
  installment?: number;
  totalInstallments?: number;
  dueDate: string;
  amount: number;
  paidAmount?: number;
  status: string;
  method?: string;
  paymentMethod?: { name: string };
  paidAt?: string;
}

// ─── Params ─────────────────────────────────────────────────────────────

export interface OrderListParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  status?: OrderStatus;
  origin?: OrderOrigin;
  customerId?: string;
  dateFrom?: string;
  dateTo?: string;
}

// ─── Query keys ─────────────────────────────────────────────────────────

export const orderKeys = {
  all: ["orders"] as const,
  lists: () => [...orderKeys.all, "list"] as const,
  list: (params: OrderListParams) => [...orderKeys.lists(), params] as const,
  details: () => [...orderKeys.all, "detail"] as const,
  detail: (id: string) => [...orderKeys.details(), id] as const,
};

// ─── Hooks ──────────────────────────────────────────────────────────────

export function useOrders(params: OrderListParams = {}) {
  return useQuery({
    queryKey: orderKeys.list(params),
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<OrderListItem>>(
        "/orders",
        {
          params: {
            page: params.page ?? 1,
            limit: params.limit ?? 20,
            search: params.search || undefined,
            sortBy: params.sortBy || undefined,
            sortOrder: params.sortOrder || undefined,
            status: params.status || undefined,
            origin: params.origin || undefined,
            customerId: params.customerId || undefined,
            dateFrom: params.dateFrom || undefined,
            dateTo: params.dateTo || undefined,
          },
        }
      );
      return data;
    },
    placeholderData: (prev) => prev,
  });
}

export function useOrder(
  id: string,
  options?: Omit<UseQueryOptions<ApiResponse<OrderDetail>>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: orderKeys.detail(id),
    queryFn: async () => {
      const { data } = await api.get<ApiResponse<OrderDetail>>(
        `/orders/${id}`
      );
      return data;
    },
    enabled: !!id,
    ...options,
  });
}

/**
 * Every status change except cancellation. Cancelling has side effects on stock
 * and on the receivable, so it has its own endpoint — see `useCancelOrder`.
 */
export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
      note,
    }: {
      id: string;
      status: Exclude<OrderStatus, "CANCELLED">;
      note?: string;
    }) => {
      const { data } = await api.patch<ApiResponse<Order>>(
        `/orders/${id}/status`,
        { status, notes: note }
      );
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: orderKeys.detail(variables.id),
      });
      // SHIPPED turns the reservation into an actual stock exit, and DELIVERED /
      // COMPLETED settle the receivable: refresh both domains.
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["financial-entries"] });
    },
  });
}

/**
 * VD-01: cancelling releases the reserved stock and cancels the receivable.
 * Only `PATCH /orders/:id/cancel` does that — `PATCH /status` used to be called
 * here and silently left both behind.
 */
export function useCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const trimmed = reason?.trim();
      if (!trimmed) {
        throw new Error("Informe o motivo do cancelamento.");
      }
      const { data } = await api.patch<ApiResponse<Order>>(
        `/orders/${id}/cancel`,
        { reason: trimmed }
      );
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: orderKeys.detail(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["financial-entries"] });
    },
  });
}

export interface ReverseSaleResult {
  orderId: string;
  status: OrderStatus;
  returnedItems: number;
  refundedAmount: number;
  /** Título do reembolso; o pagamento é feito na baixa, em /financeiro/lancamentos. */
  payableId: string | null;
}

/**
 * VD-14: undoing a finished sale — a counter sale born `COMPLETED` or a
 * delivered order being returned. Unlike a plain status change, it puts the
 * goods back in stock, cancels the receivables and abre um título de reembolso,
 * so it has its own endpoint. O dinheiro só se move na baixa desse título.
 */
export function useReverseSale() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const trimmed = reason?.trim();
      if (!trimmed) {
        throw new Error("Informe o motivo do estorno.");
      }
      const { data } = await api.post<ApiResponse<ReverseSaleResult>>(
        `/orders/${id}/reverse`,
        { reason: trimmed }
      );
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: orderKeys.detail(variables.id),
      });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["financial-entries"] });
      queryClient.invalidateQueries({ queryKey: ["cash-registers"] });
    },
  });
}

// ─── Create order ──────────────────────────────────────────────────────

export interface CreateOrderItemPayload {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

export interface CreateOrderPaymentPayload {
  paymentMethodId: string;
  paymentConditionId?: string;
  financialAccountId?: string;
  amount: number;
  installments?: number;
  authorizationCode?: string;
}

export interface CreateOrderPayload {
  customerId?: string;
  origin: "MANUAL" | "BALCAO";
  items: CreateOrderItemPayload[];
  payments?: CreateOrderPaymentPayload[];
  shippingMethod?: string;
  shippingCost: number;
  /** Order-level discount, applied on top of per-item discounts. */
  discount?: number;
  notes?: string;
  /**
   * Caixa em que a venda é registrada. Obrigatório quando há mais de um caixa
   * aberto — a API recusa adivinhar por conta própria (FN-05).
   */
  cashRegisterSessionId?: string;
}

export function useCreateOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateOrderPayload) => {
      const { data } = await api.post<ApiResponse<Order>>("/orders", payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists() });
    },
  });
}

export function useRecentOrders(limit: number = 5) {
  return useQuery({
    queryKey: ["orders", "recent", limit],
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<OrderListItem>>(
        "/orders",
        {
          params: { page: 1, limit, sortBy: "createdAt", sortOrder: "desc" },
        }
      );
      return data;
    },
  });
}
