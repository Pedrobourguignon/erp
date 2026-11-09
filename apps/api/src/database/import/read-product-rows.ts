import * as ExcelJS from 'exceljs';

import type { RawProductRow } from './map-product-row';

type Field = Exclude<keyof RawProductRow, 'rowNumber'>;

/** Header text (before any parenthesised hint), upper-case and without accents. */
function normaliseHeader(value: unknown): string {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return raw
    .split('(')[0]
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
}

const COLUMNS: Record<Field, { header: string; required: boolean }> = {
  id: { header: 'ID_PRODUTO', required: false },
  name: { header: 'NOME', required: true },
  code: { header: 'CODIGO DO PRODUTO', required: false },
  barcode: { header: 'CODIGO DE BARRAS', required: false },
  ncm: { header: 'NCM', required: false },
  cfop: { header: 'CFOP SAIDA', required: false },
  cest: { header: 'CEST', required: false },
  unit: { header: 'UNIDADE', required: false },
  cost: { header: 'VALOR DE CUSTO', required: false },
  sale: { header: 'VALOR DE VENDA', required: true },
  stock: { header: 'ESTOQUE', required: false },
  group: { header: 'GRUPO', required: false },
  category: { header: 'CATEGORIA', required: false },
};

/** exceljs wraps formulas, rich text and hyperlinks in objects; unwrap to the value. */
function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object' && !(value instanceof Date)) {
    if ('richText' in value) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('result' in value) {
      return value.result ?? null;
    }
    if ('text' in value) {
      return value.text;
    }
    return null;
  }
  return value;
}

/**
 * Reads the first sheet of a product export. Columns are found by header name,
 * so a reordered export still imports; a missing essential column is an error
 * rather than a silent column of blanks.
 */
export async function readProductRows(file: Buffer): Promise<RawProductRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('A planilha não tem nenhuma aba.');
  }

  const indexByHeader = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, col) => {
    indexByHeader.set(normaliseHeader(cellValue(cell.value)), col);
  });

  const columnOf = {} as Record<Field, number | undefined>;
  const missing: string[] = [];
  for (const [field, def] of Object.entries(COLUMNS) as [Field, (typeof COLUMNS)[Field]][]) {
    columnOf[field] = indexByHeader.get(def.header);
    if (columnOf[field] === undefined && def.required) {
      missing.push(def.header);
    }
  }
  if (missing.length > 0) {
    throw new Error(`A planilha não tem a coluna obrigatória: ${missing.join(', ')}.`);
  }

  const rows: RawProductRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const read = (field: Field): unknown => {
      const col = columnOf[field];
      return col === undefined ? null : cellValue(row.getCell(col).value);
    };
    const raw: RawProductRow = {
      rowNumber,
      id: read('id'),
      name: read('name'),
      code: read('code'),
      barcode: read('barcode'),
      ncm: read('ncm'),
      cfop: read('cfop'),
      cest: read('cest'),
      unit: read('unit'),
      cost: read('cost'),
      sale: read('sale'),
      stock: read('stock'),
      group: read('group'),
      category: read('category'),
    };
    if (Object.entries(raw).some(([key, v]) => key !== 'rowNumber' && v !== null && v !== '')) {
      rows.push(raw);
    }
  });
  return rows;
}
