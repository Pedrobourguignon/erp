"use client";

import { Controller, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CashRegisterSession } from "@/hooks/use-cash-registers";
import type { PaymentMethod } from "@/hooks/use-payment-methods";
import type { AdjustItemValues, AdjustmentPreview } from "@/lib/order-adjustment";
import { cn, formatCurrency } from "@/lib/utils";

type AdjustItemSettlementProps = {
  preview: AdjustmentPreview | null;
  control: Control<AdjustItemValues>;
  register: UseFormRegister<AdjustItemValues>;
  errors: FieldErrors<AdjustItemValues>;
  settleNow: boolean;
  methods: PaymentMethod[];
  /** Preenchido só quando o dinheiro precisa dizer por qual caixa passa. */
  sessionChoices: CashRegisterSession[];
};

/**
 * O número que o operador fala em voz alta para o cliente, e como o acerto
 * acontece: na hora (pela forma escolhida) ou como título em aberto.
 */
export function AdjustItemSettlement({
  preview,
  control,
  register,
  errors,
  settleNow,
  methods,
  sessionChoices,
}: AdjustItemSettlementProps) {
  if (!preview) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Escolha o que entra no lugar para ver a diferença.
      </div>
    );
  }

  const moves = preview.charge > 0 || preview.refund > 0;
  const headline = headlineOf(preview);

  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">{headline.label}</span>
        {headline.value !== null ? (
          <span
            data-testid="adjust-headline-amount"
            className={cn("whitespace-nowrap text-2xl font-semibold tabular-nums", headline.tone)}
          >
            {formatCurrency(headline.value)}
          </span>
        ) : (
          <span className={cn("text-sm font-semibold", headline.tone)}>✓</span>
        )}
      </div>

      {preview.abated > 0 ? (
        <p className="text-xs text-muted-foreground">
          {formatCurrency(preview.abated)} abatidos do que o cliente ainda devia neste pedido
          {preview.refund > 0 ? "; o restante é devolvido." : " — nada a devolver em dinheiro."}
        </p>
      ) : null}

      {moves ? (
        <div className="space-y-3 border-t pt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register("settleNow")} className="h-4 w-4 rounded border-input" />
            {preview.charge > 0 ? "Receber agora" : "Devolver agora"}
          </label>
          {!settleNow ? (
            <p className="text-xs text-muted-foreground">
              Fica em aberto em contas a {preview.charge > 0 ? "receber" : "pagar"} — a baixa é feita
              depois em Financeiro › Lançamentos.
            </p>
          ) : (
            <SettleNowFields control={control} errors={errors} methods={methods} sessionChoices={sessionChoices} />
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * O que o operador diz ao cliente. Uma devolução que só abate o que ele ainda
 * devia não é "sem diferença": o pedido ficou mais barato, só não sai dinheiro.
 */
function headlineOf(preview: AdjustmentPreview) {
  if (preview.charge > 0) {
    return { label: "Cliente paga", value: preview.charge, tone: "text-amber-700 dark:text-amber-400" };
  }
  if (preview.refund > 0) {
    return { label: "Loja devolve", value: preview.refund, tone: "text-sky-700 dark:text-sky-400" };
  }
  if (preview.abated > 0) {
    return { label: "Abatido do que o cliente deve", value: preview.abated, tone: "text-sky-700 dark:text-sky-400" };
  }
  return { label: "Sem diferença a acertar", value: null, tone: "text-emerald-700 dark:text-emerald-400" };
}

function SettleNowFields({
  control,
  errors,
  methods,
  sessionChoices,
}: Pick<AdjustItemSettlementProps, "control" | "errors" | "methods" | "sessionChoices">) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <label htmlFor="adjust-method" className="text-sm font-medium">Forma de pagamento *</label>
        <Controller
          name="paymentMethodId"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="adjust-method"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {methods.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.paymentMethodId ? <p className="text-xs text-destructive">{errors.paymentMethodId.message}</p> : null}
      </div>
      {sessionChoices.length > 0 ? (
        <div className="space-y-1">
          <label htmlFor="adjust-session" className="text-sm font-medium">Caixa *</label>
          <Controller
            name="cashRegisterSessionId"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="adjust-session"><SelectValue placeholder="Selecione o caixa" /></SelectTrigger>
                <SelectContent>
                  {sessionChoices.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.cashRegister?.name ?? "Caixa"}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.cashRegisterSessionId ? (
            <p className="text-xs text-destructive">{errors.cashRegisterSessionId.message}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
