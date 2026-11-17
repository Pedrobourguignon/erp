import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ProductLookupResult, SaleCandidate } from '@erp/shared-types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { toMoney } from '../../common/utils/money.util';
import {
  findBarcodeDuplicates,
  type BarcodeDuplicate,
} from '../../common/barcodes/barcode-uniqueness';

const STOCK = { select: { available: true } } as const;

const VARIANT_SELECT = {
  id: true,
  sku: true,
  name: true,
  ean: true,
  salePrice: true,
  inventoryItems: STOCK,
} as const;

const PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  ean: true,
  salePrice: true,
  inventoryItems: { select: { available: true, variantId: true } },
  variants: {
    where: { isActive: true },
    orderBy: { createdAt: 'asc' as const },
    select: VARIANT_SELECT,
  },
} as const;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;
type VariantRow = Prisma.ProductVariantGetPayload<{ select: typeof VARIANT_SELECT }>;
type ProductHead = { id: string; name: string; salePrice: Prisma.Decimal };

const sumAvailable = (rows: { available: number }[]) =>
  rows.reduce((total, row) => total + row.available, 0);

function variantCandidate(product: ProductHead, variant: VariantRow): SaleCandidate {
  return {
    productId: product.id,
    variantId: variant.id,
    name: `${product.name} — ${variant.name}`,
    sku: variant.sku,
    ean: variant.ean,
    salePrice: toMoney(variant.salePrice ?? product.salePrice),
    available: sumAvailable(variant.inventoryItems),
  };
}

/** A product with active variants does not choose the size/colour by itself. */
function resolveProduct(product: ProductRow): ProductLookupResult {
  if (product.variants.length > 0) {
    return {
      kind: 'CHOOSE_VARIANT',
      productId: product.id,
      productName: product.name,
      variants: product.variants.map((v) => variantCandidate(product, v)),
    };
  }
  return {
    kind: 'MATCH',
    item: {
      productId: product.id,
      variantId: null,
      name: product.name,
      sku: product.sku,
      ean: product.ean,
      salePrice: toMoney(product.salePrice),
      available: sumAvailable(product.inventoryItems),
    },
  };
}

/**
 * Exact lookup for the barcode reader: what the reader read, or nothing.
 *
 * The product picker searches by *part* of name, SKU, EAN and description and
 * the reader's Enter took the first hit — a code contained in another
 * product's EAN or description put the wrong product in the cart. Here only
 * equality counts, in this order: variant EAN, product EAN, variant SKU,
 * product SKU. Two products on the same code is a registration error, and the
 * lookup refuses to guess.
 */
@Injectable()
export class ProductLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async findByCode(tenantId: string, rawCode: string): Promise<ProductLookupResult> {
    const code = (rawCode ?? '').trim();
    if (!code) {
      throw new BadRequestException('Informe o código lido');
    }
    const sku = { equals: code, mode: 'insensitive' as const };

    return (
      (await this.byVariant(tenantId, code, { ean: code })) ??
      (await this.byProduct(tenantId, code, { ean: code })) ??
      (await this.byVariant(tenantId, code, { sku })) ??
      (await this.byProduct(tenantId, code, { sku })) ?? {
        // An unknown label is a normal outcome of reading, not a failure: the
        // screen warns, and the browser does not log a 404 for every one.
        kind: 'NOT_FOUND',
        code,
        message: `Nenhum produto com o código ${code}`,
      }
    );
  }

  /** The cart line again (fresh price and stock), or the variants to choose from. */
  async findForSale(
    tenantId: string,
    productId: string,
    variantId?: string,
  ): Promise<ProductLookupResult> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, ...this.activeProduct(tenantId) },
      select: PRODUCT_SELECT,
    });
    if (!product) {
      throw new NotFoundException('Produto não encontrado');
    }
    if (!variantId) {
      return resolveProduct(product);
    }
    const variant = product.variants.find((v) => v.id === variantId);
    if (!variant) {
      throw new NotFoundException('Variação não encontrada');
    }
    return { kind: 'MATCH', item: variantCandidate(product, variant) };
  }

  /** The barcodes registered more than once, for the store to fix. */
  findDuplicates(tenantId: string): Promise<BarcodeDuplicate[]> {
    return findBarcodeDuplicates(this.prisma, tenantId);
  }

  private activeProduct(tenantId: string) {
    return { tenantId, deletedAt: null, status: 'ACTIVE' as const };
  }

  private async byVariant(
    tenantId: string,
    code: string,
    match: Prisma.ProductVariantWhereInput,
  ): Promise<ProductLookupResult | null> {
    const variants = await this.prisma.productVariant.findMany({
      where: { ...match, isActive: true, product: this.activeProduct(tenantId) },
      select: { ...VARIANT_SELECT, product: { select: { id: true, name: true, salePrice: true } } },
      take: 5,
    });
    if (variants.length === 0) {return null;}
    if (variants.length > 1) {
      this.ambiguous(code, variants.map((v) => `${v.product.name} — ${v.name}`));
    }
    const [variant] = variants;
    return { kind: 'MATCH', item: variantCandidate(variant.product, variant) };
  }

  private async byProduct(
    tenantId: string,
    code: string,
    match: Prisma.ProductWhereInput,
  ): Promise<ProductLookupResult | null> {
    const products = await this.prisma.product.findMany({
      where: { ...this.activeProduct(tenantId), ...match },
      select: PRODUCT_SELECT,
      take: 5,
    });
    if (products.length === 0) {return null;}
    if (products.length > 1) {
      this.ambiguous(code, products.map((p) => p.name));
    }
    return resolveProduct(products[0]);
  }

  private ambiguous(code: string, names: string[]): never {
    throw new ConflictException(
      `O código ${code} está em mais de um produto (${names.join(', ')}). ` +
        'Corrija o cadastro para a leitura funcionar.',
    );
  }

}
