"use client";

import type { OrderStatus, OrderOrigin } from "@erp/shared-types";
import {
  Eye,
  Store,
  Globe,
  ShoppingBag,
  Smartphone,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useState } from "react";

import { SearchableSelectBase } from "@/components/forms/searchable-select";
import { ListPageHeader } from "@/components/layouts/list-page-header";
import { StatusActions } from "@/components/orders/status-actions";
import { PrintReceiptButton } from "@/components/receipts/print-receipt-button";
import {
  DataTable,
  type ColumnDef,
  type SortState,
} from "@/components/tables/data-table";
import { DateRangeFilter } from "@/components/tables/date-range-filter";
import { FilterField, FilterPanel } from "@/components/tables/filter-panel";
import { ListSearch } from "@/components/tables/list-search";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import { useFilters } from "@/hooks/use-filters";
import { useOrders, type OrderListItem } from "@/hooks/use-orders";
import { searchCustomers } from "@/lib/entity-search";
import { formatDateTime, isInvertedRange } from "@/lib/utils";

// ─── Origin icons ───────────────────────────────────────────────────────

const originIcons: Record<string, React.ReactNode> = {
  MANUAL: <Store className="h-4 w-4 text-slate-500" />,
  BALCAO: <Store className="h-4 w-4 text-emerald-500" />,
  SHOPIFY: <Globe className="h-4 w-4 text-blue-500" />,
  NUVEMSHOP: <Globe className="h-4 w-4 text-blue-500" />,
  WOOCOMMERCE: <Globe className="h-4 w-4 text-blue-500" />,
  MERCADO_LIVRE: <ShoppingBag className="h-4 w-4 text-orange-500" />,
  SHOPEE: <ShoppingBag className="h-4 w-4 text-orange-500" />,
  AMAZON: <ShoppingBag className="h-4 w-4 text-orange-500" />,
  MAGALU: <ShoppingBag className="h-4 w-4 text-orange-500" />,
  API: <Smartphone className="h-4 w-4 text-purple-500" />,
};

const originLabels: Record<string, string> = {
  MANUAL: "Manual",
  BALCAO: "Balcão",
  SHOPIFY: "Shopify",
  NUVEMSHOP: "Nuvemshop",
  WOOCOMMERCE: "WooCommerce",
  MERCADO_LIVRE: "Mercado Livre",
  SHOPEE: "Shopee",
  AMAZON: "Amazon",
  MAGALU: "Magalu",
  API: "API",
};

// ─── Columns ────────────────────────────────────────────────────────────

const columns: ColumnDef<OrderListItem>[] = [
  {
    id: "orderNumber",
    role: "primary",
    header: "Pedido",
    accessor: "orderNumber",
    sortable: true,
    cell: (row) => (
      <Link
        href={`/vendas/pedidos/${row.id}`}
        className="font-medium text-primary hover:underline"
      >
        #{row.orderNumber}
      </Link>
    ),
  },
  {
    id: "customerName",
    role: "secondary",
    maxCh: 26,
    header: "Cliente",
    accessor: "customerName",
    sortable: true,
    cell: (row) => (
      <span>{row.customerName ?? row.customer?.name ?? "-"}</span>
    ),
  },
  {
    id: "createdAt",
    role: "meta",
    header: "Data",
    accessor: "createdAt",
    sortable: true,
    cell: (row) => (
      <span className="text-sm text-muted-foreground">
        {formatDateTime(row.createdAt)}
      </span>
    ),
  },
  {
    id: "origin",
    role: "meta",
    header: "Origem",
    accessor: "origin",
    cell: (row) => (
      <div className="flex items-center gap-2">
        {originIcons[row.origin] ?? null}
        <span className="text-sm">{originLabels[row.origin] ?? row.origin}</span>
        {row.marketplace ? <span className="text-xs text-muted-foreground">
            ({row.marketplace})
          </span> : null}
      </div>
    ),
  },
  {
    id: "status",
    role: "status",
    header: "Status",
    accessor: "status",
    cell: (row) => <StatusBadge status={row.status} />,
  },
  {
    id: "totalAmount",
    role: "value",
    header: "Total",
    accessor: "totalAmount",
    sortable: true,
    cell: (row) => (
      <Money value={row.totalAmount} className="font-medium" />
    ),
    className: "text-right",
    nowrap: true,
    headerClassName: "text-right",
  },
  {
    id: "actions",
    role: "actions",
      noTruncate: true,
    header: "Ações",
    cell: (row) => <QuickActions order={row} />,
    className: "text-right",
    nowrap: true,
    headerClassName: "text-right",
  },
];

// ─── Quick actions per row ──────────────────────────────────────────────

function QuickActions({ order }: { order: OrderListItem }) {
  const router = useRouter();

  return (
    <div className="flex items-center justify-end gap-1">
      <Tooltip content="Ver detalhes">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 md:h-8 md:w-8"
          onClick={() => router.push(`/vendas/pedidos/${order.id}`)}
        >
          <Eye className="h-4 w-4" />
        </Button>
      </Tooltip>
      {/* Pedido cancelado não tem recibo: não houve venda a comprovar. */}
      {order.status !== "CANCELLED" && <PrintReceiptButton orderId={order.id} iconOnly />}
      {/* VD-02: the row used to offer "Enviar" for CONFIRMED and PICKING, both
          rejected by the API. The available actions now come from the API. */}
      <StatusActions
        orderId={order.id}
        orderNumber={order.orderNumber}
        allowedTransitions={order.allowedTransitions}
        origin={order.origin}
        status={order.status}
        size="icon"
      />
    </div>
  );
}

// ─── Filter options ─────────────────────────────────────────────────────

const statusOptions: { value: OrderStatus | ""; label: string }[] = [
  { value: "", label: "Todos os status" },
  { value: "PENDING", label: "Pendente" },
  { value: "CONFIRMED", label: "Confirmado" },
  { value: "PICKING", label: "Separando" },
  { value: "PACKED", label: "Embalado" },
  { value: "SHIPPED", label: "Enviado" },
  { value: "DELIVERED", label: "Entregue" },
  { value: "COMPLETED", label: "Concluído" },
  { value: "CANCELLED", label: "Cancelado" },
  { value: "RETURNED", label: "Devolvido" },
];

const originOptions: { value: OrderOrigin | ""; label: string }[] = [
  { value: "", label: "Todas as origens" },
  { value: "MANUAL", label: "Manual" },
  { value: "BALCAO", label: "Balcão" },
  { value: "MERCADO_LIVRE", label: "Mercado Livre" },
  { value: "SHOPEE", label: "Shopee" },
  { value: "AMAZON", label: "Amazon" },
  { value: "MAGALU", label: "Magalu" },
  { value: "SHOPIFY", label: "Shopify" },
  { value: "NUVEMSHOP", label: "Nuvemshop" },
  { value: "WOOCOMMERCE", label: "WooCommerce" },
  { value: "API", label: "API" },
];

// ─── Page ───────────────────────────────────────────────────────────────

export default function OrdersListPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState<SortState | null>(null);
  const resetPage = useCallback(() => setPage(1), []);
  const filters = useFilters(
    { search: "", status: "", origin: "", customerId: "", dateFrom: "", dateTo: "" },
    resetPage
  );
  const { dateFrom, dateTo } = filters.values;

  const { data, isLoading, error, refetch } = useOrders({
    page,
    limit,
    search: filters.values.search || undefined,
    sortBy: sort?.column,
    sortOrder: sort?.direction,
    status: (filters.values.status || undefined) as OrderStatus | undefined,
    origin: (filters.values.origin || undefined) as OrderOrigin | undefined,
    // FT-04: a busca livre procura número do pedido e nome do cliente juntos,
    // então "Silva" trazia pedidos de três clientes diferentes.
    customerId: filters.values.customerId || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const orders = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const invertedRange = isInvertedRange(dateFrom, dateTo);

  return (
    <div className="space-y-4">
      {/* Header */}
      <ListPageHeader
        title="Pedidos"
        actions={
          <>
          <Link href="/vendas/balcao">
            <Button variant="outline">
              <Store className="mr-2 h-4 w-4" />
              Venda Balcão
            </Button>
          </Link>
          <Link href="/vendas/pedidos/novo">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nova Venda
            </Button>
          </Link>
          </>
        }
      />


      {/* Table */}
      <DataTable<OrderListItem>
        filters={
          <FilterPanel
            values={filters.values}
            onClear={filters.clear}
            search={
              <ListSearch
                value={filters.values.search}
                onChange={(val) => filters.set("search", val)}
                placeholder="Buscar por número ou cliente..."
              />
            }
          >
            {/*
              O campo largo vem primeiro para o grid fechar as linhas: no fim
              da lista ele não cabia no que sobrava e descia inteiro, deixando
              um buraco no meio do painel.
            */}
            <FilterField label="Cliente" span={2}>
              <SearchableSelectBase
                value={filters.values.customerId}
                onChange={(value) => filters.set("customerId", value)}
                loadOptions={searchCustomers}
                placeholder="Todos os clientes"
              />
            </FilterField>

            <FilterField label="Status">
              {/* FT-09: era um `<select>` nativo, destoando do resto do sistema e
                  usando `""` como sentinela de "todos" em vez de `__all`. */}
              <Select
                value={filters.values.status || "__all"}
                onValueChange={(v) => filters.set("status", v === "__all" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos os status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((opt) => (
                    <SelectItem key={opt.value || "__all"} value={opt.value || "__all"}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Origem">
              <Select
                value={filters.values.origin || "__all"}
                onValueChange={(v) => filters.set("origin", v === "__all" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas as origens" />
                </SelectTrigger>
                <SelectContent>
                  {originOptions.map((opt) => (
                    <SelectItem key={opt.value || "__all"} value={opt.value || "__all"}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <DateRangeFilter
              from={dateFrom}
              to={dateTo}
              onFromChange={(value) => filters.set("dateFrom", value)}
              onToChange={(value) => filters.set("dateTo", value)}
              inverted={invertedRange}
            />
          </FilterPanel>
        }
        columns={columns}
        data={orders}
        pagination={{ page, limit, total }}
        onPageChange={setPage}
        onLimitChange={(l) => {
          setLimit(l);
          setPage(1);
        }}
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
