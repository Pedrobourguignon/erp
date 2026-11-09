import { isSaleCFOP, isValidCEST, isValidGTIN, isValidNCM, onlyDigits } from '@erp/validators';

/** A spreadsheet row as read from the file: cells are text, numbers or empty. */
export interface RawProductRow {
  rowNumber: number;
  id: unknown;
  name: unknown;
  code: unknown;
  barcode: unknown;
  ncm: unknown;
  cfop: unknown;
  cest: unknown;
  unit: unknown;
  cost: unknown;
  sale: unknown;
  stock: unknown;
  group: unknown;
  category: unknown;
}

export type IssueCode =
  | 'NAME_MISSING'
  | 'SKU_DUPLICATE'
  | 'SALE_PRICE_MISSING'
  | 'SALE_BELOW_COST'
  | 'STOCK_NEGATIVE'
  | 'STOCK_FRACTIONAL'
  | 'EAN_INVALID'
  | 'EAN_SCIENTIFIC_NOTATION'
  | 'EAN_DUPLICATE'
  | 'NCM_INVALID'
  | 'NCM_MISSING'
  | 'CEST_INVALID'
  | 'CFOP_NOT_SALE';

export interface ImportIssue {
  code: IssueCode;
  message: string;
}

export interface MappedProductRow {
  rowNumber: number;
  /** A rejected row is not imported at all. */
  rejected: boolean;
  sku: string;
  name: string;
  ean: string | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  costPrice: number;
  salePrice: number;
  status: 'ACTIVE' | 'DRAFT';
  stockQuantity: number;
  /** Root first: `['Feminino', 'Calcinha']`. */
  categoryPath: string[];
  metadata: {
    legacyId: string | number | null;
    legacyCode: string | null;
    unit: string | null;
    importedFrom: 'planilha';
  };
  issues: ImportIssue[];
}

/** Cell → text. Only scalars; an object cell (formula, link) reads as empty. */
const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value).trim()
    : '';

/** `25.5`, `'25,50'` and `'R$ 25,50'` all become `25.5`; anything else is `null`. */
function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const cleaned = text(value).replace(/R\$/gi, '').replace(/\s/g, '');
  if (cleaned === '') {
    return null;
  }
  const normalised = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

const toCents = (value: number): number => Math.round(value * 100);

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function buildSku(id: unknown, rowNumber: number): string {
  const numeric = parseNumber(id);
  if (numeric !== null && Number.isInteger(numeric) && numeric > 0) {
    return `PRD-${String(numeric).padStart(6, '0')}`;
  }
  return `PRD-R${String(rowNumber).padStart(6, '0')}`;
}

function mapBarcode(value: unknown, issues: ImportIssue[]): string | null {
  const raw = text(value);
  if (raw === '') {
    return null;
  }
  // Excel stores long codes as numbers and prints `7.89E+14`: the low digits are
  // gone for good, so this is not a formatting problem we can undo.
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(raw)) {
    issues.push({
      code: 'EAN_SCIENTIFIC_NOTATION',
      message: `Código de barras "${raw}" perdeu dígitos na planilha (notação científica).`,
    });
    return null;
  }
  const digits = /^\d+$/.test(raw) ? raw : '';
  if (!digits || !isValidGTIN(digits)) {
    issues.push({ code: 'EAN_INVALID', message: `Código de barras "${raw}" inválido.` });
    return null;
  }
  return digits;
}

function mapFiscal(
  raw: RawProductRow,
  issues: ImportIssue[],
): Pick<MappedProductRow, 'ncm' | 'cest' | 'cfop'> {
  const ncmRaw = onlyDigits(text(raw.ncm));
  let ncm: string | null = null;
  if (ncmRaw === '') {
    issues.push({ code: 'NCM_MISSING', message: 'Produto sem NCM.' });
  } else if (isValidNCM(ncmRaw)) {
    ncm = ncmRaw;
  } else {
    issues.push({ code: 'NCM_INVALID', message: `NCM "${ncmRaw}" não tem 8 dígitos.` });
  }

  const cestRaw = onlyDigits(text(raw.cest));
  // 0000000 is what the source system writes for "no CEST".
  const cest = cestRaw !== '' && !/^0+$/.test(cestRaw) && isValidCEST(cestRaw) ? cestRaw : null;
  if (cestRaw !== '' && !/^0+$/.test(cestRaw) && cest === null) {
    issues.push({ code: 'CEST_INVALID', message: `CEST "${cestRaw}" inválido.` });
  }

  const cfopRaw = onlyDigits(text(raw.cfop));
  let cfop: string | null = null;
  if (cfopRaw !== '') {
    if (isSaleCFOP(cfopRaw)) {
      cfop = cfopRaw;
    } else {
      issues.push({
        code: 'CFOP_NOT_SALE',
        message: `CFOP "${cfopRaw}" é de entrada ou inválido; um produto à venda precisa de CFOP de saída (5/6/7).`,
      });
    }
  }

  return { ncm, cest, cfop };
}

function mapStock(value: unknown, issues: ImportIssue[]): number {
  const stock = parseNumber(value);
  if (stock === null) {
    return 0;
  }
  if (stock < 0) {
    issues.push({
      code: 'STOCK_NEGATIVE',
      message: `Estoque negativo (${stock}) importado como 0.`,
    });
    return 0;
  }
  if (!Number.isInteger(stock)) {
    issues.push({
      code: 'STOCK_FRACTIONAL',
      message: `Estoque fracionado (${stock}) arredondado.`,
    });
    return Math.round(stock);
  }
  return stock;
}

/** Pure mapping of one spreadsheet row; nothing here touches the database. */
export function mapProductRow(raw: RawProductRow): MappedProductRow {
  const issues: ImportIssue[] = [];
  const name = text(raw.name).replace(/\s+/g, ' ');
  if (name === '') {
    issues.push({ code: 'NAME_MISSING', message: 'Linha sem nome de produto.' });
  }

  const costPrice = Math.max(toCents(parseNumber(raw.cost) ?? 0), 0) / 100;
  const parsedSale = parseNumber(raw.sale);
  const salePrice = parsedSale !== null && parsedSale > 0 ? toCents(parsedSale) / 100 : 0;
  if (salePrice === 0) {
    issues.push({
      code: 'SALE_PRICE_MISSING',
      message: 'Sem preço de venda: importado como rascunho.',
    });
  } else if (costPrice > 0 && salePrice < costPrice) {
    issues.push({
      code: 'SALE_BELOW_COST',
      message: `Preço de venda (${salePrice}) abaixo do custo (${costPrice}).`,
    });
  }

  const group = text(raw.group);
  const category = text(raw.category);

  return {
    rowNumber: raw.rowNumber,
    rejected: name === '',
    sku: buildSku(raw.id, raw.rowNumber),
    name,
    ean: mapBarcode(raw.barcode, issues),
    ...mapFiscal(raw, issues),
    costPrice,
    salePrice,
    status: salePrice > 0 ? 'ACTIVE' : 'DRAFT',
    stockQuantity: mapStock(raw.stock, issues),
    categoryPath: [category, group].filter((s) => s !== '').map(titleCase),
    metadata: {
      legacyId: parseNumber(raw.id) ?? (text(raw.id) || null),
      legacyCode: text(raw.code) || null,
      unit: text(raw.unit) || null,
      importedFrom: 'planilha',
    },
    issues,
  };
}

/**
 * Cross-row rules. A repeated barcode keeps its first owner, because a scanner
 * that finds two products for one code sells the wrong one. A repeated SKU is
 * refused: it would collide on the unique index.
 */
export function dedupeBarcodes(rows: MappedProductRow[]): MappedProductRow[] {
  const barcodes = new Set<string>();
  const skus = new Set<string>();

  return rows.map((row) => {
    if (row.rejected) {
      return row;
    }
    if (skus.has(row.sku)) {
      return {
        ...row,
        rejected: true,
        issues: [
          ...row.issues,
          { code: 'SKU_DUPLICATE', message: `SKU ${row.sku} repetido na planilha.` },
        ],
      };
    }
    skus.add(row.sku);

    if (row.ean === null) {
      return row;
    }
    if (barcodes.has(row.ean)) {
      return {
        ...row,
        ean: null,
        issues: [
          ...row.issues,
          {
            code: 'EAN_DUPLICATE',
            message: `Código de barras ${row.ean} já usado por outro produto da planilha.`,
          },
        ],
      };
    }
    barcodes.add(row.ean);
    return row;
  });
}
