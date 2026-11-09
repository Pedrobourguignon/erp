"use client";

import type { ProductStatus } from "@erp/shared-types";
import { useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Plus,
  Eye,
  Edit,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useMemo, useState } from "react";

import { Can } from "@/components/auth/can";
import { EntityFilterSelect } from "@/components/forms/entity-filter-select";
import { ImportCsvDialog } from "@/components/forms/import-csv-dialog";
import { ListPageHeader } from "@/components/layouts/list-page-header";
import {
  DataTable,
  type ColumnDef,
  type SortState,
} from "@/components/tables/data-table";
import { FilterField, FilterPanel } from "@/components/tables/filter-panel";
import { ListSearch } from "@/components/tables/list-search";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { useFilters } from "@/hooks/use-filters";
import {
  useProducts,
  useDeleteProduct,
  useCategories,
  useBrands,
  productKeys,
} from "@/hooks/use-products";
import { getApiErrorMessage } from "@/lib/api";
import { toCategoryOptions, toEntityOptions } from "@/lib/category-options";

// ─── Product row from API ────────────────────────────────────────────────

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  status: string;
  salePrice: number;
  costPrice: number;
  category?: { id: string; name: string } | null;
  brand?: { id: string; name: string } | null;
  inventory?: { totalQuantity: number; totalReserved: number; totalAvailable: number };
}

// ─── Actions cell ───────────────────────────────────────────────────────

function ProductActions({ product }: { product: ProductRow }) {
  const router = useRouter();
  const deleteProduct = useDeleteProduct();
  const { addToast } = useToast();
  const [showDelete, setShowDelete] = useState(false);

  const handleDelete = async () => {
    try {
      await deleteProduct.mutateAsync(product.id);
      addToast("Produto excluído com sucesso!", "success");
    } catch (err) {
      // AE-02: a API recusa produto com saldo ou pedido em aberto e diz o
      // porquê. Engolir isso num "Erro ao excluir" faria o usuário tentar de
      // novo sem entender o que mudou.
      addToast(
        getApiErrorMessage(err) ?? "Erro ao excluir produto.",
        "error"
      );
    }
  };

  // AE-02: o diálogo diz o saldo antes de confirmar, porque a exclusão pode
  // ser recusada — melhor saber antes de clicar.
  const stockOnHand = product.inventory?.totalAvailable ?? 0;

  return (
    <div className="flex items-center justify-end gap-1">
      <Tooltip content="Ver detalhes">
        <Button variant="ghost" action="default" size="icon" className="h-10 w-10 md:h-8 md:w-8" onClick={() => router.push(`/estoque/produtos/${product.id}`)}>
          <Eye className="h-4 w-4" />
        </Button>
      </Tooltip>
      <Tooltip content="Editar">
        <Button variant="ghost" action="default" size="icon" className="h-10 w-10 md:h-8 md:w-8" onClick={() => router.push(`/estoque/produtos/${product.id}/edit`)}>
          <Edit className="h-4 w-4" />
        </Button>
      </Tooltip>
      <Tooltip content="Excluir">
        <Button variant="ghost" action="delete" size="icon" className="h-10 w-10 md:h-8 md:w-8" onClick={() => setShowDelete(true)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </Tooltip>
      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title="Excluir Produto"
        message={
          stockOnHand > 0
            ? `"${product.name}" tem ${stockOnHand} un. em estoque. Produtos com saldo não podem ser excluídos — zere o estoque ou inative o produto.`
            : `Deseja excluir "${product.name}"? Esta ação não pode ser desfeita.`
        }
        destructive
        confirmLabel="Excluir"
        loading={deleteProduct.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ─── Columns ────────────────────────────────────────────────────────────

const columns: ColumnDef<ProductRow>[] = [
  {
    id: "sku",
    role: "secondary",
    maxCh: 14,
    header: "SKU",
    accessor: "sku",
    sortable: true,
    className: "font-mono text-xs",
  },
  {
    id: "name",
    role: "primary",
    maxCh: 32,
    header: "Produto",
    accessor: "name",
    sortable: true,
    cell: (row) => (
      <Link
        href={`/estoque/produtos/${row.id}`}
        className="font-medium text-primary hover:underline"
      >
        {row.name}
      </Link>
    ),
  },
  {
    id: "category",
    role: "meta",
    header: "Categoria",
    accessor: (row) => row.category?.name ?? "-",
  },
  {
    id: "salePrice",
    role: "value",
    header: "Preço",
    accessor: "salePrice",
    sortable: true,
    cell: (row) => <Money value={row.salePrice} />,
    className: "text-right",
    nowrap: true,
    headerClassName: "text-right",
  },
  {
    id: "stock",
    role: "meta",
    header: "Estoque",
    accessor: (row) => row.inventory?.totalAvailable ?? 0,
    sortable: true,
    cell: (row) => {
      const qty = row.inventory?.totalAvailable ?? 0;
      return (
        <span
          className={
            qty <= 0
              ? "font-medium text-destructive"
              : qty <= 10
                ? "font-medium text-yellow-600"
                : ""
          }
        >
          {qty}
        </span>
      );
    },
    className: "text-right",
    nowrap: true,
    headerClassName: "text-right",
  },
  {
    id: "status",
    role: "status",
    header: "Status",
    accessor: "status",
    cell: (row) => <StatusBadge status={row.status} />,
  },
  {
    id: "actions",
    role: "actions",
      noTruncate: true,
    header: "Ações",
    cell: (row) => <ProductActions product={row} />,
    className: "text-right w-[120px]",
    nowrap: true,
    headerClassName: "text-right",
  },
];

// ─── Filters ────────────────────────────────────────────────────────────

const statusOptions: { value: ProductStatus | ""; label: string }[] = [
  { value: "", label: "Todos os status" },
  { value: "ACTIVE", label: "Ativo" },
  { value: "INACTIVE", label: "Inativo" },
  { value: "DRAFT", label: "Rascunho" },
];

// ─── Page ───────────────────────────────────────────────────────────────

export default function ProductsListPage() {
  const router = useRouter();

  // State
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState<SortState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const queryClient = useQueryClient();

  const resetPage = useCallback(() => setPage(1), []);
  const filters = useFilters(
    { search: "", status: "", categoryId: "", brandId: "" },
    resetPage
  );

  // FT-01/FT-02: Categoria e Marca eram `<input>` de texto cujo valor ia como
  // `categoryId`/`brandId` — comparação exata contra um cuid. Não havia texto
  // que o usuário pudesse digitar para o filtro funcionar.
  const {
    data: categoriesResp,
    isLoading: categoriesLoading,
    error: categoriesError,
  } = useCategories();
  const {
    data: brandsResp,
    isLoading: brandsLoading,
    error: brandsError,
  } = useBrands();

  const categoryOptions = useMemo(
    () => toCategoryOptions(categoriesResp?.data),
    [categoriesResp]
  );
  const brandOptions = useMemo(
    () => toEntityOptions(brandsResp?.data),
    [brandsResp]
  );

  // Data
  const { data, isLoading, error, refetch } = useProducts({
    page,
    limit,
    search: filters.values.search || undefined,
    sortBy: sort?.column,
    sortOrder: sort?.direction,
    status: (filters.values.status || undefined) as ProductStatus | undefined,
    categoryId: filters.values.categoryId || undefined,
    brandId: filters.values.brandId || undefined,
  });

  const products = (data?.data ?? []) as ProductRow[];
  const total = data?.meta?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <ListPageHeader
        title="Produtos"
        actions={
          <>
          <Can permission="products:create">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Importar
            </Button>
            <Button onClick={() => router.push("/estoque/produtos/novo")}>
              <Plus className="mr-2 h-4 w-4" />
              Novo Produto
            </Button>
          </Can>
          </>
        }
      />

      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        domain="products"
        title="Importar produtos"
        onCompleted={() =>
          queryClient.invalidateQueries({ queryKey: productKeys.lists() })
        }
      />


      {/* Table */}
      <DataTable<ProductRow>
        filters={
          <FilterPanel
            values={filters.values}
            onClear={filters.clear}
            searchSpan={1}
            search={
              <ListSearch
                value={filters.values.search}
                onChange={(val) => filters.set("search", val)}
                placeholder="Buscar por nome ou SKU..."
              />
            }
          >
            <FilterField label="Status">
              <Select
                value={filters.values.status || "__all"}
                onValueChange={(val) => filters.set("status", val === "__all" ? "" : val)}
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

            <EntityFilterSelect
              id="filtro-categoria"
              label="Categoria"
              value={filters.values.categoryId}
              onChange={(value) => filters.set("categoryId", value)}
              options={categoryOptions}
              isLoading={categoriesLoading}
              error={categoriesError}
              allLabel="Todas as categorias"
            />

            <EntityFilterSelect
              id="filtro-marca"
              label="Marca"
              value={filters.values.brandId}
              onChange={(value) => filters.set("brandId", value)}
              options={brandOptions}
              isLoading={brandsLoading}
              error={brandsError}
              allLabel="Todas as marcas"
            />
          </FilterPanel>
        }
        columns={columns}
        data={products}
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
