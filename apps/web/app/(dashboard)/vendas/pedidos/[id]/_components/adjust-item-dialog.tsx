"use client";

import { ArrowRightLeft, PackageX, Ruler } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TruncatedText } from "@/components/ui/truncated-text";
import type { OrderDetail, OrderItem } from "@/hooks/use-orders";
import type { AdjustMode } from "@/lib/order-adjustment";
import { cn } from "@/lib/utils";

import { AdjustItemForm } from "./adjust-item-form";

type AdjustItemDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderDetail;
  item: OrderItem | null;
  initialMode: AdjustMode;
};

const MODES: { value: AdjustMode; label: string; short: string; hint: string; icon: typeof Ruler }[] = [
  { value: "size", label: "Outro tamanho/cor", short: "Tamanho", hint: "Mesmo produto, mesmo preço pago.", icon: Ruler },
  { value: "product", label: "Outro produto", short: "Produto", hint: "Recalcula pelo preço do produto novo.", icon: ArrowRightLeft },
  { value: "return", label: "Devolver", short: "Devolver", hint: "Sem troca: o valor pago volta ao cliente.", icon: PackageX },
];

/** Troca de tamanho, troca por outro produto ou devolução de um item vendido. */
export function AdjustItemDialog({ open, onOpenChange, order, item, initialMode }: AdjustItemDialogProps) {
  const [mode, setMode] = useState<AdjustMode>(initialMode);

  useEffect(() => {
    if (open) {setMode(initialMode);}
  }, [open, initialMode]);

  const current = MODES.find((m) => m.value === mode) ?? MODES[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Troca ou devolução</DialogTitle>
          <DialogDescription asChild>
            <div className="min-w-0">
              <TruncatedText text={item?.productName ?? item?.product?.name} className="font-medium text-foreground" />
              <span className="text-xs">{current.hint}</span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Tipo de operação" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {MODES.map(({ value, label, short, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              aria-label={label}
              onClick={() => setMode(value)}
              className={cn(
                "flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors sm:text-sm",
                mode === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate sm:hidden">{short}</span>
              <span className="hidden truncate sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {item ? (
          <AdjustItemForm
            key={`${item.id}-${mode}`}
            order={order}
            item={item}
            mode={mode}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
