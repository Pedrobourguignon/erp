"use client";

import React, { useEffect, useState } from "react";

import { SearchableSelectBase, type SelectOption } from "@/components/forms/searchable-select";
import { ScanNoticeBar } from "@/components/sales/scan-notice";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import type { ScanNotice } from "@/hooks/use-cart-scanner";
import { useProduct } from "@/hooks/use-products";
import { splitVariantName } from "@/lib/counter-cart";
import { getMutationErrorMessage } from "@/lib/mutation-error";
import { lookupProductCode } from "@/lib/product-lookup";
import { playScanSound, scanSoundEnabled } from "@/lib/scan-sound";

import { FieldShell, useProductSearch } from "./movement-fields";

interface ProductVariantFieldProps {
  productId: string;
  variantId: string;
  onChange: (next: { productId: string; variantId: string }) => void;
  /** The form requires a size/colour when the product has them. */
  onHasVariantsChange: (hasVariants: boolean) => void;
  productError?: string;
  variantError?: string;
}

/**
 * Product and size/colour of a stock movement, chosen by name or by reading
 * the label. A product with variants used to move a stock that belonged to no
 * size at all — the movement now names the variant, like the sale does.
 */
export function ProductVariantField({
  productId,
  variantId,
  onChange,
  onHasVariantsChange,
  productError,
  variantError,
}: ProductVariantFieldProps) {
  const loadProducts = useProductSearch();
  const [scanned, setScanned] = useState<SelectOption | null>(null);
  const [notice, setNotice] = useState<ScanNotice | null>(null);

  const { data: productResp } = useProduct(productId, { enabled: !!productId });
  const variants = (productResp?.data?.variants ?? []).filter((v) => v.isActive !== false);
  const hasVariants = variants.length > 0;
  useEffect(() => onHasVariantsChange(hasVariants), [hasVariants, onHasVariantsChange]);

  useBarcodeScanner({
    onScan: async (code) => {
      const beep = (kind: "ok" | "error") => {
        if (scanSoundEnabled()) {playScanSound(kind);}
      };
      try {
        const result = await lookupProductCode(code);
        if (result.kind === "NOT_FOUND") {
          beep("error");
          setNotice({ code, message: result.message });
          return;
        }
        beep("ok");
        setNotice(null);
        const next =
          result.kind === "MATCH"
            ? { productId: result.item.productId, variantId: result.item.variantId ?? "", name: splitVariantName(result.item.name).base }
            : { productId: result.productId, variantId: "", name: result.productName };
        setScanned({ value: next.productId, label: next.name });
        onChange({ productId: next.productId, variantId: next.variantId });
      } catch (error) {
        beep("error");
        setNotice({ code, message: getMutationErrorMessage(error, `Não foi possível ler o código ${code}.`) });
      }
    },
  });

  return (
    <div className="space-y-3">
      <ScanNoticeBar notice={notice} onDismiss={() => setNotice(null)} />
      <FieldShell label="Produto" error={productError}>
        <SearchableSelectBase
          value={productId}
          onChange={(id) => onChange({ productId: id, variantId: "" })}
          selectedOption={scanned?.value === productId ? scanned : null}
          loadOptions={loadProducts}
          placeholder="Selecione o produto ou leia a etiqueta"
        />
      </FieldShell>
      {hasVariants ? (
        <div className="space-y-1">
          <label htmlFor="movement-variant" className="text-xs font-medium text-muted-foreground">
            Tamanho/cor
          </label>
          <Select value={variantId} onValueChange={(id) => onChange({ productId, variantId: id })}>
            <SelectTrigger id="movement-variant" aria-label="Tamanho/cor">
              <SelectValue placeholder="Selecione o tamanho/cor" />
            </SelectTrigger>
            <SelectContent>
              {variants.map((v) => {
                const available = (v.inventoryItems ?? []).reduce((n, i) => n + i.available, 0);
                return (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name} · {available} un.
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {variantError ? <p className="text-xs text-destructive">{variantError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
