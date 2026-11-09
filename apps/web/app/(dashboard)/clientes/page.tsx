"use client";

import { formatDocument } from "@erp/validators";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, Eye, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useState } from "react";

import { Can } from "@/components/auth/can";
import { ImportCsvDialog } from "@/components/forms/import-csv-dialog";
import { ListPageHeader } from "@/components/layouts/list-page-header";
import {
  DataTable,
  type ColumnDef,
  type SortState,
} from "@/components/tables/data-table";
import { FilterField, FilterPanel } from "@/components/tables/filter-panel";
import { ListSearch } from "@/components/tables/list-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Money } from "@/components/ui/money";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import {
  useCustomers,
  useDeleteCustomer,
  customerKeys,
  type CustomerListItem,
  type CustomerSegment,
} from "@/hooks/use-customers";
import { useFilters } from "@/hooks/use-filters";
import { maskDocument, maskPhone } from "@/lib/masks";
import { getMutationErrorMessage } from "@/lib/mutation-error";

// ─── Config ─────────────────────────────────────────────────────────────

// ─── Actions cell ───────────────────────────────────────────────────────

function CustomerActions({ customer }: { customer: CustomerListItem }) {
  const router = useRouter();
  const deleteCustomer = useDeleteCustomer();
  const { addToast } = useToast();
  const [showDelete, setShowDelete] = useState(false);

  const handleDelete = async () => {
    try {
      await deleteCustomer.mutateAsync(customer.id);
      addToast("Cliente excluído com sucesso!", "success");
    } catch (err) {
      addToast(
        getMutationErrorMessage(
          err,
          "Erro ao excluir cliente."
        ),
        "error"
      );
    }
  };

  return (
    <div className="flex items-center justify-end gap-1">
      <Tooltip content="Ver detalhes">
        <Button variant="ghost" size="icon" className="h-10 w-10 md:h-8 md:w-8" onClick={() => router.push(`/clientes/${customer.id}`)}>
          <Eye className="h-4 w-4" />
        </Button>
      </Tooltip>
      <Can permission="customers:delete">
        <Tooltip content="Excluir">
          <Button variant="ghost" action="delete" size="icon" className="h-10 w-10 text-destructive md:h-8 md:w-8" onClick={() => setShowDelete(true)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </Tooltip>
      </Can>
      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title="Excluir Cliente"
        message={`Deseja excluir "${customer.name}"? Esta ação não pode ser desfeita.`}
        destructive
        confirmLabel="Excluir"
        loading={deleteCustomer.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ─── Columns ────────────────────────────────────────────────────────────

const columns: ColumnDef<CustomerListItem>[] = [
  {
    id: "name",
    role: "primary",
    maxCh: 24,
    header: "Nome",
    accessor: "name",
    sortable: true,
    cell: (row) => (
      <Link href={`/clientes/${row.id}`} className="font-medium text-primary hover:underline">
        {row.name}
      </Link>
    ),
  },
  {
    id: "type",
    role: "status",
    header: "Tipo",
    accessor: "documentType",
    cell: (row) => (
      <Badge variant="outline" className="text-xs">
        {row.documentType === "CPF" ? "Pessoa Física" : "Pessoa Jurídica"}
      </Badge>
    ),
  },
  {
    id: "document",
    role: "secondary",
    header: "Documento",
    accessor: "document",
    cell: (row) => (
      <span className="font-mono text-xs">
        {/* VD-16: sem `documentType` o fallback mostrava o documento cru.
            `formatDocument` deduz pelo número de dígitos. */}
        {row.documentType
          ? maskDocument(row.document, row.documentType)
          : formatDocument(row.document)}
      </span>
    ),
  },
  {
    id: "email",
    role: "meta",
    maxCh: 20,
    header: "E-mail",
    accessor: "email",
    cell: (row) => (
      <span className="text-sm text-muted-foreground">{row.email}</span>
    ),
  },
  {
    id: "phone",
    role: "meta",
    header: "Telefone",
    accessor: "phone",
    cell: (row) => (
      <span className={row.phone ? "text-sm" : "text-sm text-muted-foreground"}>
        {row.phone ? maskPhone(row.phone) : "—"}
      </span>
    ),
  },
  {
    id: "totalOrders",
    role: "hidden-mobile",
    header: "Pedidos",
    accessor: "totalOrders",
    sortable: true,
    className: "text-right",
    nowrap: true,
    headerClassName: "text-right",
  },
  {
    id: "totalSpent",
    role: "value",
    header: "Total Gasto",
    accessor: "totalSpent",
    sortable: true,
    cell: (row) => <Money value={row.totalSpent} className="font-medium" />,
    className: "text-right",
    nowrap: true,
    headerClassName: "text-right",
  },
  {
    id: "actions",
    role: "actions",
      noTruncate: true,
    header: "Ações",
    cell: (row) => <CustomerActions customer={row} />,
    className: "text-right w-[100px]",
    nowrap: true,
    headerClassName: "text-right",
  },
];

// ─── Filter options ──────────────────────────────────────────────────────

const segmentOptions: { value: CustomerSegment | ""; label: string }[] = [
  { value: "", label: "Todos os segmentos" },
  { value: "regular", label: "Regular" },
  { value: "vip", label: "VIP" },
  { value: "wholesale", label: "Atacado" },
  { value: "inactive", label: "Inativo" },
];

// ─── Page ───────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState<SortState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const queryClient = useQueryClient();

  const resetPage = useCallback(() => setPage(1), []);
  const filters = useFilters({ search: "", segment: "", documentType: "" }, resetPage);

  const { data, isLoading, error, refetch } = useCustomers({
    page,
    limit,
    search: filters.values.search || undefined,
    segment: (filters.values.segment || undefined) as CustomerSegment | undefined,
    // FT-07: `CustomerQueryDto` aceita `documentType` e a tela não oferecia.
    documentType: (filters.values.documentType || undefined) as
      | "CPF"
      | "CNPJ"
      | undefined,
    sortBy: sort?.column,
    sortOrder: sort?.direction,
  });

  const customers = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  return (
    <div className="space-y-4">
      <ListPageHeader
        title="Clientes"
        actions={
          <>
          <Can permission="customers:create">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Importar CSV
            </Button>
            <Button onClick={() => router.push("/clientes/novo")}>
              <Plus className="mr-2 h-4 w-4" />
              Novo Cliente
            </Button>
          </Can>
          </>
        }
      />

      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        domain="customers"
        title="Importar clientes via CSV"
        onCompleted={() =>
          queryClient.invalidateQueries({ queryKey: customerKeys.lists() })
        }
      />


      <DataTable<CustomerListItem>
        filters={
          <FilterPanel
            values={filters.values}
            onClear={filters.clear}
            search={
              <ListSearch
                value={filters.values.search}
                onChange={(val) => filters.set("search", val)}
                placeholder="Buscar por nome, e-mail ou documento..."
              />
            }
          >
            <FilterField label="Segmento">
              {/* FT-09: era `<select>` nativo, com `""` como sentinela de "todos"
                  enquanto o resto do sistema usa `__all`. */}
              <Select
                value={filters.values.segment || "__all"}
                onValueChange={(v) => filters.set("segment", v === "__all" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos os segmentos" />
                </SelectTrigger>
                <SelectContent>
                  {segmentOptions.map((opt) => (
                    <SelectItem key={opt.value || "__all"} value={opt.value || "__all"}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Tipo">
              <Select
                value={filters.values.documentType || "__all"}
                onValueChange={(v) => filters.set("documentType", v === "__all" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos os tipos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos os tipos</SelectItem>
                  <SelectItem value="CPF">Pessoa Física</SelectItem>
                  <SelectItem value="CNPJ">Pessoa Jurídica</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </FilterPanel>
        }
        columns={columns}
        data={customers}
        pagination={{ page, limit, total }}
        onPageChange={setPage}
        onLimitChange={(l) => { setLimit(l); setPage(1); }}
        sort={sort}
        onSortChange={setSort}
        exportCsv
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
      />
    </div>
  );
}
