"use client";

import { Plus, CreditCard } from "lucide-react";
import React, { useEffect, useMemo, useRef } from "react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormSetValue,
  type FieldValues,
} from "react-hook-form";

import { Button } from "@/components/ui/button";
import { usePaymentMethods } from "@/hooks/use-payment-methods";
import { isPermissionError } from "@/lib/api-errors";
import {
  hasLineWithoutMethod,
  settlePayments,
  type PaymentSettlement,
} from "@/lib/payment-settlement";
import { formatCurrency, cn } from "@/lib/utils";

import {
  PaymentLine,
  requiresLinkedAccount,
  hasMissingAccount,
} from "./payment-line";


// ─── Types ─────────────────────────────────────────────────────────────

interface PaymentSelectorProps {
  control: Control<FieldValues>;
  setValue: UseFormSetValue<FieldValues>;
  totalAmount: number;
  errors?: Record<string, unknown>;
  /**
   * Fires whenever an immediate payment line lacks a linked account — the API
   * refuses such a sale (SCRUM-30), so the page must block its submit.
   */
  onMissingAccountChange?: (missing: boolean) => void;
}

// ─── Component ─────────────────────────────────────────────────────────

export function PaymentSelector({
  control,
  setValue,
  totalAmount,
  errors,
  onMissingAccountChange,
}: PaymentSelectorProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "payments",
  });

  const payments = useWatch({ control, name: "payments" }) as
    | Array<{
        paymentMethodId: string;
        financialAccountId?: string;
        amount: number;
        installments?: number;
      }>
    | undefined;

  const { data: methodsData, error: methodsError } = usePaymentMethods();

  const methods = useMemo(
    () => (methodsData?.data ?? []).filter((m) => m.isActive),
    [methodsData]
  );

  const methodTypeById = useMemo(
    () => new Map(methods.map((m) => [m.id, m.type])),
    [methods]
  );

  const drafts = (payments ?? []).map((p) => ({
    amount: Number(p?.amount) || 0,
    isCash: methodTypeById.get(p?.paymentMethodId ?? "") === "CASH",
  }));

  const settlement = settlePayments(drafts, totalAmount);

  // Auto-sync amount when single payment line — but only when the cart total
  // or the number of lines changes, never in reaction to the seller typing.
  // Reacting to every keystroke pulled any value below the total straight back
  // to the total, so "Valor Recebido" could only grow by appending digits
  // (R$ 100,00 → R$ 1.000,00). VD-08: a cash line above the total is the
  // customer's change and is never pulled back.
  const synced = useRef<{ total: number; lines: number } | null>(null);
  useEffect(() => {
    const previous = synced.current;
    synced.current = { total: totalAmount, lines: fields.length };
    if (previous && previous.total === totalAmount && previous.lines === fields.length) {
      return;
    }
    if (fields.length !== 1 || totalAmount <= 0) {
      return;
    }

    const line = payments?.[0];
    const currentAmount = Number(line?.amount) || 0;
    const isCash = methodTypeById.get(line?.paymentMethodId ?? "") === "CASH";
    if (isCash && currentAmount > totalAmount) {
      return;
    }

    if (Math.abs(currentAmount - totalAmount) > 0.01) {
      setValue("payments.0.amount" as never, totalAmount as never);
    }
  }, [fields.length, totalAmount, payments, setValue, methodTypeById]);

  const missingAccount = hasMissingAccount(payments, methods);

  useEffect(() => {
    onMissingAccountChange?.(missingAccount);
  }, [missingAccount, onMissingAccountChange]);

  const paymentTotal = drafts.reduce((sum, p) => sum + p.amount, 0);

  const progressPct =
    totalAmount > 0 ? Math.min((paymentTotal / totalAmount) * 100, 100) : 0;

  const handleAdd = () => {
    // VD-05: the installments field is the source of truth now — the seller
    // picks it on the line and the API checks it against the method's maximum.
    append({
      paymentMethodId: "",
      financialAccountId: "",
      installments: 1,
      amount: fields.length === 0 ? totalAmount : 0,
    });
  };

  const rootError =
    errors && typeof errors === "object" && "message" in errors
      ? (errors as { message?: string }).message
      : undefined;

  return (
    <div className="space-y-4">
      {/* VD-07/AE-28: an empty selector caused by a 403 used to look like a
          tenant with no payment methods configured. */}
      {methodsError ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {isPermissionError(methodsError)
              ? "Você não tem permissão para ver as formas de pagamento. Fale com o administrador."
              : "Não foi possível carregar as formas de pagamento. Tente novamente em instantes."}
          </p>
        </div> : null}

      {/* Payment lines */}
      {fields.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-8 text-center">
          <CreditCard className="mb-3 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Nenhuma forma de pagamento adicionada
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {fields.map((field, index) => {
            const payment = payments?.[index];
            const selectedMethod = methods.find(
              (m) => m.id === payment?.paymentMethodId
            );
            const methodType = selectedMethod?.type ?? null;
            const lineMissingAccount =
              requiresLinkedAccount(methodType) &&
              !(payment?.financialAccountId || selectedMethod?.defaultAccountId);

            return (
              <PaymentLine
                key={field.id}
                index={index}
                control={control as Control<Record<string, unknown>>}
                setValue={setValue}
                methods={methods}
                selectedMethod={selectedMethod}
                installments={Number(payment?.installments) || 1}
                amount={Number(payment?.amount) || 0}
                selectedMethodType={methodType}
                missingAccount={lineMissingAccount}
                onRemove={() => remove(index)}
              />
            );
          })}
        </div>
      )}

      {/* Add button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={handleAdd}
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar pagamento
      </Button>

      {/* Progress bar and totals */}
      {fields.length > 0 && (
        <PaymentProgress
          totalAmount={totalAmount}
          paymentTotal={paymentTotal}
          settlement={settlement}
          progressPct={progressPct}
          hasLineWithoutMethod={hasLineWithoutMethod(payments)}
        />
      )}

      {rootError ? <p className="text-xs text-destructive">{rootError}</p> : null}
    </div>
  );
}

// ─── Progress sub-component ────────────────────────────────────────────

function PaymentProgress({
  totalAmount,
  paymentTotal,
  settlement,
  progressPct,
  hasLineWithoutMethod: missingMethod,
}: {
  hasLineWithoutMethod: boolean;
  totalAmount: number;
  paymentTotal: number;
  settlement: PaymentSettlement;
  progressPct: number;
}) {
  const hasChange = settlement.change > 0.005;
  const isExact = settlement.isSettled && !hasChange && !missingMethod;
  const isUnder = settlement.missing > 0.005;
  // Only cash may exceed the total; anything else is a typo the seller must fix.
  const isOver = !settlement.isSettled && !isUnder;

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3 dark:bg-muted/10">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Pagamentos</span>
        <span className="font-medium">
          {formatCurrency(paymentTotal)} / {formatCurrency(totalAmount)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            isExact && "bg-emerald-500",
            isOver && "bg-red-500",
            isUnder && "bg-amber-500"
          )}
          style={{ width: `${Math.min(progressPct, 100)}%` }}
        />
      </div>
      {isUnder ? <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
          Falta: {formatCurrency(settlement.missing)}
        </p> : null}
      {isOver ? <p className="text-xs font-medium text-red-600 dark:text-red-400">
          Os pagamentos somam mais que o total do pedido. Só dinheiro aceita
          valor acima do total.
        </p> : null}
      {hasChange ? <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
          Troco: {formatCurrency(settlement.change)}
        </p> : null}
      {missingMethod ? <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
          Selecione a forma de pagamento de cada linha.
        </p> : null}
      {isExact ? <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
          Pagamento completo
        </p> : null}
    </div>
  );
}
