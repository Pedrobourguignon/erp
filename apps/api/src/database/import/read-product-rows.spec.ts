import * as ExcelJS from 'exceljs';

import { readProductRows } from './read-product-rows';

const HEADER = [
  'ID_PRODUTO (Não preencher)',
  'NOME (Obrigatório) (Não pode conter caracter especial)',
  'CÓDIGO DO PRODUTO',
  'CÓDIGO DE BARRAS (Não pode ser repetido)',
  'NCM (Obrigatório) (Somente 8 digitos)',
  'CFOP SAIDA (Obrigatório)',
  'CEST (Obrigatório em todos)',
  'UNIDADE (Obrigatório)',
  'VALOR DE CUSTO (R$)',
  'VALOR DE VENDA (R$)',
  'ESTOQUE',
  'GRUPO',
  'CATEGORIA',
];

async function sheet(header: unknown[], ...rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Worksheet');
  ws.addRow(header);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const ROW = [1, 'CINTA P', '4749', 7892524980721, 63090010, 5102, null, 'PC', 25.5, 69.9, 2, 'CINTA', 'FEMININO'];

describe('readProductRows', () => {
  it('should read a row into the raw shape, with the spreadsheet row number', async () => {
    const rows = await readProductRows(await sheet(HEADER, ROW));

    expect(rows).toEqual([
      {
        rowNumber: 2,
        id: 1,
        name: 'CINTA P',
        code: '4749',
        barcode: 7892524980721,
        ncm: 63090010,
        cfop: 5102,
        cest: null,
        unit: 'PC',
        cost: 25.5,
        sale: 69.9,
        stock: 2,
        group: 'CINTA',
        category: 'FEMININO',
      },
    ]);
  });

  it('should find columns by header name, not by position', async () => {
    const shuffled = [...HEADER].reverse();
    const row = [...ROW].reverse();

    const rows = await readProductRows(await sheet(shuffled, row));

    expect(rows[0]).toMatchObject({ name: 'CINTA P', sale: 69.9, stock: 2 });
  });

  it('should ignore completely empty rows but keep the original row numbers', async () => {
    const rows = await readProductRows(
      await sheet(HEADER, ROW, [], [2, 'CINTA M', ...ROW.slice(2)]),
    );

    expect(rows.map((r) => r.rowNumber)).toEqual([2, 4]);
  });

  it('should fail loudly when a required column is missing', async () => {
    const withoutName = HEADER.filter((h) => !h.startsWith('NOME'));

    await expect(readProductRows(await sheet(withoutName, ROW.slice(1)))).rejects.toThrow(
      /coluna.*NOME/i,
    );
  });

  it('should read formula and rich-text cells as their value', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Worksheet');
    ws.addRow(HEADER);
    ws.addRow(ROW);
    ws.getCell('B2').value = { richText: [{ text: 'CINTA ' }, { text: 'P' }] };
    ws.getCell('J2').value = { formula: '69.9', result: 69.9 };

    const rows = await readProductRows(Buffer.from(await wb.xlsx.writeBuffer()));

    expect(rows[0]).toMatchObject({ name: 'CINTA P', sale: 69.9 });
  });
});
