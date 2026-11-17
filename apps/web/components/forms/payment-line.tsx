"use client";

import { CARD_INSTALLMENT_INTERVAL_DAYS, splitInstallments } from "@erp/validators";
import { Trash2, AlertTriangle } from "lucide-react";
import React from "react";
import { Controller, type Control, type UseFormSetValue, type FieldValues } from "react-hook-form";

import { MoneyInput } from "@/components/forms/money-input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import type { PaymentMethod } from "@/hooks/use-payment-methods";
import { cn, formatCurrency, pluralize } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────

interface PaymentLineProps {
  index: number;
  control: Control<FieldValues>;
  setValue: UseFormSetValue<FieldValues>;
  methods: PaymentMethod[];
  selectedMethod?: PaymentMethod;
  /** Parcelas escolhidas na linha (o método diz até quantas aceita). */
  installments: number;
  amount: number;
  selectedMethodType: string | null;
  missingAccount?: boolean;
  onRemove: () => void;
}

// ─── Installments typed on the sale ────────────────────────────────────

/** 1x até o máximo do método; vazio quando o método não parcela. */
export function installmentChoices(method: PaymentMethod | undefined): number[] {
  const max = method?.maxInstallments ?? 1;
  if (max <= 1) {return [];}
  return Array.from({ length: max }, (_, i) => i + 1);
}

/**
 * Ao trocar o método, as parcelas já escolhidas só seguem se o novo método
 * aceitar — senão voltam a 1x, em vez de mandar à API um número que ela recusa.
 */
export function fitInstallments(
  current: number | undefined,
  method: PaymentMethod | undefined
): number {
  const value = current && current > 0 ? current : 1;
  return value <= (method?.maxInstallments ?? 1) ? value : 1;
}

// ─── Linked account (SCRUM-30) ─────────────────────────────────────────

/**
 * Immediate payments land in a bank account the moment the sale is registered,
 * so they need one linked. Term payments (boleto, crédito…) resolve their
 * account later, at settlement.
 */
const IMMEDIATE_TYPES = new Set(["CASH", "PIX", "DEBIT_CARD"]);

/** Rótulo do tipo, para diferenciar métodos de mesmo nome (VD-11). */
const METHOD_TYPE_LABEL: Record<string, string> = {
  CASH: "dinheiro",
  PIX: "PIX",
  DEBIT_CARD: "débito",
  CREDIT_CARD: "crédito",
  BOLETO: "boleto",
  BANK_TRANSFER: "transferência",
  OTHER: "outro",
};

export function requiresLinkedAccount(type: string | null): boolean {
  return type !== null && IMMEDIATE_TYPES.has(type);
}

type PaymentDraft = {
  paymentMethodId?: string;
  financialAccountId?: string;
};

/** True when any payment line would be refused by the API for lacking an account. */
export function hasMissingAccount(
  payments: PaymentDraft[] | undefined,
  methods: PaymentMethod[]
): boolean {
  return (payments ?? []).some((payment) => {
    const method = methods.find((m) => m.id === payment?.paymentMethodId);
    if (!method || !requiresLinkedAccount(method.type)) {
      return false;
    }
    return !(payment?.financialAccountId || method.defaultAccountId);
  });
}

// ─── Installment preview (VD-05) ───────────────────────────────────────

/**
 * Shows exactly the receivables the API will create — same split function,
 * `splitInstallments` from `@erp/validators`.
 */
/** Como o dinheiro chega: da maquininha, no cartão; senão, uma por mês. */
export interface InstallmentReceipt {
  mode: "FLOW" | "ANTICIPATED";
  /** Dias até o 1º repasse (no fluxo) ou até o valor inteiro (antecipado). */
  firstDays: number;
}

const MONTHLY: InstallmentReceipt = { mode: "FLOW", firstDays: CARD_INSTALLMENT_INTERVAL_DAYS };

export function InstallmentPreview({
  installments,
  amount,
  receipt = MONTHLY,
}: {
  installments: number;
  amount: number;
  receipt?: InstallmentReceipt;
}) {
  if (installments <= 1 || amount <= 0) {
    return null;
  }

  const parts = splitInstallments(amount, installments);
  // Mesmos prazos que a API usa para gerar os títulos.
  const when =
    receipt.mode === "ANTICIPATED"
      ? `cai tudo ${receipt.firstDays === 0 ? "na hora" : `em ${pluralize(receipt.firstDays, "dia", "dias")}`}`
      : `vencimentos em ${parts
          .map((_, i) => receipt.firstDays + i * CARD_INSTALLMENT_INTERVAL_DAYS)
          .join("/")} dias`;

  return (
    <p className="text-xs text-muted-foreground">
      {installments}x de {formatCurrency(parts[0])}
      {parts[parts.length - 1] !== parts[0] &&
        ` (última de ${formatCurrency(parts[parts.length - 1])})`}{" "}
      &middot; {when}
    </p>
  );
}

function receiptOf(method: PaymentMethod | undefined): InstallmentReceipt | undefined {
  const machine = method?.cardMachine;
  if (!machine || method?.type !== "CREDIT_CARD") {return undefined;}
  return {
    mode: machine.creditReceiveMode,
    firstDays: machine.creditSettlementDays ?? CARD_INSTALLMENT_INTERVAL_DAYS,
  };
}

// ─── Component ─────────────────────────────────────────────────────────

export function PaymentLine({
  index,
  control,
  setValue,
  methods,
  selectedMethod,
  installments,
  amount,
  selectedMethodType,
  missingAccount,
  onRemove,
}: PaymentLineProps) {
  const choices = installmentChoices(selectedMethod);

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border bg-muted/20 p-3 dark:bg-muted/10",
        missingAccount && "border-amber-400 dark:border-amber-700"
      )}
    >
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      {/* Payment Method */}
      <div className="min-w-0 flex-1 space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          Forma de Pagamento
        </label>
        <Controller
          name={`payments.${index}.paymentMethodId`}
          control={control}
          render={({ field }) => (
            <Select
              value={String(field.value ?? "")}
              onValueChange={(val) => {
                field.onChange(val);
                const method = methods.find((m) => m.id === val);
                if (method?.defaultAccountId) {
                  setValue(
                    `payments.${index}.financialAccountId`,
                    method.defaultAccountId
                  );
                }
                // VD-08: only cash may be handed over above the total, and the
                // schema has no access to the method list — it reads this.
                setValue(`payments.${index}.methodType`, method?.type ?? "", {
                  shouldValidate: true,
                });
                setValue(
                  `payments.${index}.installments`,
                  fitInstallments(installments, method)
                );
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {/* VD-11: dois métodos homônimos ("Dinheiro" CASH e "Dinheiro"
                    OTHER) eram indistinguíveis no seletor, e o OTHER passava na
                    validação gerando recebível pendente para uma venda paga. */}
                {methods.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                    {METHOD_TYPE_LABEL[m.type]
                      ? ` · ${METHOD_TYPE_LABEL[m.type]}`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {missingAccount ? <p className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            Sem conta financeira vinculada. Configure em Configurações &gt; Métodos
            de Pagamento.
          </p> : null}
      </div>

      {/* Installments — o vendedor escolhe, até o máximo do método */}
      {choices.length > 0 ? <div className="w-full space-y-1 sm:w-32">
          <label
            htmlFor={`payment-${index}-installments`}
            className="text-xs font-medium text-muted-foreground"
          >
            Parcelas
          </label>
          <Controller
            name={`payments.${index}.installments`}
            control={control}
            render={({ field }) => (
              <Select
                value={String(field.value ?? 1)}
                onValueChange={(val) => field.onChange(Number(val))}
              >
                <SelectTrigger id={`payment-${index}-installments`} className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n === 1 ? "À vista (1x)" : `${n}x`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div> : null}

      {/* Amount */}
      <div className="w-full space-y-1 sm:w-40">
        <label htmlFor={`payment-${index}-amount`} className="text-xs font-medium text-muted-foreground">
          {selectedMethodType === "CASH" ? "Valor Recebido" : "Valor"}
        </label>
        <MoneyInput id={`payment-${index}-amount`} name={`payments.${index}.amount`} control={control} />
      </div>

      {/* Remove */}
      <Tooltip content="Remover pagamento">
        <Button
          type="button"
          variant="ghost"
          action="delete"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </Tooltip>
    </div>
    {choices.length > 0 && (
      <InstallmentPreview
        installments={installments}
        amount={amount}
        receipt={receiptOf(selectedMethod)}
      />
    )}
    </div>
  );
}
