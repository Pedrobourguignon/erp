import type { ApiResponse } from "@erp/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import api from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────

export type ImportDomain = "products" | "customers" | "expenses";

export type ImportStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "COMPLETED_WITH_ERRORS"
  | "FAILED";

/**
 * One entry of the report. The CSV importer only writes errors (no `severity`);
 * the spreadsheet importer also writes warnings and file-wide notes.
 */
export interface ImportRowError {
  line: number;
  message: string;
  severity?: "error" | "warning" | "info";
  code?: string;
}

export interface ImportJob {
  id: string;
  type: "PRODUCTS" | "CUSTOMERS" | "EXPENSES";
  status: ImportStatus;
  fileName: string;
  totalRows: number;
  successRows: number;
  errorRows: number;
  errors: ImportRowError[] | null;
  createdAt: string;
}

// ─── Query keys ────────────────────────────────────────────────────────

export const importKeys = {
  all: ["imports"] as const,
  lists: () => [...importKeys.all, "list"] as const,
  list: (type?: ImportDomain) => [...importKeys.lists(), type ?? "all"] as const,
  detail: (id: string) => [...importKeys.all, "detail", id] as const,
};

const ACTIVE_STATUSES: ImportStatus[] = ["PENDING", "PROCESSING"];

// ─── Queries ───────────────────────────────────────────────────────────

export function useImports(type?: ImportDomain) {
  return useQuery({
    queryKey: importKeys.list(type),
    queryFn: async () => {
      const { data } = await api.get<ApiResponse<ImportJob[]>>("/imports", {
        params: { type },
      });
      return data.data;
    },
  });
}

/** Polls the job while it is still processing. */
export function useImportJob(id: string | null) {
  return useQuery({
    queryKey: importKeys.detail(id ?? ""),
    enabled: !!id,
    queryFn: async () => {
      const { data } = await api.get<ApiResponse<ImportJob>>(`/imports/${id}`);
      return data.data;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ACTIVE_STATUSES.includes(status) ? 1500 : false;
    },
  });
}

// ─── Mutation ──────────────────────────────────────────────────────────

export function useUploadImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ domain, file }: { domain: ImportDomain; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);

      const baseUrl =
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
      const token =
        typeof window !== "undefined" ? localStorage.getItem("erp_token") : null;

      const res = await fetch(`${baseUrl}/imports/${domain}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(body?.message ?? "Falha ao enviar o arquivo");
      }

      const data = (await res.json()) as ApiResponse<ImportJob>;
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: importKeys.lists() });
    },
  });
}
