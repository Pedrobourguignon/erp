import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { NFE_ACCESS_KEY, NFE_XML } from './nfe/nfe-fixture';
import { PurchasesService } from './purchases.service';

const TENANT = 'tenant-a';
const USER = 'user-1';
const WAREHOUSE = 'wh-1';
const ALL = ['purchases:create', 'financial:create'];

const link = (line: number, productId: string, extra: Record<string, unknown> = {}) =>
  ({ line, action: 'LINK', productId, ...extra }) as never;
const create = (line: number, extra: Record<string, unknown> = {}) =>
  ({
    line,
    action: 'CREATE',
    product: { name: 'Camiseta Básica Gola V P', sku: 'CAM-BAS-P', salePrice: 59.9 },
    ...extra,
  }) as never;
const skip = (line: number) => ({ line, action: 'SKIP' }) as never;

function createPrisma() {
  const tx = {
    supplier: { create: jest.fn().mockResolvedValue({ id: 'sup-new', name: 'DISTRIBUIDORA MODA LTDA' }) },
    product: {
      // busca por SKU (produto novo) não acha nada; busca por id (vincular) acha
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { sku?: string; ean?: string } }) =>
          Promise.resolve(where.sku || where.ean ? null : { id: 'p-1' }),
        ),
      create: jest.fn().mockResolvedValue({ id: 'p-new' }),
    },
    // a busca por EAN (código já usado?) não acha nada; a por id (vincular) acha
    productVariant: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { ean?: string } }) =>
          Promise.resolve(where.ean ? null : { id: 'v-1' }),
        ),
    },
    category: { findFirst: jest.fn().mockResolvedValue({ id: 'cat-1' }) },
    brand: { findFirst: jest.fn().mockResolvedValue({ id: 'brand-1' }) },
    goodsReceipt: { create: jest.fn().mockResolvedValue({ id: 'rec-1' }) },
    goodsReceiptItem: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    supplierProductCode: { upsert: jest.fn().mockResolvedValue({}) },
    accountsPayable: { create: jest.fn().mockResolvedValue({}) },
  };
  return {
    warehouse: { findFirst: jest.fn().mockResolvedValue({ id: WAREHOUSE }) },
    goodsReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: 'sup-1', name: 'DISTRIBUIDORA MODA LTDA' }) },
    product: { findMany: jest.fn().mockResolvedValue([]) },
    supplierProductCode: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    _tx: tx,
  };
}

describe('PurchasesService', () => {
  let service: PurchasesService;
  let prisma: ReturnType<typeof createPrisma>;
  let inventory: { applyMovement: jest.Mock; refreshAlerts: jest.Mock };
  const tx = () => prisma._tx;

  beforeEach(async () => {
    prisma = createPrisma();
    inventory = {
      applyMovement: jest.fn().mockResolvedValue({ id: 'mov-1' }),
      refreshAlerts: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasesService,
        { provide: PrismaService, useValue: prisma },
        { provide: InventoryService, useValue: inventory },
      ],
    }).compile();
    service = module.get(PurchasesService);
    jest.useFakeTimers().setSystemTime(new Date('2026-11-16T15:00:00.000Z'));
  });

  afterEach(() => jest.useRealTimers());

  // ─── preview ────────────────────────────────────────────────────────────

  describe('previewReceipt', () => {
    const preview = () => service.previewReceipt(TENANT, NFE_XML);

    it('reads the invoice, the supplier and the items with their acquisition cost', async () => {
      const result = await preview();

      expect(result.nfe).toMatchObject({
        accessKey: NFE_ACCESS_KEY,
        number: '1234',
        issuedDate: '2026-11-10',
        totalAmount: 208.5,
      });
      expect(result.supplier).toMatchObject({ id: 'sup-1', document: '11222333000181' });
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toMatchObject({
        line: 1,
        code: 'CAL-001',
        quantity: 10,
        unitCost: 9.25,
        totalCost: 92.5,
        costBreakdown: { gross: 85, discount: 5, freight: 8.5, ipi: 4, st: 0 },
      });
      expect(result.installments).toEqual([
        { number: '001', dueDate: '2026-12-10', amount: 104.25 },
        { number: '002', dueDate: '2027-01-09', amount: 104.25 },
      ]);
    });

    it('reports a supplier that is not registered yet (it will be created on confirmation)', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      const result = await preview();

      expect(result.supplier).toMatchObject({ id: null, name: 'DISTRIBUIDORA MODA LTDA' });
    });

    it('looks the supplier up by CNPJ, inside the tenant', async () => {
      await preview();

      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT, document: '11222333000181', deletedAt: null },
        select: { id: true, name: true },
      });
    });

    it('suggests an existing product by EAN and marks the unknown one as new', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'p-cal', sku: 'NANY', name: 'Calcinha Nany Algodão Tradicional - M', ean: '7891234567895', ncm: '61081100', variants: [] },
      ]);

      const result = await preview();

      expect(result.items[0].match).toMatchObject({ status: 'MATCHED' });
      expect(result.items[0].match.candidates[0]).toMatchObject({ productId: 'p-cal', kind: 'EAN' });
      expect(result.items[1].match).toEqual({ status: 'NEW', candidates: [] });
    });

    it('also offers the variants of a product', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'p-1', sku: 'CAM', name: 'Camiseta Básica Gola V', ean: null, ncm: null, variants: [{ id: 'v-p', sku: 'CAM-777', name: 'P', ean: null }] },
      ]);

      const result = await preview();

      // o SKU da variante é igual ao código do fornecedor da linha 2
      expect(result.items[1].match.candidates[0]).toMatchObject({ productId: 'p-1', variantId: 'v-p' });
    });

    it('matches by the code this supplier used before', async () => {
      prisma.supplierProductCode.findMany.mockResolvedValue([
        { supplierCode: 'CAM-777', productId: 'p-cam', variantId: null },
      ]);
      prisma.product.findMany.mockResolvedValue([
        { id: 'p-cam', sku: 'OUTRO-SKU', name: 'Algo sem relação', ean: null, ncm: null, variants: [] },
      ]);

      const result = await preview();

      expect(result.items[1].match).toMatchObject({ status: 'MATCHED' });
      expect(result.items[1].match.candidates[0]).toMatchObject({ kind: 'SUPPLIER_CODE' });
      expect(prisma.supplierProductCode.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, supplierId: 'sup-1' },
        select: { supplierCode: true, productId: true, variantId: true },
      });
    });

    it('flags an invoice that already gave entry', async () => {
      prisma.goodsReceipt.findFirst.mockResolvedValue({ id: 'rec-9', createdAt: new Date('2026-11-12T10:00:00.000Z') });

      const result = await preview();

      expect(result.alreadyImported).toEqual({ id: 'rec-9', receivedAt: '2026-11-12T10:00:00.000Z' });
      expect(prisma.goodsReceipt.findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT, accessKey: NFE_ACCESS_KEY },
        select: { id: true, createdAt: true },
      });
    });

    it('is null when the invoice is new', async () => {
      expect((await preview()).alreadyImported).toBeNull();
    });

    it('warns about a fractional quantity and about installments that do not add up', async () => {
      const xml = NFE_XML
        .replace('<qCom>10.0000</qCom>', '<qCom>2.5000</qCom>')
        .replace('<vDup>104.25</vDup>', '<vDup>100.00</vDup>');

      const result = await service.previewReceipt(TENANT, xml);

      expect(result.warnings.join(' ')).toMatch(/quantidade fracionada/i);
      expect(result.warnings.join(' ')).toMatch(/parcelas/i);
    });

    it('does not write anything', async () => {
      await preview();

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  // ─── confirmação ────────────────────────────────────────────────────────

  describe('confirmReceipt', () => {
    const confirm = (
      items: unknown[],
      extra: Record<string, unknown> = {},
      permissions: string[] = ALL,
      xml: string = NFE_XML,
    ) =>
      service.confirmReceipt(TENANT, USER, permissions, xml, {
        warehouseId: WAREHOUSE,
        items,
        ...extra,
      } as never);

    it('gives entry to an existing product at the acquisition cost, as a purchase', async () => {
      await confirm([link(1, 'p-1'), skip(2)]);

      expect(inventory.applyMovement).toHaveBeenCalledTimes(1);
      expect(inventory.applyMovement).toHaveBeenCalledWith(
        tx(),
        TENANT,
        USER,
        expect.objectContaining({
          productId: 'p-1',
          type: 'ENTRY',
          reason: 'PURCHASE',
          quantity: 10,
          unitCost: 9.25,
          toWarehouseId: WAREHOUSE,
          referenceType: 'goods_receipt',
          referenceId: 'rec-1',
        }),
      );
    });

    it('creates the new product only after confirmation, with the cost and the price', async () => {
      await confirm([skip(1), create(2)]);

      expect(tx().product.create).toHaveBeenCalledTimes(1);
      expect(tx().product.create.mock.calls[0][0].data).toMatchObject({
        tenantId: TENANT,
        sku: 'CAM-BAS-P',
        name: 'Camiseta Básica Gola V P',
        // fiscais vêm da nota, só com dígitos
        ncm: '61091000',
        cfop: '5405',
        costPrice: 23.2,
        salePrice: 59.9,
        status: 'ACTIVE',
        supplierId: 'sup-1',
      });
      expect(inventory.applyMovement.mock.calls[0][3]).toMatchObject({
        productId: 'p-new',
        quantity: 5,
        unitCost: 23.2,
      });
    });

    it('records each item and marks the products that were born on this invoice', async () => {
      await confirm([link(1, 'p-1'), create(2)]);

      expect(tx().goodsReceiptItem.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ receiptId: 'rec-1', line: 1, productId: 'p-1', quantity: 10, unitCost: 9.25, totalCost: 92.5, createdProduct: false, supplierCode: 'CAL-001' }),
          expect.objectContaining({ receiptId: 'rec-1', line: 2, productId: 'p-new', quantity: 5, unitCost: 23.2, totalCost: 116, createdProduct: true }),
        ],
      });
    });

    it('remembers the supplier code so the next invoice matches by itself', async () => {
      await confirm([link(1, 'p-1', { variantId: 'v-1' }), skip(2)]);

      expect(tx().supplierProductCode.upsert).toHaveBeenCalledWith({
        where: { tenantId_supplierId_supplierCode: { tenantId: TENANT, supplierId: 'sup-1', supplierCode: 'CAL-001' } },
        create: { tenantId: TENANT, supplierId: 'sup-1', supplierCode: 'CAL-001', productId: 'p-1', variantId: 'v-1' },
        update: { productId: 'p-1', variantId: 'v-1' },
      });
    });

    it('registers the invoice (once per access key) with the supplier and warehouse', async () => {
      await confirm([link(1, 'p-1'), skip(2)]);

      expect(tx().goodsReceipt.create.mock.calls[0][0].data).toMatchObject({
        tenantId: TENANT,
        accessKey: NFE_ACCESS_KEY,
        number: '1234',
        series: '1',
        supplierId: 'sup-1',
        warehouseId: WAREHOUSE,
        totalAmount: 208.5,
        createdById: USER,
        // data civil: meia-noite de Brasília
        issuedDate: new Date('2026-11-10T03:00:00.000Z'),
      });
    });

    it('creates the supplier from the invoice when it is not registered', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      await confirm([link(1, 'p-1'), skip(2)]);

      expect(tx().supplier.create.mock.calls[0][0].data).toMatchObject({
        tenantId: TENANT,
        name: 'DISTRIBUIDORA MODA LTDA',
        tradeName: 'Moda Atacado',
        document: '11222333000181',
        addressCity: 'São Paulo',
        addressState: 'SP',
      });
      expect(tx().goodsReceipt.create.mock.calls[0][0].data.supplierId).toBe('sup-new');
    });

    it('re-checks the stock alerts after the transaction, for every item that moved', async () => {
      await confirm([link(1, 'p-1', { variantId: 'v-1' }), create(2)]);

      expect(inventory.refreshAlerts).toHaveBeenCalledWith(TENANT, 'p-1', 'v-1', WAREHOUSE);
      expect(inventory.refreshAlerts).toHaveBeenCalledWith(TENANT, 'p-new', null, WAREHOUSE);
    });

    it('returns a summary of what happened', async () => {
      const result = await confirm([link(1, 'p-1'), create(2)]);

      expect(result).toMatchObject({
        receiptId: 'rec-1',
        totalAmount: 208.5,
        itemsReceived: 2,
        productsCreated: 1,
        payablesCreated: 0,
      });
    });

    describe('quantity and cost the shop owner can adjust', () => {
      it('keeps the invoice total when the quantity changes (a box of 12 sold as 1 line)', async () => {
        await confirm([link(1, 'p-1', { quantity: 12 }), skip(2)]);

        // 92,50 ÷ 12 = 7,7083
        expect(inventory.applyMovement.mock.calls[0][3]).toMatchObject({ quantity: 12, unitCost: 7.7083 });
        expect(tx().goodsReceiptItem.createMany.mock.calls[0][0].data[0]).toMatchObject({ quantity: 12, totalCost: 92.5 });
      });

      it('uses the cost the shop owner typed over the computed one', async () => {
        await confirm([link(1, 'p-1', { unitCost: 10 }), skip(2)]);

        expect(inventory.applyMovement.mock.calls[0][3]).toMatchObject({ unitCost: 10 });
        expect(tx().goodsReceiptItem.createMany.mock.calls[0][0].data[0]).toMatchObject({ totalCost: 100 });
      });

      it('accepts a zero cost (bonus item)', async () => {
        await confirm([link(1, 'p-1', { unitCost: 0 }), skip(2)]);

        expect(inventory.applyMovement.mock.calls[0][3].unitCost).toBe(0);
      });
    });

    describe('payables from the invoice', () => {
      const payables = [
        { number: '001', dueDate: '2026-12-10', amount: 104.25 },
        { number: '002', dueDate: '2027-01-09', amount: 104.25 },
      ];

      it('creates one payable per installment, with the supplier and the civil due date', async () => {
        const result = await confirm([link(1, 'p-1'), link(2, 'p-2')], { payables });

        expect(tx().accountsPayable.create).toHaveBeenCalledTimes(2);
        expect(tx().accountsPayable.create.mock.calls[0][0].data).toMatchObject({
          tenantId: TENANT,
          supplierId: 'sup-1',
          description: 'NF 1234 - DISTRIBUIDORA MODA LTDA (1/2)',
          installment: 1,
          totalInstallments: 2,
          amount: 104.25,
          status: 'PENDING',
          // meia-noite de Brasília, como todo vencimento
          dueDate: new Date('2026-12-10T03:00:00.000Z'),
          metadata: { kind: 'GOODS_RECEIPT', receiptId: 'rec-1', accessKey: NFE_ACCESS_KEY },
        });
        expect(result.payablesCreated).toBe(2);
      });

      it('creates none when the shop owner chose not to', async () => {
        await confirm([link(1, 'p-1'), link(2, 'p-2')], { payables: [] });

        expect(tx().accountsPayable.create).not.toHaveBeenCalled();
      });

      it('refuses payables that add up to more than the invoice', async () => {
        await expect(
          confirm([link(1, 'p-1'), skip(2)], { payables: [{ dueDate: '2026-12-10', amount: 300 }] }),
        ).rejects.toThrow(/mais do que a nota/i);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('refuses payables without the financial permission, and writes nothing', async () => {
        await expect(
          confirm([link(1, 'p-1'), skip(2)], { payables }, ['purchases:create']),
        ).rejects.toThrow(ForbiddenException);
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('lets someone without the financial permission give entry with no payables', async () => {
        await expect(confirm([link(1, 'p-1'), skip(2)], {}, ['purchases:create'])).resolves.toBeDefined();
      });

      it('refuses an impossible due date', async () => {
        await expect(
          confirm([link(1, 'p-1'), skip(2)], { payables: [{ dueDate: '2026-02-31', amount: 10 }] }),
        ).rejects.toThrow(/vencimento/i);
      });
    });

    describe('what it refuses', () => {
      it('an invoice that already gave entry, saying when', async () => {
        prisma.goodsReceipt.findFirst.mockResolvedValue({ id: 'rec-9', createdAt: new Date('2026-11-12T10:00:00.000Z') });

        await expect(confirm([link(1, 'p-1'), skip(2)])).rejects.toThrow(
          new ConflictException('Esta nota já deu entrada em 12/11/2026.'),
        );
        expect(inventory.applyMovement).not.toHaveBeenCalled();
      });

      it('losing the race to another confirmation (unique key), as a conflict', async () => {
        tx().goodsReceipt.create.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
        );

        await expect(confirm([link(1, 'p-1'), skip(2)])).rejects.toThrow(ConflictException);
      });

      it('a line with no decision', async () => {
        await expect(confirm([link(1, 'p-1')])).rejects.toThrow(/item 2/i);
      });

      it('a line decided twice, or a line that is not in the invoice', async () => {
        await expect(confirm([link(1, 'p-1'), link(1, 'p-1'), skip(2)])).rejects.toThrow(BadRequestException);
        await expect(confirm([link(1, 'p-1'), skip(2), skip(9)])).rejects.toThrow(/item 9/i);
      });

      it('an entry where every item was skipped', async () => {
        await expect(confirm([skip(1), skip(2)])).rejects.toThrow(/pelo menos um item/i);
      });

      it('a fractional quantity left as is — the stock moves in whole units', async () => {
        const xml = NFE_XML.replace('<qCom>10.0000</qCom>', '<qCom>2.5000</qCom>');

        await expect(confirm([link(1, 'p-1'), skip(2)], {}, ALL, xml)).rejects.toThrow(/quantidade.*inteira/i);
        // informando a quantidade inteira, passa
        await expect(confirm([link(1, 'p-1', { quantity: 3 }), skip(2)], {}, ALL, xml)).resolves.toBeDefined();
      });

      it('a warehouse of another tenant', async () => {
        prisma.warehouse.findFirst.mockResolvedValue(null);

        await expect(confirm([link(1, 'p-1'), skip(2)])).rejects.toThrow(new NotFoundException('Depósito não encontrado'));
        expect(prisma.warehouse.findFirst).toHaveBeenCalledWith({
          where: { id: WAREHOUSE, tenantId: TENANT },
          select: { id: true },
        });
      });

      it('linking to a product that does not exist in this tenant', async () => {
        tx().product.findFirst.mockResolvedValue(null);

        await expect(confirm([link(1, 'p-x'), skip(2)])).rejects.toThrow(/produto/i);
        expect(tx().product.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ id: 'p-x', tenantId: TENANT, deletedAt: null }) }),
        );
      });

      it('a variant that does not belong to the product', async () => {
        tx().productVariant.findFirst.mockResolvedValue(null);

        await expect(confirm([link(1, 'p-1', { variantId: 'v-x' }), skip(2)])).rejects.toThrow(/variante/i);
      });

      it('creating a product with an EAN that is already on another product', async () => {
        tx().product.findFirst.mockImplementation(({ where }: { where: { ean?: string } }) =>
          Promise.resolve(where.ean ? { name: 'Camiseta Antiga', sku: 'CAM-OLD' } : null),
        );

        await expect(confirm([skip(1), create(2, { product: { name: 'Nova', sku: 'NOVA-1', salePrice: 10, ean: '7891234567895' } })])).rejects.toThrow(
          'O código 7891234567895 já está em Camiseta Antiga (CAM-OLD)',
        );
      });

      it('creating a product with a SKU that already exists, in Portuguese', async () => {
        // 1ª busca (produto a vincular não é usada aqui); a do SKU acha um existente
        tx().product.findFirst.mockResolvedValue({ id: 'ja-existe' });

        await expect(confirm([skip(1), create(2)])).rejects.toThrow(
          new ConflictException('Já existe um produto com o SKU "CAM-BAS-P".'),
        );
      });

      it.each([
        ['categoryId', 'category', 'Categoria não encontrada.'],
        ['brandId', 'brand', 'Marca não encontrada.'],
      ])('creating a product with a %s from another tenant', async (field, model, message) => {
        (tx() as never as Record<string, { findFirst: jest.Mock }>)[model].findFirst.mockResolvedValue(null);

        await expect(
          confirm([skip(1), create(2, { product: { name: 'X', sku: 'X-1', salePrice: 10, [field]: 'de-outra-empresa' } })]),
        ).rejects.toThrow(new BadRequestException(message));
        expect((tx() as never as Record<string, { findFirst: jest.Mock }>)[model].findFirst).toHaveBeenCalledWith({
          where: { id: 'de-outra-empresa', tenantId: TENANT },
          select: { id: true },
        });
      });

      it('writes nothing when anything fails — it is all or nothing', async () => {
        inventory.applyMovement.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});

        await expect(confirm([link(1, 'p-1'), link(2, 'p-2')])).rejects.toThrow('boom');
        // tudo dentro da mesma transação; o alerta só depois do commit
        expect(inventory.refreshAlerts).not.toHaveBeenCalled();
      });
    });
  });
});
