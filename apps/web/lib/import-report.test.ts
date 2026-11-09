import { describe, it, expect } from "vitest";

import { buildReportCsv, groupWarnings, splitIssues, type ReportIssue } from "./import-report";

const issues: ReportIssue[] = [
  { line: 0, severity: "info", message: "3 produtos já existiam." },
  { line: 2, severity: "warning", code: "CFOP_NOT_SALE", message: "CFOP 2102 ignorado." },
  { line: 3, severity: "warning", code: "CFOP_NOT_SALE", message: "CFOP 2102 ignorado." },
  { line: 3, severity: "warning", code: "EAN_INVALID", message: 'Código "123" inválido.' },
  { line: 9, severity: "error", code: "NAME_MISSING", message: "Linha sem nome." },
];

describe("splitIssues", () => {
  it("should separate errors, warnings and notes", () => {
    const { errors, warnings, notes } = splitIssues(issues);

    expect(errors.map((i) => i.line)).toEqual([9]);
    expect(warnings).toHaveLength(3);
    expect(notes.map((i) => i.line)).toEqual([0]);
  });

  it("should treat an entry without severity as an error (the CSV report has none)", () => {
    const { errors } = splitIssues([{ line: 4, message: "Campo obrigatório ausente: sku" }]);

    expect(errors).toHaveLength(1);
  });

  it("should accept a null report", () => {
    expect(splitIssues(null)).toEqual({ errors: [], warnings: [], notes: [] });
  });
});

describe("groupWarnings", () => {
  it("should count by code, most frequent first, with a readable label", () => {
    const groups = groupWarnings(splitIssues(issues).warnings);

    expect(groups).toEqual([
      { code: "CFOP_NOT_SALE", label: expect.stringMatching(/CFOP/), count: 2 },
      { code: "EAN_INVALID", label: expect.stringMatching(/barras/i), count: 1 },
    ]);
  });

  it("should fall back to the code itself for an unknown one", () => {
    const [group] = groupWarnings([{ line: 1, severity: "warning", code: "NOVO", message: "x" }]);

    expect(group.label).toBe("NOVO");
  });

  it("should group entries with no code under a generic label", () => {
    const [group] = groupWarnings([{ line: 1, severity: "warning", message: "x" }]);

    expect(group.count).toBe(1);
    expect(group.label).toBe("Outros avisos");
  });
});

describe("buildReportCsv", () => {
  it("should start with a BOM so Excel reads the accents, and a header row", () => {
    const csv = buildReportCsv(issues);

    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\n")[0]).toBe("﻿Linha;Tipo;Código;Mensagem");
  });

  it("should write one row per entry, escaping quotes", () => {
    const rows = buildReportCsv(issues).trim().split("\n");

    expect(rows).toHaveLength(issues.length + 1);
    expect(rows[4]).toBe('3;Aviso;EAN_INVALID;"Código ""123"" inválido."');
    expect(rows[5]).toBe('9;Erro;NAME_MISSING;"Linha sem nome."');
  });

  it("should write the file-wide note without a line number", () => {
    expect(buildReportCsv(issues).split("\n")[1]).toBe(';Informação;;"3 produtos já existiam."');
  });

  it("should neutralise spreadsheet formulas coming from the file", () => {
    const csv = buildReportCsv([{ line: 2, severity: "warning", code: "X", message: "=HYPERLINK(\"http://x\")" }]);

    expect(csv).toContain("\"'=HYPERLINK");
  });
});
