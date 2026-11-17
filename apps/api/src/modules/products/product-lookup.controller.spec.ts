import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ProductLookupController } from './product-lookup.controller';
import { ProductLookupService } from './product-lookup.service';

const TENANT_ID = 'tenant-aaa-111';

describe('ProductLookupController', () => {
  let controller: ProductLookupController;
  let lookup: { findByCode: jest.Mock; findForSale: jest.Mock; findDuplicates: jest.Mock };

  beforeEach(async () => {
    lookup = {
      findByCode: jest.fn().mockResolvedValue({ kind: 'MATCH' }),
      findForSale: jest.fn().mockResolvedValue({ kind: 'CHOOSE_VARIANT' }),
      findDuplicates: jest.fn().mockResolvedValue([{ ean: '7891234567895', owners: [] }]),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductLookupController],
      providers: [{ provide: ProductLookupService, useValue: lookup }, Reflector],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard).useValue({ canActivate: () => true })
      .compile();
    controller = module.get(ProductLookupController);
  });

  it('looks up what the reader read', async () => {
    const result = await controller.lookup(TENANT_ID, { code: '7891000000017' });

    expect(lookup.findByCode).toHaveBeenCalledWith(TENANT_ID, '7891000000017');
    expect(result).toEqual({ success: true, data: { kind: 'MATCH' } });
  });

  it('refreshes a cart line by product and variant', async () => {
    await controller.lookup(TENANT_ID, { productId: 'prod-1', variantId: 'var-1' });

    expect(lookup.findForSale).toHaveBeenCalledWith(TENANT_ID, 'prod-1', 'var-1');
  });

  it('needs a code or a product', async () => {
    await expect(controller.lookup(TENANT_ID, {})).rejects.toThrow(
      new BadRequestException('Informe o código lido ou o produto'),
    );
  });

  it('lists the barcodes registered more than once', async () => {
    const result = await controller.duplicates(TENANT_ID);

    expect(lookup.findDuplicates).toHaveBeenCalledWith(TENANT_ID);
    expect(result).toEqual({ success: true, data: [{ ean: '7891234567895', owners: [] }] });
  });

  it('lists duplicates to whoever can read products', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.duplicates)).toEqual(['products:read']);
  });

  // O vendedor já tem products:read: ler o código não pode exigir mais que isso.
  it('only needs products:read', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller.lookup)).toEqual(['products:read']);
  });
});
