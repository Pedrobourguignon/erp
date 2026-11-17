import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { ProductLookupService } from './product-lookup.service';

const TENANT_ID = 'tenant-uuid-001';
const D = (value: string) => new Prisma.Decimal(value);

function makeVariant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'var-m',
    sku: 'CAM-M',
    name: 'M',
    ean: '7891000000017',
    salePrice: null,
    inventoryItems: [{ available: 4 }, { available: 2 }],
    product: { id: 'prod-cam', name: 'Camiseta Básica', salePrice: D('59.90') },
    ...overrides,
  };
}

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod-bone',
    name: 'Boné',
    sku: 'BON-01',
    ean: '7891000000024',
    salePrice: D('39.90'),
    inventoryItems: [{ available: 5, variantId: null }, { available: 1, variantId: null }],
    variants: [],
    ...overrides,
  };
}

describe('ProductLookupService', () => {
  let service: ProductLookupService;
  let prisma: {
    productVariant: { findMany: jest.Mock };
    product: { findMany: jest.Mock; findFirst: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductLookupService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ProductLookupService);
  });

  describe('findByCode', () => {
    it('finds the variant by its EAN, inside the caller tenant and only if active', async () => {
      prisma.productVariant.findMany.mockResolvedValueOnce([makeVariant()]);

      const result = await service.findByCode(TENANT_ID, '7891000000017');

      expect(prisma.productVariant.findMany.mock.calls[0][0].where).toEqual({
        ean: '7891000000017',
        isActive: true,
        product: { tenantId: TENANT_ID, deletedAt: null, status: 'ACTIVE' },
      });
      expect(result).toEqual({
        kind: 'MATCH',
        item: {
          productId: 'prod-cam',
          variantId: 'var-m',
          name: 'Camiseta Básica — M',
          sku: 'CAM-M',
          ean: '7891000000017',
          salePrice: 59.9,
          available: 6,
        },
      });
    });

    it('prefers the price of the variant when it has one', async () => {
      prisma.productVariant.findMany.mockResolvedValueOnce([makeVariant({ salePrice: D('64.90') })]);

      const result = await service.findByCode(TENANT_ID, '7891000000017');

      expect(result.kind === 'MATCH' && result.item.salePrice).toBe(64.9);
    });

    it('does not look at products once a variant answered', async () => {
      prisma.productVariant.findMany.mockResolvedValueOnce([makeVariant()]);

      await service.findByCode(TENANT_ID, '7891000000017');

      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });

    it('finds a simple product by its EAN, summing every warehouse', async () => {
      prisma.product.findMany.mockResolvedValueOnce([makeProduct()]);

      const result = await service.findByCode(TENANT_ID, '7891000000024');

      expect(prisma.product.findMany.mock.calls[0][0].where).toEqual({
        tenantId: TENANT_ID,
        deletedAt: null,
        status: 'ACTIVE',
        ean: '7891000000024',
      });
      expect(result).toEqual({
        kind: 'MATCH',
        item: {
          productId: 'prod-bone',
          variantId: null,
          name: 'Boné',
          sku: 'BON-01',
          ean: '7891000000024',
          salePrice: 39.9,
          available: 6,
        },
      });
    });

    it('asks for the size/colour when the code belongs to a product with variants', async () => {
      prisma.product.findMany.mockResolvedValueOnce([
        makeProduct({
          id: 'prod-cam',
          name: 'Camiseta Básica',
          sku: 'CAM',
          salePrice: D('59.90'),
          variants: [
            { id: 'var-p', sku: 'CAM-P', name: 'P', ean: null, salePrice: null, inventoryItems: [{ available: 3 }] },
            { id: 'var-m', sku: 'CAM-M', name: 'M', ean: null, salePrice: null, inventoryItems: [] },
          ],
        }),
      ]);

      const result = await service.findByCode(TENANT_ID, 'CAM');

      expect(result).toMatchObject({
        kind: 'CHOOSE_VARIANT',
        productId: 'prod-cam',
        productName: 'Camiseta Básica',
        variants: [
          { variantId: 'var-p', name: 'Camiseta Básica — P', available: 3, salePrice: 59.9 },
          { variantId: 'var-m', name: 'Camiseta Básica — M', available: 0 },
        ],
      });
    });

    it('matches the SKU exactly, ignoring case, after the barcodes', async () => {
      await service.findByCode(TENANT_ID, 'bon-01');

      const [, variantBySku] = prisma.productVariant.findMany.mock.calls;
      const [, productBySku] = prisma.product.findMany.mock.calls;
      expect(variantBySku[0].where.sku).toEqual({ equals: 'bon-01', mode: 'insensitive' });
      expect(productBySku[0].where.sku).toEqual({ equals: 'bon-01', mode: 'insensitive' });
    });

    // A busca do seletor é por trecho: "7891" acharia o primeiro EAN que o
    // contém. A leitura do leitor tem de ser igualdade, ou entra o produto errado.
    // "Não cadastrado" é um resultado normal da leitura, não uma falha: a tela
    // avisa, e o navegador não registra um 404 a cada etiqueta desconhecida.
    it('never matches a part of a code, and says nothing has it', async () => {
      await expect(service.findByCode(TENANT_ID, '7891')).resolves.toEqual({
        kind: 'NOT_FOUND',
        code: '7891',
        message: 'Nenhum produto com o código 7891',
      });
      for (const [args] of [...prisma.productVariant.findMany.mock.calls, ...prisma.product.findMany.mock.calls]) {
        expect(JSON.stringify(args.where)).not.toContain('contains');
      }
    });

    it('trims what the reader sent', async () => {
      prisma.product.findMany.mockResolvedValueOnce([makeProduct()]);

      await service.findByCode(TENANT_ID, '  7891000000024\n');

      expect(prisma.productVariant.findMany.mock.calls[0][0].where.ean).toBe('7891000000024');
    });

    it('refuses an empty read', async () => {
      await expect(service.findByCode(TENANT_ID, '   ')).rejects.toThrow(
        new BadRequestException('Informe o código lido'),
      );
    });

    it('refuses to guess when two products share the code', async () => {
      prisma.product.findMany.mockResolvedValueOnce([
        makeProduct(),
        makeProduct({ id: 'prod-2', name: 'Boné Azul' }),
      ]);

      await expect(service.findByCode(TENANT_ID, '7891000000024')).rejects.toThrow(
        new ConflictException(
          'O código 7891000000024 está em mais de um produto (Boné, Boné Azul). Corrija o cadastro para a leitura funcionar.',
        ),
      );
    });
  });

  describe('findForSale', () => {
    it('returns the variant the cart already holds, with fresh stock', async () => {
      prisma.product.findFirst.mockResolvedValueOnce(
        makeProduct({
          id: 'prod-cam',
          name: 'Camiseta Básica',
          variants: [{ id: 'var-m', sku: 'CAM-M', name: 'M', ean: null, salePrice: null, inventoryItems: [{ available: 7 }] }],
        }),
      );

      const result = await service.findForSale(TENANT_ID, 'prod-cam', 'var-m');

      expect(prisma.product.findFirst.mock.calls[0][0].where).toEqual({
        id: 'prod-cam',
        tenantId: TENANT_ID,
        deletedAt: null,
        status: 'ACTIVE',
      });
      expect(result).toMatchObject({ kind: 'MATCH', item: { variantId: 'var-m', available: 7 } });
    });

    it('asks for the variant of a product picked by name', async () => {
      prisma.product.findFirst.mockResolvedValueOnce(
        makeProduct({
          variants: [{ id: 'var-p', sku: 'X-P', name: 'P', ean: null, salePrice: null, inventoryItems: [] }],
        }),
      );

      const result = await service.findForSale(TENANT_ID, 'prod-bone');

      expect(result.kind).toBe('CHOOSE_VARIANT');
    });

    it('answers 404 for a product of another tenant', async () => {
      await expect(service.findForSale(TENANT_ID, 'prod-x')).rejects.toThrow(
        new NotFoundException('Produto não encontrado'),
      );
    });

    it('answers 404 for a variant that is not of this product', async () => {
      prisma.product.findFirst.mockResolvedValueOnce(makeProduct({ variants: [] }));

      await expect(service.findForSale(TENANT_ID, 'prod-bone', 'var-x')).rejects.toThrow(
        new NotFoundException('Variação não encontrada'),
      );
    });
  });

  describe('findDuplicates', () => {
    it('groups the products and sizes that share a barcode', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { ean: '7891234567895', productId: 'p1', variantId: null, name: 'Boné', sku: 'BON-01' },
        { ean: '7891234567895', productId: 'p2', variantId: null, name: 'Boné 2', sku: 'BON-02' },
      ]);

      const result = await service.findDuplicates(TENANT_ID);

      expect(result).toEqual([{ ean: '7891234567895', owners: expect.any(Array) }]);
      expect(result[0].owners).toHaveLength(2);
    });
  });
});
