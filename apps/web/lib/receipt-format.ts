import type { ReceiptFormat } from "@erp/shared-types";

import { formatCurrency } from "@/lib/utils";

/**
 * "3x de R$ 50,00", or the groups in the order they are due when the split
 * left a cent over: "2x de R$ 33,33 + 1x de R$ 33,34". Empty for a single
 * payment — "1x" on a cash receipt is noise.
 */
export function installmentsLabel(values: number[]): string {
  if (values.length <= 1) {return "";}
  const groups: { value: number; count: number }[] = [];
  for (const value of values) {
    const last = groups[groups.length - 1];
    if (last && last.value === value) {
      last.count += 1;
    } else {
      groups.push({ value, count: 1 });
    }
  }
  return groups.map((g) => `${g.count}x de ${formatCurrency(g.value)}`).join(" + ");
}

/** The original prints nothing; a reprint says which copy it is. */
export function copyLabel(copy: number): string | null {
  return copy > 1 ? `${copy}ª VIA` : null;
}

/** CSS pixels are 96 per inch. */
export function pxToMm(px: number): number {
  return (px * 25.4) / 96;
}

const ROLL_WIDTH_MM: Record<"THERMAL_80" | "THERMAL_58", number> = {
  THERMAL_80: 80,
  THERMAL_58: 58,
};

/** A page shorter than this is a driver that will not feed at all. */
const MIN_ROLL_LENGTH_MM = 50;

/** Blank paper after the last line, so the cutter does not slice through it. */
const ROLL_FEED_MM = 6;

/**
 * The paper of the store's printer.
 *
 * A thermal roll has no fixed length, but `@page size` needs two lengths —
 * "80mm auto" is invalid CSS, so Chrome dropped the whole rule and previewed
 * the receipt on an A4 sheet. The page is cut to the receipt instead: the
 * caller measures the rendered receipt and passes its height.
 *
 * The browser's own header and footer (URL, date) must be turned off in the
 * print dialog, or they print over a narrow receipt.
 */
export function receiptPageCss(format: ReceiptFormat, contentHeightMm: number): string {
  if (format === "A4") {
    return "@page { size: A4; margin: 12mm; } body { margin: 0; }";
  }
  const length = Math.max(Math.ceil(contentHeightMm + ROLL_FEED_MM), MIN_ROLL_LENGTH_MM);
  return `@page { size: ${ROLL_WIDTH_MM[format]}mm ${length}mm; margin: 0; } body { margin: 0; }`;
}

/** Printable width of each paper: a thermal roll loses ~4 mm on each side. */
export const RECEIPT_WIDTH_CLASS: Record<ReceiptFormat, string> = {
  THERMAL_80: "mx-auto w-[72mm] text-[11px]",
  THERMAL_58: "mx-auto w-[48mm] text-[9px]",
  A4: "w-full max-w-[180mm] text-sm",
};
