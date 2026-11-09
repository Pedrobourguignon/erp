import { BadRequestException } from '@nestjs/common';

import { ImportsService } from './imports.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const file = (name: string, mimetype: string, size = 1000) => ({
  originalname: name,
  mimetype,
  size,
  buffer: Buffer.from('x'),
});

function build() {
  const prisma = { importJob: { create: jest.fn().mockResolvedValue({ id: 'job-1' }) } };
  const storage = { uploadBuffer: jest.fn().mockResolvedValue({ key: 'k' }) };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const service = new ImportsService(prisma as never, storage as never, queue as never);
  return { service, prisma, storage, queue };
}

describe('ImportsService.createImport', () => {
  it('should accept a spreadsheet (.xlsx) for products', async () => {
    const { service, prisma, queue } = build();

    await service.createImport('t1', 'u1', 'PRODUCTS', file('produtos.xlsx', XLSX_MIME));

    expect(prisma.importJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', type: 'PRODUCTS', fileName: 'produtos.xlsx' }),
    });
    expect(queue.add).toHaveBeenCalled();
  });

  it('should accept an .xlsx even when the browser sends a generic mime type', async () => {
    const { service } = build();

    await expect(
      service.createImport('t1', 'u1', 'PRODUCTS', file('produtos.xlsx', 'application/octet-stream')),
    ).resolves.toBeDefined();
  });

  it('should still accept a CSV', async () => {
    const { service } = build();

    await expect(
      service.createImport('t1', 'u1', 'PRODUCTS', file('produtos.csv', 'text/csv')),
    ).resolves.toBeDefined();
  });

  it.each(['CUSTOMERS', 'EXPENSES'] as const)('should refuse a spreadsheet for %s', async (type) => {
    const { service, queue } = build();

    await expect(
      service.createImport('t1', 'u1', type, file('x.xlsx', XLSX_MIME)),
    ).rejects.toThrow(new BadRequestException('O arquivo deve ser um CSV'));
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('should refuse an unrelated file type for products', async () => {
    const { service } = build();

    await expect(
      service.createImport('t1', 'u1', 'PRODUCTS', file('x.pdf', 'application/pdf')),
    ).rejects.toThrow(/CSV ou uma planilha/);
  });

  it('should refuse a file above 10 MB', async () => {
    const { service } = build();

    await expect(
      service.createImport('t1', 'u1', 'PRODUCTS', file('x.xlsx', XLSX_MIME, 11 * 1024 * 1024)),
    ).rejects.toThrow(/10 MB/);
  });

  it('should refuse a request without a file', async () => {
    const { service } = build();

    await expect(service.createImport('t1', 'u1', 'PRODUCTS', undefined)).rejects.toThrow(
      /Nenhum arquivo/,
    );
  });

  it('should repair a file name that multer decoded as latin1', async () => {
    const { service, prisma } = build();
    // "Exportação.xlsx" as multer hands it over: UTF-8 bytes read as latin1.
    const mangled = Buffer.from('Exportação.xlsx', 'utf8').toString('latin1');

    await service.createImport('t1', 'u1', 'PRODUCTS', file(mangled, XLSX_MIME));

    expect(prisma.importJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fileName: 'Exportação.xlsx' }),
    });
  });

  it('should leave an ASCII file name untouched', async () => {
    const { service, prisma } = build();

    await service.createImport('t1', 'u1', 'PRODUCTS', file('produtos.xlsx', XLSX_MIME));

    expect(prisma.importJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fileName: 'produtos.xlsx' }),
    });
  });
});
