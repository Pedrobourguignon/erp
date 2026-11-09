import type { PrismaClient } from '@prisma/client';

import { importProducts } from './import-products';
import { dedupeBarcodes, mapProductRow } from './map-product-row';
import { readProductRows } from './read-product-rows';

/** Keeps the job row (a JSON column) a sane size for a very noisy file. */
const MAX_ISSUES = 5000;

export type IssueSeverity = 'error' | 'warning' | 'info';

/** One entry of the job report. `line` 0 means "about the whole file". */
export interface JobIssue {
  line: number;
  message: string;
  severity: IssueSeverity;
  code?: string;
}

export interface SpreadsheetImportOutcome {
  totalRows: number;
  successRows: number;
  errorRows: number;
  issues: JobIssue[];
}

/**
 * Runs a product spreadsheet import for one tenant and shapes the result like an
 * ImportJob report. Used by the background worker; the CLI uses the same
 * pieces directly.
 *
 * A rejected row is an `error`; an adjusted row (invalid barcode dropped, entry
 * CFOP ignored…) is a `warning` — it was imported, but not exactly as written.
 */
export async function runProductSpreadsheetImport(
  prisma: PrismaClient,
  tenantId: string,
  file: Buffer,
): Promise<SpreadsheetImportOutcome> {
  const raw = await readProductRows(file);
  const mapped = dedupeBarcodes(raw.map(mapProductRow));
  const result = await importProducts(prisma, tenantId, mapped, { apply: true });

  const skipped = new Set(result.skippedSkus);
  const issues: JobIssue[] = [];

  if (result.skippedExisting > 0) {
    const n = result.skippedExisting;
    issues.push({
      line: 0,
      severity: 'info',
      message: `${n} ${n === 1 ? 'produto já existia' : 'produtos já existiam'} (mesmo SKU) e ${n === 1 ? 'foi mantido' : 'foram mantidos'} sem alteração.`,
    });
  }

  for (const row of mapped) {
    if (skipped.has(row.sku)) {
      continue;
    }
    for (const issue of row.issues) {
      issues.push({
        line: row.rowNumber,
        severity: row.rejected ? 'error' : 'warning',
        code: issue.code,
        message: issue.message,
      });
    }
  }

  const capped = issues.length > MAX_ISSUES;
  const kept = capped ? issues.slice(0, MAX_ISSUES) : issues;
  if (capped) {
    kept.push({
      line: 0,
      severity: 'info',
      message: `Foram mostrados apenas os primeiros ${MAX_ISSUES} avisos de ${issues.length}.`,
    });
  }

  return {
    totalRows: raw.length,
    successRows: result.toCreate,
    errorRows: result.rejected,
    issues: kept,
  };
}
