"use client";

import React from "react";
import type { UseFormReturn } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { resizeRates, MAX_CARD_INSTALLMENTS, type CardMachineFormValues } from "@/lib/card-machine-form";
import { cn } from "@/lib/utils";

import { CreditRatesField } from "./credit-rates-field";

interface CreditSectionProps {
  form: UseFormReturn<CardMachineFormValues>;
}

const MODES = [
  {
    value: "FLOW" as const,
    title: "Parcela a parcela",
    description: "Cada parcela cai num mês, como o cliente paga.",
  },
  {
    value: "ANTICIPATED" as const,
    title: "Antecipado",
    description: "O valor inteiro cai de uma vez; a taxa já inclui a antecipação.",
  },
];

export function CreditSection({ form }: CreditSectionProps) {
  const { register, watch, setValue, formState: { errors } } = form;
  const acceptsCredit = watch("acceptsCredit");
  const mode = watch("creditReceiveMode");
  const rates = watch("rates");
  const max = watch("maxInstallments");

  const onMaxChange = (value: number) => {
    setValue("maxInstallments", value, { shouldValidate: true });
    if (Number.isInteger(value) && value >= 1 && value <= MAX_CARD_INSTALLMENTS) {
      setValue("rates", resizeRates(rates, value), { shouldValidate: true });
    }
  };

  return (
    <fieldset className="space-y-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-semibold">Crédito</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" {...register("acceptsCredit")} />
        Esta maquininha aceita crédito
      </label>

      {acceptsCredit ? <>
          <div role="radiogroup" aria-label="Como o crédito é recebido" className="grid gap-2 sm:grid-cols-2">
            {MODES.map((m) => (
              <button key={m.value} type="button" role="radio" aria-checked={mode === m.value}
                onClick={() => setValue("creditReceiveMode", m.value, { shouldDirty: true })}
                className={cn(
                  "rounded-md border p-3 text-left transition-colors",
                  mode === m.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
                )}>
                <span className="block text-sm font-medium">{m.title}</span>
                <span className="block text-xs text-muted-foreground">{m.description}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="credit-days" className="text-sm font-medium">
                {mode === "ANTICIPATED" ? "Cai em (dias)" : "1º repasse em (dias)"}
              </label>
              <Input id="credit-days" type="number" min={0} max={365}
                {...register("creditSettlementDays", { valueAsNumber: true })} />
              <p className="text-xs text-muted-foreground">
                {mode === "ANTICIPATED"
                  ? "Quando o valor inteiro da venda cai na conta."
                  : "As demais parcelas caem a cada 30 dias depois dele."}
              </p>
              {errors.creditSettlementDays ? <p className="text-xs text-destructive">{errors.creditSettlementDays.message}</p> : null}
            </div>
            <div className="space-y-1">
              <label htmlFor="credit-max" className="text-sm font-medium">Parcela em até</label>
              <Input id="credit-max" type="number" min={1} max={MAX_CARD_INSTALLMENTS}
                value={Number.isNaN(max) ? "" : max}
                onChange={(e) => onMaxChange(e.target.valueAsNumber)} />
              {errors.maxInstallments ? <p className="text-xs text-destructive">{errors.maxInstallments.message}</p> : null}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Taxa total por número de parcelas</p>
            <CreditRatesField rates={rates} errors={errors.rates}
              onChange={(next) => setValue("rates", next, { shouldValidate: true, shouldDirty: true })} />
          </div>
        </> : null}
    </fieldset>
  );
}
