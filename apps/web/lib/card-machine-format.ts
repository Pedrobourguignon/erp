import type { CardReceiveMode } from "@erp/validators";

import type { CardMachineRate } from "@/hooks/use-card-machines";
import { pluralize } from "@/lib/utils";

const percent = (value: number) =>
  `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

/** "1x 3,19% · 2–6x 4,99%": as faixas como a operadora costuma informar. */
export function summarizeRates(rates: CardMachineRate[]): string {
  if (rates.length === 0) {return "Não aceita crédito";}

  const groups: { from: number; to: number; fee: number }[] = [];
  for (const rate of [...rates].sort((a, b) => a.installments - b.installments)) {
    const last = groups[groups.length - 1];
    if (last && last.fee === Number(rate.feePercentage) && last.to === rate.installments - 1) {
      last.to = rate.installments;
    } else {
      groups.push({ from: rate.installments, to: rate.installments, fee: Number(rate.feePercentage) });
    }
  }

  return groups
    .map((g) => `${g.from === g.to ? `${g.from}x` : `${g.from}–${g.to}x`} ${percent(g.fee)}`)
    .join(" · ");
}

function inDays(days: number): string {
  return days === 0 ? "na hora" : `em ${pluralize(days, "dia", "dias")}`;
}

export function describeDebitReceipt(days: number): string {
  return `Cai ${inDays(days)}`;
}

export function describeCreditReceipt(mode: CardReceiveMode, days: number): string {
  if (mode === "ANTICIPATED") {return `Antecipado · tudo ${inDays(days)}`;}
  return `Parcela a parcela · 1º repasse ${inDays(days)}`;
}
