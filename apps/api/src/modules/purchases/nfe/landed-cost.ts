import type { NfeItem, ParsedNfe } from './nfe-parser';

/**
 * Reparte `totalCents` na proporção dos `weights`, sem perder nem inventar um
 * centavo: o resto da divisão vai para quem tem a maior parte fracionária
 * (método do maior resto). A soma do resultado é sempre `totalCents`.
 */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (totalCents === 0 || weightSum === 0) {
    return weights.map(() => 0);
  }

  const raw = weights.map((w) => (totalCents * w) / weightSum);
  const parts = raw.map(Math.floor);
  let remainder = totalCents - parts.reduce((sum, p) => sum + p, 0);

  const byFraction = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of byFraction) {
    if (remainder <= 0) break;
    parts[index] += 1;
    remainder -= 1;
  }
  return parts;
}

export interface LandedCostBreakdown {
  grossCents: number;
  discountCents: number;
  freightCents: number;
  insuranceCents: number;
  otherCents: number;
  ipiCents: number;
  stCents: number;
}

export interface LandedCost {
  line: number;
  /** Custo de aquisição do item inteiro, em centavos. */
  totalCents: number;
  /** Custo de aquisição por unidade, em reais, com 4 casas (a coluna do banco). */
  unitCost: number;
  /** A API só movimenta estoque em unidades inteiras. */
  wholeQuantity: boolean;
  breakdown: LandedCostBreakdown;
}

type Component = Exclude<keyof LandedCostBreakdown, 'grossCents'>;

const COMPONENTS: Component[] = [
  'discountCents',
  'freightCents',
  'insuranceCents',
  'otherCents',
  'ipiCents',
  'stCents',
];

/**
 * Quanto cada item recebe de um componente (frete, desconto, IPI…).
 *
 * Se os itens trazem o valor e ele fecha com o total da nota, vale o do item. Se
 * não trazem (frete só no total, por exemplo) ou não fecham, o total da nota
 * manda e é rateado pelo valor dos produtos.
 */
function shareOf(
  component: Component,
  items: NfeItem[],
  invoiceTotal: number,
): number[] {
  const perItem = items.map((item) => item[component]);
  const itemSum = perItem.reduce((sum, v) => sum + v, 0);
  if (invoiceTotal === 0 || Math.abs(itemSum - invoiceTotal) <= 1) {
    return perItem;
  }
  return allocateCents(
    invoiceTotal,
    items.map((item) => item.grossCents),
  );
}

/**
 * Custo de aquisição de cada item da nota (ADR 0004): valor do produto, menos o
 * desconto, mais frete, seguro, outras despesas, IPI e ICMS-ST. É o custo real de
 * trazer a mercadoria — o preço de lista fica abaixo dele e a margem pareceria
 * maior do que é.
 */
export function computeLandedCosts(nfe: ParsedNfe): LandedCost[] {
  const shares = Object.fromEntries(
    COMPONENTS.map((c) => [c, shareOf(c, nfe.items, nfe.totals[c])]),
  ) as Record<Component, number[]>;

  return nfe.items.map((item, index) => {
    const breakdown: LandedCostBreakdown = {
      grossCents: item.grossCents,
      discountCents: shares.discountCents[index],
      freightCents: shares.freightCents[index],
      insuranceCents: shares.insuranceCents[index],
      otherCents: shares.otherCents[index],
      ipiCents: shares.ipiCents[index],
      stCents: shares.stCents[index],
    };
    const totalCents =
      breakdown.grossCents -
      breakdown.discountCents +
      breakdown.freightCents +
      breakdown.insuranceCents +
      breakdown.otherCents +
      breakdown.ipiCents +
      breakdown.stCents;

    const unitCost =
      item.quantity > 0
        ? Math.round((totalCents / item.quantity) * 100) / 10000
        : 0;

    return {
      line: item.line,
      totalCents,
      unitCost,
      wholeQuantity: Number.isInteger(item.quantity) && item.quantity > 0,
      breakdown,
    };
  });
}
