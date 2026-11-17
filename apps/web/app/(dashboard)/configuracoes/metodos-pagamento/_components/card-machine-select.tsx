"use client";

import Link from "next/link";
import React from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCardMachines } from "@/hooks/use-card-machines";
import { isPermissionError } from "@/lib/api-errors";
import {
  describeCreditReceipt,
  describeDebitReceipt,
  summarizeRates,
} from "@/lib/card-machine-format";

interface CardMachineSelectProps {
  value: string;
  onChange: (value: string) => void;
  /** Débito mostra a taxa do débito; crédito, a tabela de parcelas. */
  kind: "CREDIT_CARD" | "DEBIT_CARD";
  error?: string;
}

/**
 * No cartão, taxa, prazo e parcelas vêm da maquininha: o método só aponta
 * para ela. O resumo abaixo do campo mostra o que vai valer na venda.
 */
export function CardMachineSelect({ value, onChange, kind, error }: CardMachineSelectProps) {
  const { data, error: loadError } = useCardMachines({ isActive: true });
  const machines = data?.data ?? [];
  const selected = machines.find((m) => m.id === value);

  return (
    <div className="space-y-1">
      <label htmlFor="method-card-machine" className="text-sm font-medium">Maquininha *</label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id="method-card-machine">
          <SelectValue placeholder="Selecione a maquininha" />
        </SelectTrigger>
        <SelectContent>
          {machines.map((m) => (
            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selected ? <p className="text-xs text-muted-foreground">
          {kind === "DEBIT_CARD"
            ? `Débito ${Number(selected.debitFeePercentage).toLocaleString("pt-BR")}% · ${describeDebitReceipt(selected.debitSettlementDays)}`
            : `${summarizeRates(selected.rates)} · ${describeCreditReceipt(selected.creditReceiveMode, selected.creditSettlementDays)}`}
        </p> : null}

      {loadError ? <p className="text-xs text-amber-600 dark:text-amber-400">
          {isPermissionError(loadError)
            ? "Você não tem permissão para ver as maquininhas."
            : "Não foi possível carregar as maquininhas."}
        </p> : null}

      {!loadError && data && machines.length === 0 ? <p className="text-xs text-muted-foreground">
          Nenhuma maquininha ativa.{" "}
          <Link href="/configuracoes/maquininhas" className="font-medium text-primary underline-offset-2 hover:underline">
            Cadastre uma
          </Link>{" "}
          com as taxas do débito e do crédito.
        </p> : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
