import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { OrderReceiptsController } from './order-receipts.controller';
import { OrderReceiptsService } from './order-receipts.service';

const TENANT_ID = 'tenant-uuid-001';
const USER_ID = 'user-uuid-001';

describe('OrderReceiptsController', () => {
  let controller: OrderReceiptsController;
  let receipts: { printSale: jest.Mock; printAdjustment: jest.Mock };

  beforeEach(async () => {
    receipts = {
      printSale: jest.fn().mockResolvedValue({ kind: 'SALE' }),
      printAdjustment: jest.fn().mockResolvedValue({ kind: 'EXCHANGE' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrderReceiptsController],
      providers: [{ provide: OrderReceiptsService, useValue: receipts }, Reflector],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get(OrderReceiptsController);
  });

  it('prints the sale receipt for the caller tenant and user', async () => {
    const result = await controller.printSale(TENANT_ID, USER_ID, 'order-1');

    expect(receipts.printSale).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'order-1');
    expect(result).toEqual({ success: true, data: { kind: 'SALE' } });
  });

  it('prints the exchange receipt of one adjustment', async () => {
    const result = await controller.printAdjustment(TENANT_ID, USER_ID, 'order-1', 'adj-1');

    expect(receipts.printAdjustment).toHaveBeenCalledWith(TENANT_ID, USER_ID, 'order-1', 'adj-1');
    expect(result).toEqual({ success: true, data: { kind: 'EXCHANGE' } });
  });

  // Quem vê o pedido imprime o recibo: o vendedor não precisa de settings:read
  // para ler o cabeçalho da loja.
  it.each(['printSale', 'printAdjustment'] as const)('%s only needs orders:read', (method) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller[method])).toEqual(['orders:read']);
  });
});
