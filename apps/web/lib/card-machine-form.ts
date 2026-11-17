import { z } from "zod";

import type { CardMachineRate } from "@/hooks/use-card-machines";

/** Teto da tabela — o mesmo da API. */
export const MAX_CARD_INSTALLMENTS = 24;

const percentage = (label: string) =>
  z
    .number({ invalid_type_error: `Informe ${label}` })
    .min(0, "A taxa não pode ser negativa")
    .max(100, "A taxa não pode passar de 100%");

const days = z
  .number({ invalid_type_error: "Informe o prazo em dias" })
  .int("Informe um número inteiro de dias")
  .min(0, "O prazo não pode ser negativo")
  .max(365, "O prazo máximo é 365 dias");

export const cardMachineSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome da maquininha")
    .max(100, "O nome tem no máximo 100 caracteres"),
  provider: z.string().max(50, "A operadora tem no máximo 50 caracteres").optional(),
  debitFeePercentage: percentage("a taxa do débito"),
  debitSettlementDays: days,
  /** Só na tela: sem crédito, a tabela vai vazia. */
  acceptsCredit: z.boolean(),
  creditReceiveMode: z.enum(["FLOW", "ANTICIPATED"]),
  creditSettlementDays: days,
  maxInstallments: z
    .number({ invalid_type_error: "Informe o máximo de parcelas" })
    .int("Informe um número inteiro de parcelas")
    .min(1, "O mínimo é 1x")
    .max(MAX_CARD_INSTALLMENTS, `O máximo é ${MAX_CARD_INSTALLMENTS} parcelas`),
  rates: z.array(
    z.object({
      installments: z.number().int(),
      feePercentage: percentage("a taxa desta parcela"),
    })
  ),
  isActive: z.boolean().default(true),
});

export type CardMachineFormValues = z.infer<typeof cardMachineSchema>;

/**
 * A tabela sempre vai de 1x até o máximo (a API recusa buracos). Ao crescer,
 * as linhas novas repetem a última taxa — no parcelado ela costuma valer por
 * uma faixa inteira; ao encolher, o que já foi digitado se mantém.
 */
export function resizeRates(rates: CardMachineRate[], max: number): CardMachineRate[] {
  const size = Math.max(0, Math.min(Math.trunc(max) || 0, MAX_CARD_INSTALLMENTS));
  const byInstallment = new Map(rates.map((r) => [r.installments, r.feePercentage]));
  let last = 0;
  return Array.from({ length: size }, (_, i) => {
    const fee = byInstallment.get(i + 1) ?? last;
    last = fee;
    return { installments: i + 1, feePercentage: fee };
  });
}

/** "De 2x até 6x: 4,99%" — como a operadora costuma informar o parcelado. */
export function fillRateRange(
  rates: CardMachineRate[],
  from: number,
  to: number,
  feePercentage: number
): CardMachineRate[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return rates.map((rate) =>
    rate.installments >= start && rate.installments <= end
      ? { ...rate, feePercentage }
      : rate
  );
}
