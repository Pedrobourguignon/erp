import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertBarcodesFree } from '../../common/barcodes/barcode-uniqueness';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  CreateProductDto,
  UpdateProductDto,
  ProductQueryDto,
  UpdateCategoryDto,
  UpdateBrandDto,
  BrandQueryDto,
} from './dto/product.dto';
import {
  PaginatedResponse,
  buildPaginatedResponse,
  buildPrismaOrderBy,
} from '../../common/utils/pagination';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List products with pagination, search, and filters.
   */
  async findAll(
    tenantId: string,
    query: ProductQueryDto,
  ): Promise<PaginatedResponse<any>> {
    const {
      page = 1,
      limit = 20,
      search,
      sortBy,
      sortOrder = 'desc',
      categoryId,
      brandId,
      status,
    } = query;


    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (status) {
      where.status = status as any;
    }
    if (categoryId) {
      // FT-08: filtrar por "Eletrônicos" tem de trazer também o que está em
      // "Eletrônicos › Áudio". A igualdade exata é o que o usuário lê como
      // "sumiram produtos" ao escolher a categoria-pai.
      const categoryIds = await this.resolveCategoryTree(tenantId, categoryId);
      where.categoryId = categoryIds.length > 1 ? { in: categoryIds } : categoryId;
    }
    if (brandId) {
      where.brandId = brandId;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { ean: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: buildPrismaOrderBy(sortBy, sortOrder),
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          images: {
            where: { isMain: true },
            take: 1,
            select: { id: true, url: true },
          },
          _count: {
            select: { variants: true, inventoryItems: true },
          },
          inventoryItems: {
            select: { quantity: true, reserved: true, available: true },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    // Aggregate inventory across all warehouses
    const enriched = data.map((product) => {
      const inventory = product.inventoryItems.reduce(
        (acc, item) => ({
          totalQuantity: acc.totalQuantity + item.quantity,
          totalReserved: acc.totalReserved + item.reserved,
          totalAvailable: acc.totalAvailable + item.available,
        }),
        { totalQuantity: 0, totalReserved: 0, totalAvailable: 0 },
      );

      const { inventoryItems, ...rest } = product;
      return { ...rest, inventory };
    });

    return buildPaginatedResponse(enriched, total, { page, limit, sortBy, sortOrder });
  }

  /**
   * Get single product by ID with all relations.
   */
  async findOne(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        brand: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        variants: {
          orderBy: { createdAt: 'asc' },
          include: {
            inventoryItems: {
              select: {
                id: true,
                warehouseId: true,
                quantity: true,
                reserved: true,
                available: true,
              },
            },
          },
        },
        images: { orderBy: { position: 'asc' } },
        inventoryItems: {
          include: {
            warehouse: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Produto não encontrado');
    }

    // Aggregate total inventory
    const inventory = product.inventoryItems.reduce(
      (acc, item) => ({
        totalQuantity: acc.totalQuantity + item.quantity,
        totalReserved: acc.totalReserved + item.reserved,
        totalAvailable: acc.totalAvailable + item.available,
      }),
      { totalQuantity: 0, totalReserved: 0, totalAvailable: 0 },
    );

    return { ...product, inventorySummary: inventory };
  }

  /**
   * Create a product with optional variants.
   */
  async create(tenantId: string, dto: CreateProductDto) {
    const sku = dto.sku || (await this.generateSku(tenantId));

    // Verify SKU uniqueness
    const existing = await this.prisma.product.findFirst({
      where: { tenantId, sku, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(`Já existe um produto com o SKU "${sku}"`);
    }

    // The barcode reader looks codes up by equality: one code, one product
    // (or one size/colour) — the product's and its variants' together.
    await assertBarcodesFree(this.prisma, tenantId, [
      dto.ean,
      ...(dto.variants ?? []).map((v) => v.ean),
    ]);

    // Calculate sale price from cost + markup if not provided
    let salePrice = dto.salePrice;
    if (!salePrice && dto.markup != null && dto.costPrice > 0) {
      salePrice = dto.costPrice * (1 + dto.markup / 100);
    }
    if (!salePrice) {
      salePrice = dto.costPrice;
    }

    // Validate categoryId exists if provided
    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, tenantId },
      });
      if (!category) {
        throw new BadRequestException(`Categoria não encontrada`);
      }
    }

    // Validate brandId exists if provided
    if (dto.brandId) {
      const brand = await this.prisma.brand.findFirst({
        where: { id: dto.brandId, tenantId },
      });
      if (!brand) {
        throw new BadRequestException(`Marca não encontrada`);
      }
    }

    const product = await this.prisma.product.create({
      data: {
        tenantId,
        sku,
        name: dto.name,
        description: dto.description,
        type: (dto.type as any) || 'SIMPLE',
        status: (dto.status as any) || 'DRAFT',
        // AE-08: guardados só com dígitos, como os documentos (AE-15) — a
        // máscara é coisa de exibição, não de armazenamento.
        ean: normalizeFiscalCode(dto.ean),
        ncm: normalizeFiscalCode(dto.ncm),
        cest: normalizeFiscalCode(dto.cest),
        cfop: normalizeFiscalCode(dto.cfop),
        costPrice: dto.costPrice,
        salePrice,
        promoPrice: dto.promoPrice,
        markup: dto.markup,
        defaultMinStock: dto.defaultMinStock ?? 0,
        weight: dto.weight,
        height: dto.height,
        width: dto.width,
        length: dto.length,
        categoryId: dto.categoryId || null,
        brandId: dto.brandId || null,
        supplierId: dto.supplierId || null,
        metadata: dto.metadata as any,
        variants: dto.variants?.length
          ? {
              create: dto.variants.map((v) => ({
                sku: v.sku,
                name: v.name,
                // Só dígitos, como o EAN do produto (AE-08).
                ean: normalizeFiscalCode(v.ean),
                costPrice: v.costPrice,
                salePrice: v.salePrice,
                attributes: v.attributes as any,
                weight: v.weight,
                height: v.height,
                width: v.width,
                length: v.length,
              })),
            }
          : undefined,
      },
      include: {
        variants: true,
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Product created: ${product.id} (${product.sku}) for tenant ${tenantId}`);
    return product;
  }

  /**
   * Update a product.
   */
  async update(tenantId: string, id: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Produto não encontrado');
    }

    // If SKU changed, check uniqueness
    if (dto.sku && dto.sku !== existing.sku) {
      const skuExists = await this.prisma.product.findFirst({
        where: { tenantId, sku: dto.sku, deletedAt: null, id: { not: id } },
      });
      if (skuExists) {
        throw new ConflictException(`Já existe um produto com o SKU "${dto.sku}"`);
      }
    }

    if (dto.ean) {
      await assertBarcodesFree(this.prisma, tenantId, [dto.ean], { productId: id });
    }

    // Recalculate sale price if markup changed
    let salePrice = dto.salePrice;
    if (dto.markup != null && !salePrice) {
      const costPrice = dto.costPrice ?? Number(existing.costPrice);
      if (costPrice > 0) {
        salePrice = costPrice * (1 + dto.markup / 100);
      }
    }

    const { variants: _variants, ...updateData } = dto;

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...updateData,
        salePrice: salePrice !== undefined ? salePrice : undefined,
        status: dto.status as any,
        type: dto.type as any,
        metadata: dto.metadata as any,
        // AE-08: mesma normalização da criação — editar com máscara não pode
        // regravar o código formatado.
        ean: normalizeFiscalCode(dto.ean),
        ncm: normalizeFiscalCode(dto.ncm),
        cest: normalizeFiscalCode(dto.cest),
        cfop: normalizeFiscalCode(dto.cfop),
      },
      include: {
        variants: true,
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        images: { orderBy: { position: 'asc' } },
      },
    });

    this.logger.log(`Product updated: ${product.id} for tenant ${tenantId}`);
    return product;
  }

  /**
   * Soft delete a product.
   */
  /**
   * AE-02: um produto com 4 un. em estoque foi excluído sem bloqueio nenhum. O
   * alerta ficou **órfão** em `/estoque/alertas` e o KPI "Estoque Crítico"
   * continuou contando um item que não existe mais.
   *
   * Duas regras: quem tem saldo ou pedido em aberto não some (inative-o), e o
   * que some leva junto suas pendências.
   */
  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.product.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Produto não encontrado');
    }

    const [stock, openOrderItems] = await Promise.all([
      this.prisma.inventoryItem.aggregate({
        where: { tenantId, productId: id },
        _sum: { quantity: true },
      }),
      this.prisma.orderItem.count({
        where: {
          productId: id,
          order: {
            tenantId,
            deletedAt: null,
            status: { notIn: ['COMPLETED', 'CANCELLED', 'RETURNED'] },
          },
        },
      }),
    ]);

    const balance = Number(stock._sum.quantity ?? 0);
    if (balance > 0) {
      throw new ConflictException(
        `"${existing.name}" ainda tem ${balance} un. em estoque e não pode ser excluído. Zere o estoque ou inative o produto.`,
      );
    }

    if (openOrderItems > 0) {
      throw new ConflictException(
        `"${existing.name}" está em ${openOrderItems} pedido(s) em aberto e não pode ser excluído. Inative o produto para tirá-lo das vendas.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'INACTIVE' },
      });

      // Sem isto o alerta sobrevive ao produto e o dashboard segue contando.
      await tx.stockAlert.updateMany({
        where: { tenantId, productId: id, isResolved: false },
        data: { isResolved: true, resolvedAt: new Date() },
      });
    });

    this.logger.log(`Product soft-deleted: ${id} for tenant ${tenantId}`);
    return { success: true, message: 'Product deleted successfully' };
  }

  // ─── Categories ──────────────────────────────────────────────────────

  /**
   * A category and every category below it (FT-08).
   *
   * `where.categoryId = categoryId` is an exact match, so filtering by a parent
   * category returned nothing from its children — the user picks "Eletrônicos"
   * and sees fewer products than the count next to it promised.
   *
   * The whole tree is read in memory on purpose: categories are a low-cardinality
   * entity (that is why the filter is a plain select and not a search), so this
   * is one small query instead of a recursive CTE.
   */
  private async resolveCategoryTree(
    tenantId: string,
    rootId: string,
  ): Promise<string[]> {
    const categories = await this.prisma.category.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, parentId: true },
    });

    const childrenOf = new Map<string, string[]>();
    for (const category of categories) {
      if (!category.parentId) continue;
      const siblings = childrenOf.get(category.parentId) ?? [];
      siblings.push(category.id);
      childrenOf.set(category.parentId, siblings);
    }

    // Iterative walk with a visited set: a parentId cycle (which the schema
    // does not prevent) would otherwise hang the request.
    const collected = new Set<string>();
    const pending = [rootId];
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (collected.has(current)) continue;
      collected.add(current);
      pending.push(...(childrenOf.get(current) ?? []));
    }

    return [...collected];
  }

  /**
   * Return all categories as a hierarchical tree with product counts.
   */
  async findAllCategories(tenantId: string) {
    const categories = await this.prisma.category.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        _count: { select: { products: true } },
      },
    });

    return this.buildCategoryTree(categories);
  }

  /**
   * Get a single category by ID.
   */
  async findOneCategory(tenantId: string, id: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { products: true } },
        children: {
          where: { deletedAt: null },
          select: { id: true, name: true, slug: true },
          orderBy: { name: 'asc' },
        },
        parent: {
          select: { id: true, name: true, slug: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException(`Categoria não encontrada`);
    }

    return category;
  }

  /**
   * Create a category with optional parentId. Validates parent exists if provided.
   */
  async createCategory(tenantId: string, dto: { name: string; slug?: string; parentId?: string }) {
    const slug = dto.slug || dto.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    const existing = await this.prisma.category.findFirst({
      where: { tenantId, slug, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(`Já existe uma categoria com o identificador "${slug}"`);
    }

    if (dto.parentId) {
      const parent = await this.prisma.category.findFirst({
        where: { id: dto.parentId, tenantId, deletedAt: null },
      });
      if (!parent) {
        throw new BadRequestException(`Categoria pai não encontrada`);
      }
    }

    const category = await this.prisma.category.create({
      data: {
        tenantId,
        name: dto.name,
        slug,
        parentId: dto.parentId || null,
      },
      select: { id: true, name: true, slug: true, parentId: true },
    });

    this.logger.log(`Category created: ${category.id} for tenant ${tenantId}`);
    return category;
  }

  /**
   * Update a category.
   */
  async updateCategory(tenantId: string, id: string, dto: UpdateCategoryDto) {
    const existing = await this.prisma.category.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Categoria não encontrada`);
    }

    // If slug is changing, check uniqueness
    const slug = dto.slug || (dto.name ? dto.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : undefined);
    if (slug && slug !== existing.slug) {
      const slugExists = await this.prisma.category.findFirst({
        where: { tenantId, slug, deletedAt: null, id: { not: id } },
      });
      if (slugExists) {
        throw new ConflictException(`Já existe uma categoria com o identificador "${slug}"`);
      }
    }

    // Validate parentId if provided
    if (dto.parentId !== undefined) {
      if (dto.parentId) {
        if (dto.parentId === id) {
          throw new BadRequestException('Uma categoria não pode ser pai de si mesma');
        }
        const parent = await this.prisma.category.findFirst({
          where: { id: dto.parentId, tenantId, deletedAt: null },
        });
        if (!parent) {
          throw new BadRequestException(`Categoria pai não encontrada`);
        }
      }
    }

    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (slug !== undefined) updateData.slug = slug;
    if (dto.parentId !== undefined) updateData.parentId = dto.parentId || null;

    const category = await this.prisma.category.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, slug: true, parentId: true },
    });

    this.logger.log(`Category updated: ${category.id} for tenant ${tenantId}`);
    return category;
  }

  /**
   * Soft delete a category. Fails if products are still using it.
   */
  async removeCategory(tenantId: string, id: string) {
    const existing = await this.prisma.category.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Categoria não encontrada`);
    }

    const productCount = await this.prisma.product.count({
      where: { categoryId: id, tenantId, deletedAt: null },
    });
    if (productCount > 0) {
      throw new ConflictException(
        `Esta categoria está em uso por ${productCount} produto(s) e não pode ser excluída. Mova os produtos para outra categoria primeiro.`,
      );
    }

    await this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`Category soft-deleted: ${id} for tenant ${tenantId}`);
    return { success: true, message: 'Category deleted successfully' };
  }

  /**
   * Build a nested tree from a flat list of categories.
   */
  private buildCategoryTree(
    categories: Array<{
      id: string;
      name: string;
      slug: string;
      parentId: string | null;
      _count: { products: number };
    }>,
  ) {
    const map = new Map<string, Record<string, unknown>>();
    const roots: Array<Record<string, unknown>> = [];

    for (const cat of categories) {
      map.set(cat.id, { ...cat, children: [] });
    }

    for (const cat of categories) {
      const node = map.get(cat.id)!;
      if (cat.parentId && map.has(cat.parentId)) {
        const parent = map.get(cat.parentId)!;
        (parent.children as Array<Record<string, unknown>>).push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  // ─── Brands ──────────────────────────────────────────────────────────

  /**
   * List all brands with product count and optional search.
   */
  async findAllBrands(tenantId: string, query?: BrandQueryDto) {
    const where: Prisma.BrandWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query?.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    return this.prisma.brand.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        logo: true,
        _count: { select: { products: true } },
      },
    });
  }

  /**
   * Get a single brand by ID with product count.
   */
  async findOneBrand(tenantId: string, id: string) {
    const brand = await this.prisma.brand.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        logo: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { products: true } },
      },
    });

    if (!brand) {
      throw new NotFoundException(`Marca não encontrada`);
    }

    return brand;
  }

  /**
   * Create a brand with optional logo.
   */
  async createBrand(tenantId: string, dto: { name: string; logo?: string }) {
    const existing = await this.prisma.brand.findFirst({
      where: { tenantId, name: dto.name, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(`Já existe uma marca chamada "${dto.name}"`);
    }

    const brand = await this.prisma.brand.create({
      data: {
        tenantId,
        name: dto.name,
        logo: dto.logo || null,
      },
      select: { id: true, name: true, logo: true },
    });

    this.logger.log(`Brand created: ${brand.id} for tenant ${tenantId}`);
    return brand;
  }

  /**
   * Update a brand.
   */
  async updateBrand(tenantId: string, id: string, dto: UpdateBrandDto) {
    const existing = await this.prisma.brand.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Marca não encontrada`);
    }

    // If name is changing, check uniqueness
    if (dto.name && dto.name !== existing.name) {
      const nameExists = await this.prisma.brand.findFirst({
        where: { tenantId, name: dto.name, deletedAt: null, id: { not: id } },
      });
      if (nameExists) {
        throw new ConflictException(`Já existe uma marca chamada "${dto.name}"`);
      }
    }

    const updateData: Record<string, unknown> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.logo !== undefined) updateData.logo = dto.logo;

    const brand = await this.prisma.brand.update({
      where: { id },
      data: updateData,
      select: { id: true, name: true, logo: true },
    });

    this.logger.log(`Brand updated: ${brand.id} for tenant ${tenantId}`);
    return brand;
  }

  /**
   * Soft delete a brand. Fails if products are still using it.
   */
  async removeBrand(tenantId: string, id: string) {
    const existing = await this.prisma.brand.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Marca não encontrada`);
    }

    const productCount = await this.prisma.product.count({
      where: { brandId: id, tenantId, deletedAt: null },
    });
    if (productCount > 0) {
      throw new ConflictException(
        `Esta marca está em uso por ${productCount} produto(s) e não pode ser excluída. Mova os produtos para outra marca primeiro.`,
      );
    }

    await this.prisma.brand.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.log(`Brand soft-deleted: ${id} for tenant ${tenantId}`);
    return { success: true, message: 'Brand deleted successfully' };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  /**
   * Auto-generate a unique SKU for the tenant.
   */
  private async generateSku(tenantId: string): Promise<string> {
    const count = await this.prisma.product.count({ where: { tenantId } });
    const sequence = (count + 1).toString().padStart(6, '0');
    return `PRD-${sequence}`;
  }
}

/** Código fiscal só com dígitos; `undefined` continua `undefined`. */
function normalizeFiscalCode(value?: string | null): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return value.replace(/\D/g, '');
}
