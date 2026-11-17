import type {
  PaginatedResponse,
  ApiResponse,
  InventoryItem,
  Warehouse as SharedWarehouse,
} from "@erp/shared-types";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import api from "@/lib/api";

// ─── Types ──────────────────────────────────────────────────────────────

// Mirrors the MovementType enum in schema.prisma — keep all 6 values in sync.
export type MovementType =
  | "ENTRY"
  | "EXIT"
  | "ADJUSTMENT"
  | "TRANSFER"
  | "RETURN"
  | "PRODUCTION";

export type MovementReason =
  | "PURCHASE"
  | "SALE"
  | "TRANSFER"
  | "ADJUSTMENT"
  | "RETURN_CUSTOMER"
  | "RETURN_SUPPLIER"
  | "DAMAGE"
  | "THEFT"
  | "PRODUCTION"
  | "INITIAL"
  | "COUNT";

export type AlertStatus = "ACTIVE" | "RESOLVED";

export interface StockMovement {
  id: string;
  productId: string;
  productName: string | null;
  productSku: string | null;
  /** Destination warehouse for an entry, origin for an exit. */
  warehouseId: string | null;
  warehouseName: string | null;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  type: MovementType;
  reason: MovementReason;
  quantity: number;
  unitCost: number | null;
  userId: string | null;
  /** "Sistema" for stock moved by a sale or a shipment. */
  userName: string;
  notes?: string | null;
  createdAt: string;
}

/**
 * O contrato vem de `@erp/shared-types` (AE-12b). Redigitar a resposta dentro
 * de `app/` foi como as três colunas vazias do lote 7 nasceram: o tipo local
 * dizia que o campo existia e ninguém conferia contra a API.
 */
export interface Warehouse extends SharedWarehouse {
  createdAt: string;
}

export interface StockAlert {
  id: string;
  productId: string;
  productName: string | null;
  productSku: string | null;
  warehouseId: string;
  warehouseName: string | null;
  currentStock: number;
  minStock: number;
  isResolved: boolean;
  /** Spelled-out `isResolved`; the list badge reads this. */
  status: AlertStatus;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface MovementListParams {
  page?: number;
  limit?: number;
  type?: MovementType;
  reason?: MovementReason;
  productId?: string;
  warehouseId?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface AlertListParams {
  page?: number;
  limit?: number;
  status?: AlertStatus;
}

export interface CreateMovementPayload {
  productId: string;
  /** Tamanho/cor: o saldo de um produto com variações é por variação. */
  variantId?: string;
  /** Required for ENTRY movements (destination). */
  toWarehouseId?: string;
  /** Required for EXIT movements (source). */
  fromWarehouseId?: string;
  type: MovementType;
  reason: MovementReason;
  quantity: number;
  unitCost?: number;
  notes?: string;
}

export interface TransferStockPayload {
  productId: string;
  /** Tamanho/cor: o saldo de um produto com variações é por variação. */
  variantId?: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  notes?: string;
}

/**
 * AE-25: `countedQuantity` is the balance on the shelf, not the difference.
 * The server derives the delta from the balance it reads inside the
 * transaction — computing it here would write a stale number whenever a sale
 * lands between opening the form and saving it.
 */
export interface AdjustStockPayload {
  productId: string;
  /** Tamanho/cor: o saldo de um produto com variações é por variação. */
  variantId?: string;
  warehouseId: string;
  countedQuantity: number;
  reason: "COUNT" | "DAMAGE" | "THEFT" | "ADJUSTMENT";
  notes: string;
}

export interface AdjustStockResult extends StockMovement {
  previousQuantity: number;
  newQuantity: number;
  delta: number;
}

export interface CreateWarehousePayload {
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  isDefault?: boolean;
}

// ─── Query keys ─────────────────────────────────────────────────────────

export const inventoryKeys = {
  all: ["inventory"] as const,
  items: (params: Record<string, unknown>) => [...inventoryKeys.all, "items", params] as const,
  movements: (params: MovementListParams) => [...inventoryKeys.all, "movements", params] as const,
  warehouses: () => [...inventoryKeys.all, "warehouses"] as const,
  alerts: (params: AlertListParams) => [...inventoryKeys.all, "alerts", params] as const,
};

// ─── Hooks ──────────────────────────────────────────────────────────────

export function useInventoryItems(params: Record<string, unknown> = {}) {
  return useQuery({
    queryKey: inventoryKeys.items(params),
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<InventoryItem>>("/inventory", { params });
      return data;
    },
    placeholderData: (prev) => prev,
  });
}

export function useStockMovements(params: MovementListParams = {}) {
  return useQuery({
    queryKey: inventoryKeys.movements(params),
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<StockMovement>>("/inventory/movements", {
        params: {
          page: params.page ?? 1,
          limit: params.limit ?? 20,
          type: params.type || undefined,
          reason: params.reason || undefined,
          productId: params.productId || undefined,
          warehouseId: params.warehouseId || undefined,
          dateFrom: params.dateFrom || undefined,
          dateTo: params.dateTo || undefined,
        },
      });
      return data;
    },
    placeholderData: (prev) => prev,
  });
}

export function useWarehouses() {
  return useQuery({
    queryKey: inventoryKeys.warehouses(),
    queryFn: async () => {
      const { data } = await api.get<ApiResponse<Warehouse[]>>("/inventory/warehouses");
      return data;
    },
  });
}

export function useStockAlerts(params: AlertListParams = {}) {
  return useQuery({
    queryKey: inventoryKeys.alerts(params),
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<StockAlert>>("/inventory/alerts", { params });
      return data;
    },
    placeholderData: (prev) => prev,
  });
}

export function useCreateMovement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateMovementPayload) => {
      const { data } = await api.post<ApiResponse<StockMovement>>(
        "/inventory/movement",
        payload
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useTransferStock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: TransferStockPayload) => {
      const { data } = await api.post<ApiResponse<StockMovement>>(
        "/inventory/transfer",
        payload
      );
      return data.data;
    },
    onSuccess: () => {
      // Both warehouses moved — invalidate the whole prefix, not only the
      // movement list (the FN-11 mistake).
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export function useAdjustStock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: AdjustStockPayload) => {
      const { data } = await api.post<ApiResponse<AdjustStockResult>>(
        "/inventory/adjustment",
        payload
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

export interface UpdateWarehousePayload {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  isDefault?: boolean;
  isActive?: boolean;
}

export function useUpdateWarehouse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...payload }: UpdateWarehousePayload & { id: string }) => {
      const { data } = await api.patch<ApiResponse<Warehouse>>(
        `/inventory/warehouses/${id}`,
        payload
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

/** Answers whether the warehouse was deleted or merely deactivated (AE-12d). */
export interface RemoveWarehouseResult {
  success: boolean;
  deactivated: boolean;
  message: string;
}

export function useDeleteWarehouse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete<RemoveWarehouseResult>(
        `/inventory/warehouses/${id}`
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useSetMinStock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, minStock }: { itemId: string; minStock: number }) => {
      const { data } = await api.patch<ApiResponse<InventoryItem>>(
        `/inventory/items/${itemId}/min-stock`,
        { minStock }
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useCreateWarehouse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateWarehousePayload) => {
      const { data } = await api.post<ApiResponse<Warehouse>>(
        "/inventory/warehouses",
        payload
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.warehouses() });
    },
  });
}
