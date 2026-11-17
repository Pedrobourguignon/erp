import { BadRequestException } from '@nestjs/common';

import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

const file = (overrides: Record<string, unknown> = {}) =>
  ({
    originalname: 'nota.xml',
    mimetype: 'text/xml',
    size: 100,
    buffer: Buffer.from('<NFe/>', 'utf8'),
    ...overrides,
  }) as never;

const payload = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    warehouseId: 'wh-1',
    items: [{ line: 1, action: 'LINK', productId: 'p-1' }],
    ...extra,
  });

describe('PurchasesController', () => {
  let controller: PurchasesController;
  let service: { previewReceipt: jest.Mock; confirmReceipt: jest.Mock };

  beforeEach(() => {
    service = {
      previewReceipt: jest.fn().mockResolvedValue({ items: [] }),
      confirmReceipt: jest.fn().mockResolvedValue({ receiptId: 'rec-1' }),
    };
    controller = new PurchasesController(service as unknown as PurchasesService);
  });

  it.each(['preview', 'confirm'] as const)('%s requires the purchases:create permission', (method) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PurchasesController.prototype[method])).toEqual([
      'purchases:create',
    ]);
  });

  describe('preview', () => {
    it('reads the uploaded XML as text and wraps the answer', async () => {
      const result = await controller.preview('tenant-a', file());

      expect(service.previewReceipt).toHaveBeenCalledWith('tenant-a', '<NFe/>');
      expect(result).toEqual({ success: true, data: { items: [] } });
    });

    it('asks for the file when none was sent', async () => {
      await expect(controller.preview('tenant-a', undefined as never)).rejects.toThrow(
        new BadRequestException('Envie o arquivo XML da nota.'),
      );
    });

    it.each([
      ['a PDF', { originalname: 'nota.pdf', mimetype: 'application/pdf' }],
      ['an image', { originalname: 'nota.png', mimetype: 'image/png' }],
    ])('refuses %s', async (_label, overrides) => {
      await expect(controller.preview('tenant-a', file(overrides))).rejects.toThrow(/XML/);
      expect(service.previewReceipt).not.toHaveBeenCalled();
    });

    it('accepts an XML that arrives as application/xml or with a generic type', async () => {
      await controller.preview('t', file({ mimetype: 'application/xml' }));
      await controller.preview('t', file({ mimetype: 'application/octet-stream', originalname: 'NFe35.XML' }));

      expect(service.previewReceipt).toHaveBeenCalledTimes(2);
    });
  });

  describe('confirm', () => {
    const confirm = (body: string, permissions = ['purchases:create']) =>
      controller.confirm('tenant-a', 'user-1', permissions, file(), body);

    it('validates the decisions and hands them to the service with the permissions', async () => {
      const result = await confirm(payload(), ['purchases:create', 'financial:create']);

      expect(service.confirmReceipt).toHaveBeenCalledWith(
        'tenant-a',
        'user-1',
        ['purchases:create', 'financial:create'],
        '<NFe/>',
        expect.objectContaining({ warehouseId: 'wh-1' }),
      );
      expect(result).toEqual({ success: true, data: { receiptId: 'rec-1' } });
    });

    it.each([
      ['no payload', undefined as never],
      ['a payload that is not JSON', '{quebrado'],
    ])('refuses %s, in Portuguese', async (_label, body) => {
      await expect(confirm(body)).rejects.toThrow(/decisões/i);
      expect(service.confirmReceipt).not.toHaveBeenCalled();
    });

    it('refuses a CREATE with no product data and says what is missing', async () => {
      const body = payload({ items: [{ line: 1, action: 'CREATE' }] });

      await expect(confirm(body)).rejects.toThrow(BadRequestException);
      expect(service.confirmReceipt).not.toHaveBeenCalled();
    });

    it('refuses a LINK with no product', async () => {
      await expect(confirm(payload({ items: [{ line: 1, action: 'LINK' }] }))).rejects.toThrow(
        /produto/i,
      );
    });

    it('refuses an empty list of decisions and a missing warehouse', async () => {
      await expect(confirm(payload({ items: [] }))).rejects.toThrow(/itens/i);
      await expect(confirm(JSON.stringify({ items: [{ line: 1, action: 'SKIP' }] }))).rejects.toThrow(
        /depósito/i,
      );
    });

    it('refuses an unknown action', async () => {
      await expect(confirm(payload({ items: [{ line: 1, action: 'DELETE' }] }))).rejects.toThrow(
        /decida o item/i,
      );
    });
  });
});
