"use client";

import type { PaginatedResponse, Product } from "@erp/shared-types";
import { useCallback, useEffect } from "react";
import { Controller, type Control, type FieldErrors } from "react-hook-form";

import { SearchableSelectBase } from "@/components/forms/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProduct } from "@/hooks/use-products";
import api from "@/lib/api";
import type { AdjustItemValues, AdjustMode } from "@/lib/order-adjustment";
import { formatCurrency } from "@/lib/utils";

type AdjustItemTargetProps = {
  control: Control<AdjustItemValues>;
  errors: FieldErrors<AdjustItemValues>;
  mode: AdjustMode;
  /** Produto vendido (troca de tamanho) ou o escolhido (troca de produto). */
  productId: string;
  variantId: string;
  /** Variante que o cliente está devolvendo — não é opção na troca de tamanho. */
  excludeVariantId?: string | null;
  onPriceChange: (price: number | null) => void;
};

const PRODUCT_PAGE_SIZE = 20;

/** O que entra no lugar: outro tamanho/cor do mesmo produto, ou outro produto. */
export function AdjustItemTarget({
  control,
  errors,
  mode,
  productId,
  variantId,
  excludeVariantId,
  onPriceChange,
}: AdjustItemTargetProps) {
  const { data: productResp, isLoading } = useProduct(productId, { enabled: !!productId });
  const product = productResp?.data;
  const variants = (product?.variants ?? []).filter(
    (v) => v.isActive !== false && v.id !== excludeVariantId
  );

  // O preço de tabela de hoje alimenta a prévia da troca por outro produto.
  useEffect(() => {
    if (!product) {return onPriceChange(null);}
    const variant = product.variants?.find((v) => v.id === variantId);
    onPriceChange(Number(variant?.salePrice ?? product.salePrice));
  }, [product, variantId, onPriceChange]);

  const loadProducts = useCallback(async (query: string) => {
    const { data } = await api.get<PaginatedResponse<Product>>("/products", {
      params: { search: query.trim() || undefined, limit: PRODUCT_PAGE_SIZE, status: "ACTIVE" },
    });
    return (data.data ?? []).map((p) => ({
      value: p.id,
      label: p.name,
      description: `${p.sku} · ${formatCurrency(Number(p.salePrice))}`,
    }));
  }, []);

  const showVariants = mode === "size" || variants.length > 0;

  return (
    <div className="space-y-4">
      {mode === "product" ? (
        <Controller
          name="productId"
          control={control}
          render={({ field }) => (
            <SearchableSelectBase
              label="Novo produto *"
              value={field.value}
              onChange={field.onChange}
              loadOptions={loadProducts}
              placeholder="Buscar por nome ou SKU"
              error={errors.productId?.message}
            />
          )}
        />
      ) : null}

      {showVariants && productId ? (
        <div className="space-y-1">
          <label htmlFor="adjust-variant" className="text-sm font-medium">
            {mode === "size" ? "Novo tamanho/cor *" : "Variante"}
          </label>
          <Controller
            name="variantId"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={isLoading}>
                <SelectTrigger id="adjust-variant">
                  <SelectValue placeholder={isLoading ? "Carregando…" : "Selecione"} />
                </SelectTrigger>
                <SelectContent>
                  {variants.map((v) => {
                    const available = (v.inventoryItems ?? []).reduce((n, i) => n + i.available, 0);
                    return (
                      <SelectItem key={v.id} value={v.id} disabled={available <= 0}>
                        {v.name} · {available > 0 ? `${available} un.` : "sem estoque"}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            )}
          />
          {mode === "size" && !isLoading && variants.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Este produto não tem outro tamanho ou cor cadastrado. Use &quot;Outro produto&quot;.
            </p>
          ) : null}
          {errors.variantId ? (
            <p className="text-xs text-destructive">{errors.variantId.message}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
