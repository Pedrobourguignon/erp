import * as ExcelJS from 'exceljs';

import { importProducts } from './import-products';
import { runProductSpreadsheetImport } from './run-spreadsheet-import';

jest.mock('./import-products', () => ({
  ...jest.requireActual<typeof import('./import-products')>('./import-products'),
  importProducts: jest.fn(),
}));

const importMock = importProducts as jest.MockedFunction<typeof importProducts>;

const HEADER = [
  'ID_PRODUTO',
  'NOME',
  'CÓDIGO DE BARRAS',
  'NCM',
  'CFOP SAIDA',
  'VALOR DE CUSTO',
  'VALOR DE VENDA',
  'ESTOQUE',
];

async function sheet(...rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Worksheet');
  ws.addRow(HEADER);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const outcome = (over = {}) => ({
  applied: true,
  toCreate: 0,
  skippedExisting: 0,
  rejected: 0,
  categoriesToCreate: 0,
  stockUnits: 0,
  skippedSkus: [] as string[],
  ...over,
});

beforeEach(() => importMock.mockReset());

describe('runProductSpreadsheetImport', () => {
  it('should import the mapped rows into the given tenant', async () => {
    importMock.mockResolvedValue(outcome({ toCreate: 2 }));
    const file = await sheet(
      [1, 'CINTA P', 7892524980721, 63090010, 5102, 25.5, 69.9, 2],
      [2, 'CINTA M', 7892524980714, 63090010, 5102, 25.5, 69.9, 1],
    );

    const result = await runProductSpreadsheetImport({} as never, 'tenant-1', file);

    expect(importMock).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      expect.arrayContaining([expect.objectContaining({ sku: 'PRD-000001' })]),
      { apply: true },
    );
    expect(result).toMatchObject({ totalRows: 2, successRows: 2, errorRows: 0, issues: [] });
  });

  it('should report adjustments as warnings carrying the spreadsheet line', async () => {
    importMock.mockResolvedValue(outcome({ toCreate: 1 }));
    const file = await sheet([1, 'CINTA P', 7892524980720, 63090010, 2102, 25.5, 69.9, 2]);

    const { issues } = await runProductSpreadsheetImport({} as never, 'tenant-1', file);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 2, severity: 'warning', code: 'EAN_INVALID' }),
        expect.objectContaining({ line: 2, severity: 'warning', code: 'CFOP_NOT_SALE' }),
      ]),
    );
  });

  it('should report a rejected row as an error', async () => {
    importMock.mockResolvedValue(outcome({ rejected: 1 }));
    const file = await sheet([1, '   ', null, 63090010, 5102, 25.5, 69.9, 2]);

    const result = await runProductSpreadsheetImport({} as never, 'tenant-1', file);

    expect(result.errorRows).toBe(1);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ line: 2, severity: 'error', code: 'NAME_MISSING' }),
    );
  });

  it('should not repeat warnings for products that already existed, but say they were skipped', async () => {
    importMock.mockResolvedValue(outcome({ skippedExisting: 1, skippedSkus: ['PRD-000001'] }));
    const file = await sheet([1, 'CINTA P', 7892524980720, 63090010, 2102, 25.5, 69.9, 2]);

    const { issues, successRows } = await runProductSpreadsheetImport({} as never, 'tenant-1', file);

    expect(successRows).toBe(0);
    expect(issues.filter((i) => i.severity === 'warning')).toEqual([]);
    expect(issues).toContainEqual(
      expect.objectContaining({ line: 0, severity: 'info', message: expect.stringMatching(/1 produto.*já existia/) }),
    );
  });

  it('should cap the issue list and say so', async () => {
    importMock.mockResolvedValue(outcome({ toCreate: 6000 }));
    const rows = Array.from({ length: 6000 }, (_, i) => [i + 1, `P ${i + 1}`, null, 63090010, 2102, 1, 2, 0]);

    const { issues } = await runProductSpreadsheetImport({} as never, 'tenant-1', await sheet(...rows));

    expect(issues.length).toBeLessThanOrEqual(5001);
    expect(issues[issues.length - 1]).toMatchObject({ severity: 'info', message: expect.stringMatching(/primeiros 5000/) });
  });

  it('should fail with a readable message when a required column is missing', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('W').addRow(['FOO', 'BAR']);

    await expect(
      runProductSpreadsheetImport({} as never, 'tenant-1', Buffer.from(await wb.xlsx.writeBuffer())),
    ).rejects.toThrow(/coluna obrigatória/);
    expect(importMock).not.toHaveBeenCalled();
  });
});
