"use client";

import type { SaleCandidate } from "@erp/shared-types";
import React from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TruncatedText } from "@/components/ui/truncated-text";
import type { VariantPicker } from "@/hooks/use-cart-scanner";
import { cn, formatCurrency } from "@/lib/utils";

interface VariantPickerDialogProps {
  picker: VariantPicker | null;
  onPick: (candidate: SaleCandidate) => void;
  onClose: () => void;
}

/**
 * Which size/colour goes to the cart. A product with variants used to enter
 * the cart as the parent, with no quantity and R$ 0,00. Keyboard first: the
 * first option is focused, arrows/Tab move, Enter picks.
 */
export function VariantPickerDialog({ picker, onPick, onClose }: VariantPickerDialogProps) {
  return (
    <Dialog open={picker !== null} onOpenChange={(open) => { if (!open) {onClose();} }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="min-w-0">
            <TruncatedText text={picker ? `Qual variação de ${picker.productName}?` : ""} />
          </DialogTitle>
          <DialogDescription>Escolha o tamanho/cor que o cliente está levando.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
          {(picker?.variants ?? []).map((variant, index) => (
            <li key={variant.variantId ?? variant.sku}>
              <button
                type="button"
                autoFocus={index === 0}
                onClick={() => onPick(variant)}
                className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{variant.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{variant.sku}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block whitespace-nowrap tabular-nums">{formatCurrency(variant.salePrice)}</span>
                  <span className={cn("block text-xs", variant.available > 0 ? "text-muted-foreground" : "text-destructive")}>
                    {variant.available > 0 ? `${variant.available} un.` : "sem estoque"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
