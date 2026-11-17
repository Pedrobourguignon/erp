import type { ReceiptFormat } from "@erp/constants";
import type { ApiResponse } from "@erp/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import api from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────

export type TaxRegime =
  | "SIMPLES_NACIONAL"
  | "LUCRO_PRESUMIDO"
  | "LUCRO_REAL"
  | "MEI";

export interface Tenant {
  id: string;
  name: string;
  document: string;
  email: string;
  phone: string | null;
  plan: string;
  status: string;
  taxRegime: TaxRegime;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressNeighborhood: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZipCode: string | null;
  receiptFormat: ReceiptFormat;
  receiptFooter: string | null;
}

export interface TenantUsageLimit {
  key: "users" | "products" | "orders" | "warehouses";
  label: string;
  current: number;
  max: number;
}

export interface TenantUsage {
  plan: string;
  status: string;
  trialEndsAt: string | null;
  limits: TenantUsageLimit[];
}

export type UpdateTenantPayload = Partial<
  Pick<
    Tenant,
    | "name"
    | "document"
    | "email"
    | "phone"
    | "taxRegime"
    | "addressStreet"
    | "addressNumber"
    | "addressComplement"
    | "addressNeighborhood"
    | "addressCity"
    | "addressState"
    | "addressZipCode"
    | "receiptFormat"
  >
> & { receiptFooter?: string };

// ─── Query keys ────────────────────────────────────────────────────────

export const tenantKeys = {
  all: ["tenant"] as const,
  current: () => [...tenantKeys.all, "current"] as const,
  usage: () => [...tenantKeys.all, "usage"] as const,
};

// ─── Hooks ─────────────────────────────────────────────────────────────

export function useTenant() {
  return useQuery({
    queryKey: tenantKeys.current(),
    queryFn: async () => {
      const { data } = await api.get<ApiResponse<Tenant>>("/tenants/current");
      return data.data;
    },
  });
}

export function useTenantUsage() {
  return useQuery({
    queryKey: tenantKeys.usage(),
    queryFn: async () => {
      const { data } = await api.get<ApiResponse<TenantUsage>>(
        "/tenants/current/usage"
      );
      return data.data;
    },
  });
}

export function useUpdateTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: UpdateTenantPayload) => {
      const { data } = await api.patch<ApiResponse<Tenant>>(
        "/tenants/current",
        payload
      );
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tenantKeys.all });
    },
  });
}
