/** One entry of an import job report, as the API stores it. */
export interface ReportIssue {
  line: number;
  message: string;
  /** Absent in the CSV importer's report: those entries are all errors. */
  severity?: "error" | "warning" | "info";
  code?: string;
}

const WARNING_LABELS: Record<string, string> = {
  CFOP_NOT_SALE: "CFOP de entrada ignorado (não vai para a NF-e)",
  EAN_INVALID: "Código de barras inválido (produto importado sem ele)",
  EAN_SCIENTIFIC_NOTATION: "Código de barras corrompido pelo Excel (importado sem ele)",
  EAN_DUPLICATE: "Código de barras repetido (só o primeiro produto manteve)",
  NCM_INVALID: "NCM inválido (importado sem ele)",
  NCM_MISSING: "Produto sem NCM",
  CEST_INVALID: "CEST inválido (importado sem ele)",
  SALE_PRICE_MISSING: "Sem preço de venda (importado como rascunho)",
  SALE_BELOW_COST: "Preço de venda abaixo do custo",
  STOCK_NEGATIVE: "Estoque negativo (importado como 0)",
  STOCK_FRACTIONAL: "Estoque fracionado (arredondado)",
};

const GENERIC_LABEL = "Outros avisos";

export function splitIssues(issues: ReportIssue[] | null | undefined): {
  errors: ReportIssue[];
  warnings: ReportIssue[];
  notes: ReportIssue[];
} {
  const out = { errors: [] as ReportIssue[], warnings: [] as ReportIssue[], notes: [] as ReportIssue[] };
  for (const issue of issues ?? []) {
    if (issue.severity === "warning") {
      out.warnings.push(issue);
    } else if (issue.severity === "info") {
      out.notes.push(issue);
    } else {
      out.errors.push(issue);
    }
  }
  return out;
}

export function groupWarnings(
  warnings: ReportIssue[]
): { code: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const w of warnings) {
    const key = w.code ?? "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({
      code,
      count,
      label: code === "" ? GENERIC_LABEL : (WARNING_LABELS[code] ?? code),
    }));
}

const KIND_LABEL = { error: "Erro", warning: "Aviso", info: "Informação" } as const;

/** A cell that starts with = + - @ is read as a formula by Excel: defuse it. */
function csvText(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** `;`-separated with a BOM: what Excel in pt-BR opens correctly. */
export function buildReportCsv(issues: ReportIssue[]): string {
  const rows = issues.map((i) =>
    [
      i.line > 0 ? String(i.line) : "",
      KIND_LABEL[i.severity ?? "error"],
      i.code ?? "",
      csvText(i.message),
    ].join(";")
  );
  return `﻿Linha;Tipo;Código;Mensagem\n${rows.join("\n")}\n`;
}
