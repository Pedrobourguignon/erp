"use client";

import React, { useState } from "react";
import type { FieldErrors } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CardMachineRate } from "@/hooks/use-card-machines";
import { fillRateRange, type CardMachineFormValues } from "@/lib/card-machine-form";

interface CreditRatesFieldProps {
  rates: CardMachineRate[];
  onChange: (rates: CardMachineRate[]) => void;
  errors?: FieldErrors<CardMachineFormValues>["rates"];
}

/**
 * A taxa total de cada número de parcelas, como o app da maquininha mostra.
 * O atalho preenche uma faixa de uma vez ("de 2x até 6x: 4,99%"), que é como a
 * maioria das operadoras informa o parcelado.
 */
export function CreditRatesField({ rates, onChange, errors }: CreditRatesFieldProps) {
  const max = rates.length;
  // `to: null` = "até o máximo": acompanha a tabela até o usuário mexer nele.
  const [range, setRange] = useState<{ from: number; to: number | null; fee: string }>({
    from: 2,
    to: null,
    fee: "",
  });
  const to = Math.min(range.to ?? max, max);

  const applyRange = () => {
    const fee = Number(range.fee.replace(",", "."));
    if (range.fee.trim() === "" || !Number.isFinite(fee) || fee < 0 || fee > 100) {return;}
    onChange(fillRateRange(rates, range.from, to, fee));
  };

  const setRate = (installments: number, value: string) => {
    const fee = value === "" ? Number.NaN : Number(value);
    onChange(rates.map((r) => (r.installments === installments ? { ...r, feePercentage: fee } : r)));
  };

  return (
    <div className="space-y-3">
      {max > 1 && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
          <span className="w-full text-xs font-medium text-muted-foreground">
            Preencher uma faixa de uma vez
          </span>
          <RangeInput label="De" value={range.from} max={max}
            onChange={(from) => setRange((r) => ({ ...r, from }))} />
          <RangeInput label="Até" value={to} max={max}
            onChange={(to) => setRange((r) => ({ ...r, to }))} />
          <div className="space-y-1">
            <label htmlFor="rate-range-fee" className="text-xs text-muted-foreground">Taxa (%)</label>
            <Input id="rate-range-fee" inputMode="decimal" className="h-9 w-24" placeholder="4,99"
              maxLength={6} value={range.fee}
              onChange={(e) => setRange((r) => ({ ...r, fee: e.target.value }))} />
          </div>
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={applyRange}>
            Aplicar
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rates.map((rate, index) => {
          const error = errors?.[index]?.feePercentage?.message;
          const id = `rate-${rate.installments}`;
          return (
            <div key={rate.installments} className="space-y-1">
              <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
                {rate.installments === 1 ? "À vista (1x)" : `${rate.installments}x`}
              </label>
              <div className="relative">
                <Input id={id} type="number" step={0.01} min={0} max={100} className="h-9 pr-7"
                  value={Number.isNaN(rate.feePercentage) ? "" : rate.feePercentage}
                  onChange={(e) => setRate(rate.installments, e.target.value)} />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
              </div>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RangeInput({ label, value, max, onChange }: {
  label: string; value: number; max: number; onChange: (value: number) => void;
}) {
  const id = `rate-range-${label.toLowerCase()}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">{label}</label>
      <Input id={id} type="number" min={1} max={max} className="h-9 w-16" value={value}
        onChange={(e) => onChange(Math.min(Math.max(Number(e.target.value) || 1, 1), max))} />
    </div>
  );
}
