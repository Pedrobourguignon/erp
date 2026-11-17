"use client";

import type { PaginatedResponse, Product } from "@erp/shared-types";
import { useCallback, useEffect, useState } from "react";
import { Controller, type Control, type FieldErrors } from "react-hook-form";

import { SearchableSelectBase, type SelectOption } from "@/components/forms/searchable-select";
import { ScanNoticeBar } from "@/components/sales/scan-notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import type { ScanNotice } from "@/hooks/use-cart-scanner";
import { useProduct } from "@/hooks/use-products";
import api from "@/lib/api";
import { exchangeTargetFromScan } from "@/lib/exchange-scan";
import { getMutationErrorMessage } from "@/lib/mutation-error";
import type { AdjustItemValues, AdjustMode } from "@/lib/order-adjustment";
import { lookupProductCode } from "@/lib/product-lookup";
import { playScanSound, scanSoundEnabled } from "@/lib/scan-sound";
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
  /** Produto vendido: a troca de tamanho só aceita etiqueta dele. */
  soldProductId: string;
  /** O leitor achou o que entra no lugar. */
  onScanTarget: (target: { productId: string; variantId: string; productName: string }) => void;
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
  soldProductId,
  onScanTarget,
}: AdjustItemTargetProps) {
  // Leitor de código de barras: a etiqueta do que o cliente leva preenche o
  // produto e o tamanho, com o mesmo cuidado do balcão (busca exata).
  const [scanNotice, setScanNotice] = useState<ScanNotice | null>(null);
  // O produto lido não veio da lista do seletor: sem isto o campo mostraria
  // "Buscar…" com um produto escolhido.
  const [scanned, setScanned] = useState<SelectOption | null>(null);
  useBarcodeScanner({
    onScan: async (code) => {
      const beep = (kind: "ok" | "error") => {
        if (scanSoundEnabled()) {playScanSound(kind);}
      };
      try {
        const outcome = exchangeTargetFromScan({
          mode,
          soldProductId,
          returnedVariantId: excludeVariantId ?? null,
          result: await lookupProductCode(code),
        });
        if ("target" in outcome) {
          beep("ok");
          setScanNotice(null);
          setScanned({ value: outcome.target.productId, label: outcome.target.productName });
          onScanTarget(outcome.target);
        } else {
          beep("error");
          setScanNotice({ code, message: outcome.notice });
        }
      } catch (error) {
        beep("error");
        setScanNotice({ code, message: getMutationErrorMessage(error, `Não foi possível ler o código ${code}.`) });
      }
    },
  });

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
      <ScanNoticeBar notice={scanNotice} onDismiss={() => setScanNotice(null)} />
      {mode === "product" ? (
        <Controller
          name="productId"
          control={control}
          render={({ field }) => (
            <SearchableSelectBase
              label="Novo produto *"
              value={field.value}
              onChange={field.onChange}
              selectedOption={scanned?.value === field.value ? scanned : null}
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
