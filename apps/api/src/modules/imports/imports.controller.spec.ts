import { ForbiddenException } from '@nestjs/common';

import { ImportsController } from './imports.controller';

const file = { originalname: 'p.xlsx', mimetype: 'x', size: 1, buffer: Buffer.alloc(1) };

function build() {
  const service = { createImport: jest.fn().mockResolvedValue({ id: 'job-1' }) };
  return { controller: new ImportsController(service as never), service };
}

describe('ImportsController.upload — permissions', () => {
  it.each([
    ['products', 'products:create'],
    ['customers', 'customers:create'],
    ['expenses', 'financial:create'],
  ])('should require %s → %s', async (type, permission) => {
    const { controller, service } = build();

    await expect(controller.upload('t1', 'u1', type, file, [])).rejects.toThrow(ForbiddenException);
    expect(service.createImport).not.toHaveBeenCalled();

    await expect(controller.upload('t1', 'u1', type, file, [permission])).resolves.toEqual({
      success: true,
      data: { id: 'job-1' },
    });
  });

  it('should not let a products permission import customers', async () => {
    const { controller, service } = build();

    await expect(
      controller.upload('t1', 'u1', 'customers', file, ['products:create']),
    ).rejects.toThrow(ForbiddenException);
    expect(service.createImport).not.toHaveBeenCalled();
  });

  it('should refuse before anything when the type is unknown', async () => {
    const { controller } = build();

    await expect(controller.upload('t1', 'u1', 'orders', file, ['products:create'])).rejects.toThrow(
      /Tipo de importação inválido/,
    );
  });
});
