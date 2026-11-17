"use client";

import { Loader2, Printer } from "lucide-react";
import React, { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { usePrintAdjustmentReceipt, usePrintSaleReceipt } from "@/hooks/use-receipts";
import { getMutationErrorMessage } from "@/lib/mutation-error";

import { PrintFrame } from "./print-frame";
import { ReceiptDocument, type PrintableReceipt } from "./receipt-document";

interface PrintReceiptButtonProps {
  orderId: string;
  /** Prints the receipt of this exchange/return instead of the sale's. */
  adjustmentId?: string;
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  /** Only the printer icon, with the label as tooltip and accessible name (table rows). */
  iconOnly?: boolean;
}

/**
 * Issues one copy of the receipt and prints it. Only on click — the store
 * decided against printing automatically at the end of the sale.
 */
export function PrintReceiptButton({
  orderId,
  adjustmentId,
  label = "Imprimir recibo",
  variant = "outline",
  size = "default",
  iconOnly = false,
}: PrintReceiptButtonProps) {
  const printSale = usePrintSaleReceipt();
  const printAdjustment = usePrintAdjustmentReceipt();
  const { addToast } = useToast();
  const [receipt, setReceipt] = useState<PrintableReceipt | null>(null);
  const pending = printSale.isPending || printAdjustment.isPending;

  const handleClick = async () => {
    try {
      const issued = adjustmentId
        ? await printAdjustment.mutateAsync({ orderId, adjustmentId })
        : await printSale.mutateAsync(orderId);
      setReceipt(issued);
    } catch (error) {
      addToast(getMutationErrorMessage(error, "Não foi possível gerar o recibo. Tente novamente."), "error");
    }
  };

  const handleDone = useCallback(() => setReceipt(null), []);

  const busy = pending || receipt !== null;
  const icon = pending
    ? <Loader2 className={iconOnly ? "h-4 w-4 animate-spin" : "mr-2 h-4 w-4 animate-spin"} />
    : <Printer className={iconOnly ? "h-4 w-4" : "mr-2 h-4 w-4"} />;

  return (
    <>
      {iconOnly ? (
        <Tooltip content={label}>
          <Button type="button" variant="ghost" size="icon" aria-label={label}
            className="h-10 w-10 md:h-8 md:w-8" onClick={handleClick} disabled={busy}>
            {icon}
          </Button>
        </Tooltip>
      ) : (
        <Button type="button" variant={variant} size={size} onClick={handleClick} disabled={busy}>
          {icon}
          {label}
        </Button>
      )}
      {receipt ? (
        <PrintFrame format={receipt.format} onDone={handleDone}>
          <ReceiptDocument receipt={receipt} />
        </PrintFrame>
      ) : null}
    </>
  );
}
