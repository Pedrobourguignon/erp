import React from "react";

import { cn } from "@/lib/utils";

/** "Rótulo ........ valor" on one line; the value never wraps. */
export function ReceiptLine({ label, value, strong, className }: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-2", strong && "font-bold", className)}>
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}

/** The dashed rule thermal receipts use between sections. */
export function ReceiptDivider() {
  return <div aria-hidden className="my-1.5 border-t border-dashed border-black" />;
}
