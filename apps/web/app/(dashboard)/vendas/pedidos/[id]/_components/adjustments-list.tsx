import type { OrderAdjustment } from "@erp/shared-types";
import { ArrowRight, ArrowRightLeft, PackageX } from "lucide-react";

import { TruncatedText } from "@/components/ui/truncated-text";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";

type AdjustmentsListProps = {
  adjustments: OrderAdjustment[];
};

/**
 * Memória do que foi vendido originalmente: depois de uma troca a linha do
 * pedido mostra o que o cliente levou, e só este registro diz o que ele devolveu.
 */
export function AdjustmentsList({ adjustments }: AdjustmentsListProps) {
  return (
    <section aria-labelledby="adjustments-title" className="space-y-3">
      <h3 id="adjustments-title" className="text-sm font-semibold">Trocas e devoluções</h3>
      <ul className="divide-y rounded-lg border">
        {adjustments.map((a) => (
          <AdjustmentRow key={a.id} adjustment={a} />
        ))}
      </ul>
    </section>
  );
}

function AdjustmentRow({ adjustment: a }: { adjustment: OrderAdjustment }) {
  const difference = Number(a.difference);
  const Icon = a.type === "RETURN" ? PackageX : ArrowRightLeft;

  return (
    <li className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="shrink-0">{a.quantity}x</span>
            <TruncatedText text={a.returnedName} className="max-w-[28ch]" />
            {a.newName ? (
              <>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <TruncatedText text={a.newName} className="max-w-[28ch] font-medium" />
              </>
            ) : (
              <span className="shrink-0 text-muted-foreground">devolvido</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(a.createdAt)}
            {a.reason ? <> · <TruncatedText as="span" text={a.reason} className="max-w-[40ch] align-bottom" /></> : null}
          </p>
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 whitespace-nowrap font-medium tabular-nums",
          difference > 0 && "text-amber-700 dark:text-amber-400",
          difference < 0 && "text-sky-700 dark:text-sky-400",
          difference === 0 && "text-muted-foreground"
        )}
      >
        {difference > 0
          ? `Cliente pagou ${formatCurrency(difference)}`
          : difference < 0
            ? `Loja devolveu ${formatCurrency(-difference)}`
            : "Sem diferença"}
      </span>
    </li>
  );
}
