import { BadRequestException } from '@nestjs/common';
import { ROW_IMPORTERS } from './row-importers';
import { PrismaService } from '../../database/prisma/prisma.service';

const TENANT = 'tenant-a';

function createPrisma() {
  return {
    product: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    productVariant: { findFirst: jest.fn().mockResolvedValue(null) },
    customer: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    accountsPayable: { create: jest.fn().mockResolvedValue({}) },
  } as unknown as PrismaService & {
    product: { findFirst: jest.Mock; create: jest.Mock };
    customer: { findFirst: jest.Mock; create: jest.Mock };
    accountsPayable: { create: jest.Mock };
  };
}

describe('ROW_IMPORTERS', () => {
  let prisma: ReturnType<typeof createPrisma>;

  beforeEach(() => {
    prisma = createPrisma();
  });

  describe('PRODUCTS', () => {
    it('should create a product from a valid row', async () => {
      await ROW_IMPORTERS.PRODUCTS(prisma, TENANT, {
        sku: 'P1',
        name: 'Camiseta',
        salePrice: '49,90',
        costPrice: '20',
      });
      const data = prisma.product.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ tenantId: TENANT, sku: 'P1', salePrice: 49.9, costPrice: 20 });
    });

    it('should reject a missing required field', async () => {
      await expect(
        ROW_IMPORTERS.PRODUCTS(prisma, TENANT, { sku: '', name: 'X', salePrice: '10' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('should reject an invalid number', async () => {
      await expect(
        ROW_IMPORTERS.PRODUCTS(prisma, TENANT, { sku: 'P1', name: 'X', salePrice: 'abc' }),
      ).rejects.toThrow(BadRequestException);
    });

    // Leitor de código de barras: a planilha não pode criar um segundo dono do código.
    it('refuses an EAN that is already on another product', async () => {
      prisma.product.findFirst.mockImplementation(async ({ where }: { where: { ean?: string } }) =>
        where.ean ? { name: 'Boné', sku: 'BON-01' } : null,
      );

      await expect(
        ROW_IMPORTERS.PRODUCTS(prisma, TENANT, { sku: 'P1', name: 'Camiseta', salePrice: '10', ean: '7891234567895' }),
      ).rejects.toThrow('O código 7891234567895 já está em Boné (BON-01)');
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('stores the EAN with digits only', async () => {
      await ROW_IMPORTERS.PRODUCTS(prisma, TENANT, {
        sku: 'P1',
        name: 'Camiseta',
        salePrice: '10',
        ean: '789.1234.567895',
      });

      expect(prisma.product.create.mock.calls[0][0].data.ean).toBe('7891234567895');
    });

    it('should reject a duplicate SKU', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'existing' });
      await expect(
        ROW_IMPORTERS.PRODUCTS(prisma, TENANT, { sku: 'P1', name: 'X', salePrice: '10' }),
      ).rejects.toThrow(/SKU/);
    });
  });

  describe('CUSTOMERS', () => {
    const created = () => prisma.customer.create.mock.calls[0][0].data;

    it('should create a customer and infer CNPJ documentType', async () => {
      await ROW_IMPORTERS.CUSTOMERS(prisma, TENANT, {
        name: 'Empresa X',
        document: '11.222.333/0001-81',
      });
      expect(created()).toMatchObject({ name: 'Empresa X', documentType: 'CNPJ' });
    });

    it('should require a name', async () => {
      await expect(
        ROW_IMPORTERS.CUSTOMERS(prisma, TENANT, { name: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    // AE-15: o documento é guardado só com dígitos; com a máscara, mudar a
    // formatação burlava a checagem de duplicidade.
    it.each([
      ['a masked CPF', '529.982.247-25', '52998224725', 'CPF'],
      ['a bare CPF', '52998224725', '52998224725', 'CPF'],
      ['a masked CNPJ', '11.222.333/0001-81', '11222333000181', 'CNPJ'],
    ])('stores %s with digits only', async (_label, document, digits, documentType) => {
      await ROW_IMPORTERS.CUSTOMERS(prisma, TENANT, { name: 'Ana', document });

      expect(created()).toMatchObject({ document: digits, documentType });
    });

    // AE-04: o dígito verificador, não a contagem.
    it.each([
      ['111.111.111-11', 'CPF inválido'],
      ['11.111.111/1111-11', 'CNPJ inválido'],
      ['123', 'Documento inválido'],
    ])('refuses the invalid document %s, in Portuguese', async (document, message) => {
      await expect(
        ROW_IMPORTERS.CUSTOMERS(prisma, TENANT, { name: 'Ana', document }),
      ).rejects.toThrow(new BadRequestException(message));
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('refuses a document that already belongs to another customer of the tenant', async () => {
      prisma.customer.findFirst.mockResolvedValueOnce({ id: 'c-1' });

      await expect(
        ROW_IMPORTERS.CUSTOMERS(prisma, TENANT, { name: 'Ana', document: '529.982.247-25' }),
      ).rejects.toThrow('Já existe um cliente com o documento "529.982.247-25"');

      // com a máscara que for: a busca é pelos dígitos, dentro da empresa
      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT, document: '52998224725', deletedAt: null },
        select: { id: true },
      });
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('imports a customer with no document and no e-mail, with no duplicate lookup', async () => {
      await ROW_IMPORTERS.CUSTOMERS(prisma, TENANT, { name: 'Cliente de balcão', phone: '11911112222' });

      expect(created()).toMatchObject({ name: 'Cliente de balcão', document: null, documentType: null, email: null });
      expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    });

    it('refuses an invalid e-mail', async () => {
      await expect(
        ROW_IMPORTERS.CUSTOMERS(prisma, TENANT, { name: 'Ana', email: 'sem-arroba' }),
      ).rejects.toThrow(new BadRequestException('E-mail inválido'));
      expect(prisma.customer.create).not.toHaveBeenCalled();
    });

    it('refuses an e-mail that already belongs to another customer of the tenant', async () => {
      prisma.customer.findFirst.mockResolvedValueOnce({ id: 'c-1' });

      await expect(
        ROW_IMPORTERS.CUSTOMERS(prisma, TENANT, { name: 'Ana', email: 'ana@exemplo.com' }),
      ).rejects.toThrow('Já existe um cliente com o e-mail "ana@exemplo.com"');
      expect(prisma.customer.findFirst).toHaveBeenCalledWith({
        where: { tenantId: TENANT, email: 'ana@exemplo.com', deletedAt: null },
        select: { id: true },
      });
    });
  });

  describe('EXPENSES', () => {
    it('should create a payable from a valid row (pt-BR date)', async () => {
      await ROW_IMPORTERS.EXPENSES(prisma, TENANT, {
        description: 'Aluguel',
        amount: '1500,00',
        dueDate: '10/08/2026',
      });
      const data = prisma.accountsPayable.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ description: 'Aluguel', amount: 1500, status: 'PENDING' });
      expect(data.dueDate).toBeInstanceOf(Date);
    });

    it('should reject a non-positive amount', async () => {
      await expect(
        ROW_IMPORTERS.EXPENSES(prisma, TENANT, {
          description: 'X',
          amount: '0',
          dueDate: '2026-08-10',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject an invalid date', async () => {
      await expect(
        ROW_IMPORTERS.EXPENSES(prisma, TENANT, {
          description: 'X',
          amount: '10',
          dueDate: 'not-a-date',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
