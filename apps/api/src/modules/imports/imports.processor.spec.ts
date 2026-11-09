import { runProductSpreadsheetImport } from '../../database/import/run-spreadsheet-import';

import { ImportsProcessor } from './imports.processor';

jest.mock('../../database/import/run-spreadsheet-import');
const runMock = runProductSpreadsheetImport as jest.MockedFunction<typeof runProductSpreadsheetImport>;

function build(job: { type: string; fileName: string }) {
  const prisma = {
    importJob: {
      findUnique: jest.fn().mockResolvedValue({ id: 'j1', tenantId: 't1', fileKey: 'k', ...job }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const storage = { getObjectBuffer: jest.fn().mockResolvedValue(Buffer.from('a,b\n')) };
  return { processor: new ImportsProcessor(prisma as never, storage as never), prisma };
}

const run = (p: ImportsProcessor) => p.process({ data: { importJobId: 'j1' } } as never);
const lastUpdate = (prisma: ReturnType<typeof build>['prisma']) =>
  prisma.importJob.update.mock.calls[prisma.importJob.update.mock.calls.length - 1][0] as {
    data: Record<string, unknown>;
  };

describe('ImportsProcessor — product spreadsheet', () => {
  beforeEach(() => runMock.mockReset());

  it('should route a products .xlsx to the spreadsheet importer, scoped to the job tenant', async () => {
    runMock.mockResolvedValue({ totalRows: 3, successRows: 3, errorRows: 0, issues: [] });
    const { processor, prisma } = build({ type: 'PRODUCTS', fileName: 'Produtos.XLSX' });

    await run(processor);

    expect(runMock).toHaveBeenCalledWith(prisma, 't1', expect.any(Buffer));
    expect(lastUpdate(prisma).data).toMatchObject({
      status: 'COMPLETED',
      totalRows: 3,
      successRows: 3,
      errorRows: 0,
    });
  });

  it('should be COMPLETED, not failed, when only warnings came back', async () => {
    runMock.mockResolvedValue({
      totalRows: 1,
      successRows: 1,
      errorRows: 0,
      issues: [{ line: 2, severity: 'warning', message: 'm', code: 'EAN_INVALID' }],
    });
    const { processor, prisma } = build({ type: 'PRODUCTS', fileName: 'p.xlsx' });

    await run(processor);

    expect(lastUpdate(prisma).data).toMatchObject({ status: 'COMPLETED' });
  });

  it.each([
    [2, 1, 'COMPLETED_WITH_ERRORS'],
    [2, 0, 'FAILED'],
  ])('should mark %i rejected / %i created as %s', async (errorRows, successRows, status) => {
    runMock.mockResolvedValue({ totalRows: 2, successRows, errorRows, issues: [] });
    const { processor, prisma } = build({ type: 'PRODUCTS', fileName: 'p.xlsx' });

    await run(processor);

    expect(lastUpdate(prisma).data).toMatchObject({ status });
  });

  it('should record a readable failure when the spreadsheet cannot be read', async () => {
    runMock.mockRejectedValue(new Error('A planilha não tem a coluna obrigatória: NOME.'));
    const { processor, prisma } = build({ type: 'PRODUCTS', fileName: 'p.xlsx' });

    await run(processor);

    expect(lastUpdate(prisma).data).toMatchObject({
      status: 'FAILED',
      errors: [{ line: 0, message: expect.stringMatching(/coluna obrigatória/) }],
    });
  });

  it('should leave CSV imports on the original path', async () => {
    const { processor } = build({ type: 'PRODUCTS', fileName: 'p.csv' });

    await run(processor);

    expect(runMock).not.toHaveBeenCalled();
  });
});
