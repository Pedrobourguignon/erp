"use client";

import { splitInstallments } from "@erp/validators";
import { Trash2, AlertTriangle } from "lucide-react";
import React from "react";
import { Controller, type Control, type UseFormSetValue, type FieldValues } from "react-hook-form";

import { MoneyInput } from "@/components/forms/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import type { PaymentCondition } from "@/hooks/use-payment-conditions";
import type { PaymentMethod } from "@/hooks/use-payment-methods";
import { cn, formatCurrency } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────

interface PaymentLineProps {
  index: number;
  control: Control<FieldValues>;
  setValue: UseFormSetValue<FieldValues>;
  methods: PaymentMethod[];
  conditions: PaymentCondition[];
  /** Drives the installment preview — the condition decides how many there are. */
  selectedCondition?: PaymentCondition;
  amount: number;
  selectedMethodType: string | null;
  requiresAuthorization: boolean;
  showCondition: boolean;
  authorizationError?: string;
  missingAccount?: boolean;
  onRemove: () => void;
}

// ─── Condition-showing types ───────────────────────────────────────────

const CONDITION_TYPES = new Set([
  "CREDIT_CARD",
  "BOLETO",
  "BANK_TRANSFER",
]);

export function shouldShowCondition(type: string | null): boolean {
  return type !== null && CONDITION_TYPES.has(type);
}

// ─── Method-scoped conditions (SCRUM-52) ───────────────────────────────

/**
 * A condition with no linked methods keeps the pre-SCRUM-52 behavior: it
 * shows up for any method that displays a condition. Linking narrows it.
 */
export function filterConditionsForMethod(
  conditions: PaymentCondition[],
  methodId: string | undefined
): PaymentCondition[] {
  if (!methodId) {return conditions;}
  return conditions.filter(
    (c) => c.paymentMethodIds.length === 0 || c.paymentMethodIds.includes(methodId)
  );
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
export function InstallmentPreview({
  condition,
  amount,
}: {
  condition?: PaymentCondition;
  amount: number;
}) {
  if (!condition || condition.installments <= 1 || amount <= 0) {
    return null;
  }

  const parts = splitInstallments(amount, condition.installments);
  const days = condition.daysBetweenInstallments || 30;
  const dueDays = parts.map((_, i) => (i + 1) * days).join("/");

  return (
    <p className="text-xs text-muted-foreground">
      {condition.installments}x de {formatCurrency(parts[0])}
      {parts[parts.length - 1] !== parts[0] &&
        ` (última de ${formatCurrency(parts[parts.length - 1])})`}{" "}
      &middot; vencimentos em {dueDays} dias
    </p>
  );
}

// ─── Component ─────────────────────────────────────────────────────────

export function PaymentLine({
  index,
  control,
  setValue,
  methods,
  conditions,
  selectedCondition,
  amount,
  selectedMethodType,
  requiresAuthorization,
  showCondition,
  authorizationError,
  missingAccount,
  onRemove,
}: PaymentLineProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 dark:bg-muted/10 sm:flex-row sm:items-end",
        missingAccount && "border-amber-400 dark:border-amber-700"
      )}
    >
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
                // Track whether this method requires an authorization code so the
                // form schema can make the field conditionally required.
                setValue(
                  `payments.${index}.requiresAuthorization`,
                  method?.requiresAuthorization ?? false,
                  { shouldValidate: true }
                );
                // VD-08: only cash may be handed over above the total, and the
                // schema has no access to the method list — it reads this.
                setValue(`payments.${index}.methodType`, method?.type ?? "", {
                  shouldValidate: true,
                });
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

      {/* Payment Condition */}
      {showCondition ? <div className="min-w-0 flex-1 space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Condicao
          </label>
          <Controller
            name={`payments.${index}.paymentConditionId`}
            control={control}
            render={({ field }) => (
              <Select
                value={String(field.value ?? "")}
                onValueChange={field.onChange}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {conditions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.installments > 1 ? ` (${c.installments}x)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <InstallmentPreview condition={selectedCondition} amount={amount} />
        </div> : null}

      {/* Amount */}
      <div className={cn("space-y-1", showCondition ? "w-full sm:w-36" : "w-full sm:w-44")}>
        <label className="text-xs font-medium text-muted-foreground">
          {selectedMethodType === "CASH" ? "Valor Recebido" : "Valor"}
        </label>
        <MoneyInput name={`payments.${index}.amount`} control={control} />
      </div>

      {/* Authorization Code */}
      {requiresAuthorization ? <div className="w-full space-y-1 sm:w-36">
          <label className="text-xs font-medium text-muted-foreground">
            Cod. Autorizacao
          </label>
          <Controller
            name={`payments.${index}.authorizationCode`}
            control={control}
            render={({ field }) => (
              <Input
                {...field}
                value={String(field.value ?? "")}
                placeholder="000000"
                maxLength={50}
                className={cn(
                  "h-9",
                  authorizationError &&
                    "border-destructive focus-visible:ring-destructive"
                )}
              />
            )}
          />
          {authorizationError ? <p className="text-xs text-destructive">{authorizationError}</p> : null}
        </div> : null}

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
  );
}
