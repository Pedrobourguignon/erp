import { ScanBarcode, X } from "lucide-react";
import React from "react";

import type { ScanNotice } from "@/hooks/use-cart-scanner";

/**
 * Why the last read did not go to the cart. It stays until the next good read
 * or until dismissed: a toast would vanish while the operator still had the
 * product in hand.
 */
export function ScanNoticeBar({ notice, onDismiss }: { notice: ScanNotice | null; onDismiss: () => void }) {
  if (!notice) {return null;}
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <ScanBarcode className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 break-words">{notice.message}</p>
      <button type="button" aria-label="Fechar aviso" onClick={onDismiss} className="shrink-0 rounded p-0.5 hover:bg-destructive/10">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
