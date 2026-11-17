import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, MovementType, MovementReason } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { toDateRange } from '../../common/utils/date-range.util';
import {
  CreateMovementDto,
  TransferStockDto,
  AdjustStockDto,
  InventoryQueryDto,
  MovementQueryDto,
  CreateWarehouseDto,
  UpdateWarehouseDto,
  AlertQueryDto,
} from './dto/inventory.dto';
import {
  buildPaginatedResponse,
  PaginatedResponse,
} from '../../common/utils/pagination';
import { StockLowEvent } from '../../events/event-types';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * List warehouses for a tenant (paginated).
   */
  async getWarehouses(
    tenantId: string,
    query: InventoryQueryDto,
  ): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where = { tenantId };

    const [data, total] = await Promise.all([
      this.prisma.warehouse.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          code: true,
          address: true,
          city: true,
          state: true,
          zipCode: true,
          isDefault: true,
          // AE-12d: a tela precisa distinguir um depósito desativado de um
          // ativo — sem isto o card de um depósito inativo é idêntico.
          isActive: true,
          createdAt: true,
          updatedAt: true,
          // AE-12b: o card mostra "12 produtos"; sem isto exibia " produtos".
          _count: { select: { inventoryItems: true } },
        },
      }),
      this.prisma.warehouse.count({ where }),
    ]);

    // O card lê `productCount`; `_count.inventoryItems` é detalhe do Prisma.
    const rows = data.map(({ _count, ...warehouse }) => ({
      ...warehouse,
      productCount: _count?.inventoryItems ?? 0,
    }));

    return buildPaginatedResponse(rows, total, { page, limit, sortOrder: 'desc' });
  }

  /**
   * Create a warehouse for a tenant.
   */
  async createWarehouse(tenantId: string, dto: CreateWarehouseDto) {
    // Auto-generate code from name if not provided
    const code = dto.code || dto.name.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '').slice(0, 50);

    // AE-12b: cidade, UF e CEP são campos próprios. Concatená-los dentro de
    // `address` destruía a estrutura na gravação — e o card do depósito, que
    // lê `city` e `state`, exibia ", -" para sempre.

    // AE-12c: `isDefault` era gravado sem rebaixar o anterior, e a tela chegou
    // a exibir **três** depósitos "Padrão" — deixando ambíguo qual deles a
    // venda e o balcão usam. Rebaixar e criar na mesma transação, senão uma
    // falha no meio deixa o tenant sem padrão nenhum.
    const isDefault = dto.isDefault ?? false;

    const warehouse = await this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.warehouse.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.warehouse.create({
      data: {
        tenantId,
        name: dto.name,
        code,
        address: dto.address || null,
        city: dto.city || null,
        state: dto.state || null,
        zipCode: dto.zipCode || null,
        isDefault,
      },
      select: {
        id: true,
        name: true,
        code: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
        isDefault: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      });
    });

    this.logger.log(
      `Warehouse created: ${warehouse.id} (${warehouse.name}) for tenant ${tenantId}`,
    );

    return warehouse;
  }

  /**
   * Update a warehouse (AE-12d).
   *
   * The cards had no edit at all: a warehouse created with a typo in the name
   * or the wrong CEP could only be worked around by creating another one.
   */
  async updateWarehouse(
    tenantId: string,
    id: string,
    dto: UpdateWarehouseDto,
  ) {
    const existing = await this.prisma.warehouse.findFirst({
      where: { id, tenantId },
      select: { id: true, isDefault: true },
    });
    if (!existing) {
      throw new NotFoundException('Depósito não encontrado');
    }

    // Un-ticking the default would leave the tenant with none, and the sale
    // picks the default warehouse — refuse instead of silently breaking it.
    if (existing.isDefault && dto.isDefault === false) {
      throw new BadRequestException(
        'Para trocar o depósito padrão, marque outro depósito como padrão.',
      );
    }

    if (dto.isActive === false && existing.isDefault) {
      throw new BadRequestException(
        'O depósito padrão não pode ser desativado. Defina outro como padrão antes.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // AE-12c: demote the previous default in the same transaction, or the
      // screen shows two "Padrão" and the sale picks one at random.
      if (dto.isDefault === true && !existing.isDefault) {
        await tx.warehouse.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.warehouse.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.code !== undefined && { code: dto.code }),
          ...(dto.address !== undefined && { address: dto.address || null }),
          ...(dto.city !== undefined && { city: dto.city || null }),
          ...(dto.state !== undefined && { state: dto.state?.toUpperCase() || null }),
          ...(dto.zipCode !== undefined && { zipCode: dto.zipCode || null }),
          ...(dto.isDefault === true && { isDefault: true }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
        select: {
          id: true,
          name: true,
          code: true,
          address: true,
          city: true,
          state: true,
          zipCode: true,
          isDefault: true,
          isActive: true,
          updatedAt: true,
        },
      });
    });
  }

  /**
   * Remove a warehouse (AE-12d).
   *
   * Same shape as deleting a product with stock (AE-02): the balance goes in
   * the message, because "não foi possível excluir" forces the operator to go
   * hunting for which of the six warehouses still holds something.
   *
   * A warehouse with history is **deactivated**, never deleted — the movements
   * that point at it are the audit trail of every entry and exit it ever saw.
   */
  async removeWarehouse(tenantId: string, id: string) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, isDefault: true },
    });
    if (!warehouse) {
      throw new NotFoundException('Depósito não encontrado');
    }

    if (warehouse.isDefault) {
      throw new BadRequestException(
        `"${warehouse.name}" é o depósito padrão. Defina outro como padrão antes de excluí-lo.`,
      );
    }

    const [stock, movementCount] = await Promise.all([
      this.prisma.inventoryItem.aggregate({
        where: { tenantId, warehouseId: id },
        _sum: { quantity: true },
      }),
      this.prisma.inventoryMovement.count({
        where: {
          tenantId,
          OR: [{ fromWarehouseId: id }, { toWarehouseId: id }],
        },
      }),
    ]);

    const balance = stock._sum.quantity ?? 0;
    if (balance > 0) {
      throw new ConflictException(
        `"${warehouse.name}" ainda tem ${balance} un. em estoque. Transfira ou ajuste o saldo antes de excluí-lo.`,
      );
    }

    if (movementCount > 0) {
      await this.prisma.warehouse.update({
        where: { id },
        data: { isActive: false },
      });
      this.logger.log(`Warehouse deactivated: ${id} for tenant ${tenantId}`);
      return {
        success: true,
        deactivated: true,
        message: `"${warehouse.name}" foi desativado. O histórico de movimentações foi preservado.`,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      // Zero-quantity rows may still exist for products that passed through.
      await tx.inventoryItem.deleteMany({ where: { tenantId, warehouseId: id } });
      await tx.stockAlert.deleteMany({ where: { tenantId, warehouseId: id } });
      await tx.warehouse.delete({ where: { id } });
    });

    this.logger.log(`Warehouse removed: ${id} for tenant ${tenantId}`);
    return {
      success: true,
      deactivated: false,
      message: `"${warehouse.name}" foi excluído com sucesso.`,
    };
  }

  /**
   * List inventory items (stock by product/warehouse).
   */
  async findAll(
    tenantId: string,
    query: InventoryQueryDto,
  ): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 20, productId, warehouseId, search } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryItemWhereInput = { tenantId };
    if (productId) where.productId = productId;
    if (warehouseId) where.warehouseId = warehouseId;
    if (search) {
      where.product = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          product: { select: { id: true, name: true, sku: true, status: true } },
          variant: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);

    return buildPaginatedResponse(data, total, { page, limit, sortOrder: 'desc' });
  }

  /**
   * Register a stock movement (entry, exit, adjustment, return, production).
   */
  async createMovement(
    tenantId: string,
    userId: string,
    dto: CreateMovementDto,
  ) {
    // Validate product exists
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId, deletedAt: null },
      select: { id: true, sku: true, name: true },
    });
    if (!product) {
      throw new NotFoundException('Produto não encontrado');
    }

    const movement = await this.prisma.$transaction((tx) =>
      this.applyMovement(tx, tenantId, userId, dto),
    );

    this.logger.log(
      `Inventory movement: ${dto.type} ${dto.quantity}x ${product.sku} (tenant: ${tenantId})`,
    );

    // Check low stock alerts after movement completes
    const affectedWarehouseId = dto.toWarehouseId || dto.fromWarehouseId;
    if (affectedWarehouseId) {
      await this.checkAndUpdateAlerts(
        tenantId,
        dto.productId,
        dto.variantId ?? null,
        affectedWarehouseId,
      );
    }

    return movement;
  }

  /**
   * Aplica UMA movimentação dentro de uma transação que o chamador já abriu.
   *
   * É o que `createMovement` faz, exposto para quem precisa dar entrada em vários
   * itens de uma vez com tudo-ou-nada (a nota fiscal de compra). Não valida o
   * produto nem confere alertas: o chamador faz as duas coisas.
   */
  async applyMovement(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    dto: CreateMovementDto,
  ) {
    const totalCost = dto.unitCost
      ? dto.unitCost * dto.quantity
      : undefined;

    // Create the movement record
    const created = await tx.inventoryMovement.create({
      data: {
        tenantId,
        productId: dto.productId,
        variantId: dto.variantId,
        type: dto.type as MovementType,
        reason: dto.reason as MovementReason,
        quantity: dto.quantity,
        unitCost: dto.unitCost,
        totalCost,
        fromWarehouseId: dto.fromWarehouseId,
        toWarehouseId: dto.toWarehouseId,
        referenceType: dto.referenceType,
        referenceId: dto.referenceId,
        notes: dto.notes,
        userId,
      },
    });

    // Update inventory based on movement type
    if (dto.type === 'ENTRY' || dto.type === 'RETURN' || dto.type === 'PRODUCTION') {
      if (!dto.toWarehouseId) {
        throw new BadRequestException('Informe o depósito de destino para movimentações de entrada, devolução ou produção');
      }
      await this.upsertInventoryItem(
        tx,
        tenantId,
        dto.productId,
        dto.variantId ?? null,
        dto.toWarehouseId,
        dto.quantity,
        dto.unitCost,
      );
    } else if (dto.type === 'EXIT') {
      if (!dto.fromWarehouseId) {
        throw new BadRequestException('Informe o depósito de origem para movimentações de saída');
      }
      await this.upsertInventoryItem(
        tx,
        tenantId,
        dto.productId,
        dto.variantId ?? null,
        dto.fromWarehouseId,
        -dto.quantity,
      );
    } else if (dto.type === 'ADJUSTMENT') {
      // Adjustment can be positive or negative; use toWarehouseId or fromWarehouseId
      const warehouseId = dto.toWarehouseId || dto.fromWarehouseId;
      if (!warehouseId) {
        throw new BadRequestException('Informe o depósito para registrar o ajuste');
      }
      // For adjustments, positive quantity = add, we decide based on which warehouse is given
      const delta = dto.toWarehouseId ? dto.quantity : -dto.quantity;
      await this.upsertInventoryItem(
        tx,
        tenantId,
        dto.productId,
        dto.variantId ?? null,
        warehouseId,
        delta,
        dto.unitCost,
      );
    }
    // TRANSFER is handled via transferStock method


    // Entradas reprecificam o saldo: o custo de cadastro acompanha a média e a
    // compra registra o último custo (ADR 0004).
    if (dto.type !== 'EXIT' && dto.type !== 'TRANSFER') {
      await this.syncProductCost(
        tx,
        tenantId,
        dto.productId,
        dto.type === 'ENTRY' && dto.reason === 'PURCHASE' && dto.unitCost != null
          ? dto.unitCost
          : undefined,
      );
    }

    return created;
  }

  /** Reconfere os alertas de estoque mínimo de um item, depois da transação. */
  async refreshAlerts(
    tenantId: string,
    productId: string,
    variantId: string | null,
    warehouseId: string,
  ): Promise<void> {
    await this.checkAndUpdateAlerts(tenantId, productId, variantId, warehouseId);
  }

  /**
   * List inventory movements with filters.
   */
  async findMovements(
    tenantId: string,
    query: MovementQueryDto,
  ): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 20, productId, warehouseId, type, dateFrom, dateTo, reason, sortBy, sortOrder = 'desc' } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryMovementWhereInput = { tenantId };
    if (productId) where.productId = productId;
    if (type) where.type = type as any;
    if (reason) where.reason = reason as any;
    if (warehouseId) {
      where.OR = [
        { fromWarehouseId: warehouseId },
        { toWarehouseId: warehouseId },
      ];
    }
    // Same civil-day range as the other filters (FN-01 family).
    const createdAt = toDateRange(dateFrom, dateTo);
    if (createdAt) where.createdAt = createdAt;

    const orderBy = sortBy
      ? { [sortBy]: sortOrder }
      : { createdAt: sortOrder };

    const [data, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          product: { select: { id: true, name: true, sku: true } },
          user: { select: { id: true, name: true } },
          fromWarehouse: { select: { id: true, name: true, code: true } },
          toWarehouse: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);

    return buildPaginatedResponse(
      data.map((row) => this.toMovementDto(row)),
      total,
      { page, limit, sortOrder: 'desc' },
    );
  }

  /**
   * Flatten a movement for the list: the table shows one product, one user and
   * one warehouse per row, while the model keeps an origin and a destination.
   */
  private toMovementDto(row: MovementRow) {
    // ENTRY lands in the destination; EXIT leaves the origin. A transfer has
    // both — the destination is the one that matters to the reader.
    const warehouse = row.toWarehouse ?? row.fromWarehouse;

    return {
      id: row.id,
      productId: row.productId,
      productName: row.product?.name ?? null,
      productSku: row.product?.sku ?? null,
      variantId: row.variantId,
      warehouseId: warehouse?.id ?? null,
      warehouseName: warehouse?.name ?? null,
      fromWarehouseId: row.fromWarehouseId ?? null,
      toWarehouseId: row.toWarehouseId ?? null,
      type: row.type,
      reason: row.reason,
      quantity: row.quantity,
      unitCost: row.unitCost != null ? Number(row.unitCost) : null,
      userId: row.userId,
      // Sales and shipments move stock with no user behind them
      userName: row.user?.name ?? 'Sistema',
      notes: row.notes,
      createdAt: row.createdAt,
    };
  }

  /**
   * Get low stock alerts with pagination and status filter.
   */
  async getLowStockAlerts(
    tenantId: string,
    query: AlertQueryDto,
  ): Promise<PaginatedResponse<any>> {
    const { page = 1, limit = 20, status, warehouseId, productId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.StockAlertWhereInput = { tenantId };
    if (status === 'ACTIVE') {
      where.isResolved = false;
    } else if (status === 'RESOLVED') {
      where.isResolved = true;
    }
    // FT-10: "o que está faltando no Depósito Central?" é a pergunta da tela.
    if (warehouseId) {
      where.warehouseId = warehouseId;
    }
    if (productId) {
      where.productId = productId;
    }

    const [data, total] = await Promise.all([
      this.prisma.stockAlert.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.stockAlert.count({ where }),
    ]);

    return buildPaginatedResponse(
      data.map((row) => this.toAlertDto(row)),
      total,
      { page, limit, sortOrder: 'desc' },
    );
  }

  /**
   * Flatten a stock alert for the list. The model stores ids and `currentQty`;
   * the table reads names and `currentStock`, and derives its badge from
   * `status` — which is `isResolved` spelled out.
   */
  private toAlertDto(row: AlertRow) {
    return {
      id: row.id,
      productId: row.productId,
      productName: row.product?.name ?? null,
      productSku: row.product?.sku ?? null,
      variantId: row.variantId,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse?.name ?? null,
      currentStock: row.currentQty,
      minStock: row.minStock,
      isResolved: row.isResolved,
      status: row.isResolved ? ('RESOLVED' as const) : ('ACTIVE' as const),
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
    };
  }

  /**
   * Set the minimum-stock threshold for an inventory item and re-evaluate alerts.
   */
  async setMinStock(tenantId: string, itemId: string, minStock: number) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
    });

    if (!item) {
      throw new NotFoundException(
        `Item de estoque ${itemId} não encontrado`,
      );
    }

    const updated = await this.prisma.inventoryItem.update({
      where: { id: item.id },
      data: { minStock },
    });

    // Setting/raising the minimum may immediately put the item below threshold
    await this.checkAndUpdateAlerts(
      tenantId,
      item.productId,
      item.variantId ?? null,
      item.warehouseId,
    );

    return updated;
  }

  /**
   * Transfer stock between warehouses.
   */
  async transferStock(tenantId: string, userId: string, dto: TransferStockDto) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('O depósito de origem e o de destino devem ser diferentes');
    }

    // Validate product
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId, deletedAt: null },
      select: { id: true, sku: true },
    });
    if (!product) {
      throw new NotFoundException('Produto não encontrado');
    }

    // Validate source warehouse has enough stock
    const sourceItem = await this.prisma.inventoryItem.findFirst({
      where: {
        productId: dto.productId,
        variantId: dto.variantId ?? null,
        warehouseId: dto.fromWarehouseId,
        tenantId,
      },
    });

    if (!sourceItem || sourceItem.available < dto.quantity) {
      const available = sourceItem?.available ?? 0;
      const source = await this.prisma.warehouse.findFirst({
        where: { id: dto.fromWarehouseId, tenantId },
        select: { name: true },
      });
      const where = source ? ` no depósito ${source.name}` : ' no depósito de origem';
      throw new BadRequestException(
        `Estoque insuficiente${where}: disponível ${available}, transferência solicitada ${dto.quantity}.`,
      );
    }

    const movement = await this.prisma.$transaction(async (tx) => {
      // Decrease source
      const sourceCost = await this.upsertInventoryItem(
        tx,
        tenantId,
        dto.productId,
        dto.variantId ?? null,
        dto.fromWarehouseId,
        -dto.quantity,
      );

      // Increase destination — com o custo médio da origem: uma transferência
      // move mercadoria, não a recompra pelo custo de cadastro. Origem sem custo
      // gravado (saldo antigo) cai no custo de cadastro, como antes.
      await this.upsertInventoryItem(
        tx,
        tenantId,
        dto.productId,
        dto.variantId ?? null,
        dto.toWarehouseId,
        dto.quantity,
        sourceCost > 0 ? sourceCost : undefined,
      );

      // Create movement record
      const created = await tx.inventoryMovement.create({
        data: {
          tenantId,
          productId: dto.productId,
          variantId: dto.variantId,
          type: 'TRANSFER',
          reason: 'TRANSFER',
          quantity: dto.quantity,
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          notes: dto.notes,
          userId,
        },
      });

      this.logger.log(
        `Stock transfer: ${dto.quantity}x ${product.sku} from ${dto.fromWarehouseId} to ${dto.toWarehouseId}`,
      );

      return created;
    });

    // Check low stock alerts for both warehouses
    await this.checkAndUpdateAlerts(tenantId, dto.productId, dto.variantId ?? null, dto.fromWarehouseId);
    await this.checkAndUpdateAlerts(tenantId, dto.productId, dto.variantId ?? null, dto.toWarehouseId);

    return movement;
  }

  /**
   * Stock adjustment from a physical count (AE-25).
   *
   * `countedQuantity` is the balance the operator counted, not a difference.
   * The delta is derived from the balance read **inside** the transaction, so a
   * sale that lands between opening the screen and saving is not overwritten —
   * a client-computed delta would apply on top of the newer number and silently
   * lose that sale (the VD-21 lesson, on the inventory side).
   */
  async adjustStock(tenantId: string, userId: string, dto: AdjustStockDto) {
    const [product, warehouse] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: dto.productId, tenantId, deletedAt: null },
        select: { id: true, sku: true, name: true },
      }),
      this.prisma.warehouse.findFirst({
        where: { id: dto.warehouseId, tenantId },
        select: { id: true, name: true },
      }),
    ]);

    if (!product) throw new NotFoundException('Produto não encontrado');
    if (!warehouse) throw new NotFoundException('Depósito não encontrado');

    const result = await this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({
        where: {
          tenantId,
          productId: dto.productId,
          variantId: dto.variantId ?? null,
          warehouseId: dto.warehouseId,
        },
        select: { quantity: true },
      });

      const previousQuantity = item?.quantity ?? 0;
      const delta = dto.countedQuantity - previousQuantity;

      if (delta === 0) {
        throw new BadRequestException(
          `O saldo de ${product.name} (${product.sku}) no depósito ${warehouse.name} já é ${previousQuantity}. Nenhum ajuste a registrar.`,
        );
      }

      await this.upsertInventoryItem(
        tx,
        tenantId,
        dto.productId,
        dto.variantId ?? null,
        dto.warehouseId,
        delta,
      );

      // The movement stores the magnitude; the direction is the warehouse
      // field that is filled, which is the convention `findMovements` reads.
      const movement = await tx.inventoryMovement.create({
        data: {
          tenantId,
          productId: dto.productId,
          variantId: dto.variantId,
          type: 'ADJUSTMENT',
          reason: dto.reason as MovementReason,
          quantity: Math.abs(delta),
          ...(delta > 0
            ? { toWarehouseId: dto.warehouseId }
            : { fromWarehouseId: dto.warehouseId }),
          notes: dto.notes,
          userId,
        },
      });

      this.logger.log(
        `Stock adjustment: ${product.sku} at ${warehouse.name} ${previousQuantity} -> ${dto.countedQuantity} (tenant: ${tenantId}, user: ${userId})`,
      );

      return { movement, previousQuantity, delta };
    });

    await this.checkAndUpdateAlerts(
      tenantId,
      dto.productId,
      dto.variantId ?? null,
      dto.warehouseId,
    );

    return {
      ...result.movement,
      previousQuantity: result.previousQuantity,
      newQuantity: dto.countedQuantity,
      delta: result.delta,
    };
  }

  /**
   * Reserve stock for an order (called from event handler).
   */
  async reserveStock(
    tenantId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
  ): Promise<void> {
    // Find default or first available warehouse with stock
    const inventoryItem = await this.prisma.inventoryItem.findFirst({
      where: {
        tenantId,
        productId,
        variantId: variantId ?? null,
        available: { gte: quantity },
      },
      include: { warehouse: true },
      orderBy: { warehouse: { isDefault: 'desc' } },
    });

    if (!inventoryItem) {
      this.logger.warn(
        `Cannot reserve ${quantity} units of product ${productId}: insufficient stock`,
      );
      return; // Gracefully skip if no stock (order was already created)
    }

    await this.prisma.inventoryItem.update({
      where: { id: inventoryItem.id },
      data: {
        reserved: { increment: quantity },
        available: { decrement: quantity },
      },
    });

    // Check if low stock alert needed
    const updated = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItem.id },
    });
    if (updated && updated.minStock > 0 && updated.available <= updated.minStock) {
      await this.createStockAlert(tenantId, productId, variantId, inventoryItem.warehouseId, updated.available, updated.minStock);
    }

    this.logger.log(`Reserved ${quantity} units of product ${productId}`);
  }

  /**
   * Release reserved stock (called from event handler on cancellation).
   */
  async releaseStock(
    tenantId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
  ): Promise<void> {
    const inventoryItem = await this.prisma.inventoryItem.findFirst({
      where: {
        tenantId,
        productId,
        variantId: variantId ?? null,
        reserved: { gte: quantity },
      },
      orderBy: { warehouse: { isDefault: 'desc' } },
    });

    if (!inventoryItem) {
      this.logger.warn(
        `Cannot release ${quantity} units of product ${productId}: no matching reservation`,
      );
      return;
    }

    await this.prisma.inventoryItem.update({
      where: { id: inventoryItem.id },
      data: {
        reserved: { decrement: quantity },
        available: { increment: quantity },
      },
    });

    // Check if stock normalized and resolve alert
    const updated = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItem.id },
    });
    if (updated && updated.minStock > 0 && updated.available > updated.minStock) {
      await this.resolveStockAlert(tenantId, productId, variantId, inventoryItem.warehouseId);
    }

    this.logger.log(`Released ${quantity} reserved units of product ${productId}`);
  }

  /**
   * Deduct stock directly for counter sales (EXIT movement, no reservation).
   */
  async deductStockForSale(
    tenantId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    orderId: string,
  ): Promise<void> {
    const inventoryItem = await this.prisma.inventoryItem.findFirst({
      where: {
        tenantId,
        productId,
        variantId: variantId ?? null,
        available: { gte: quantity },
      },
      include: { warehouse: true },
      orderBy: { warehouse: { isDefault: 'desc' } },
    });

    if (!inventoryItem) {
      this.logger.warn(
        `Cannot deduct ${quantity} units of product ${productId}: insufficient stock for counter sale`,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // Deduct from inventory (quantity and available both decrease)
      await tx.inventoryItem.update({
        where: { id: inventoryItem.id },
        data: {
          quantity: { decrement: quantity },
          available: { decrement: quantity },
        },
      });

      // Create EXIT movement for audit trail
      await tx.inventoryMovement.create({
        data: {
          tenantId,
          productId,
          variantId,
          type: 'EXIT',
          reason: 'SALE',
          quantity,
          fromWarehouseId: inventoryItem.warehouseId,
          referenceType: 'ORDER',
          referenceId: orderId,
          notes: 'Venda no balcão - saída direta',
          userId: null,
        },
      });
    });

    // Raise/resolve low- and out-of-stock alerts after the sale
    await this.checkAndUpdateAlerts(tenantId, productId, variantId, inventoryItem.warehouseId);

    this.logger.log(`Deducted ${quantity} units of product ${productId} for counter sale (order ${orderId})`);
  }

  /**
   * Convert a reservation into an actual stock-out when a regular order ships.
   * Units were held in `reserved` on confirmation; now `reserved` and `quantity`
   * both decrease and an EXIT/SALE movement is recorded. `available` is left
   * untouched because it was already decremented at reservation time.
   * (Counter sales use deductStockForSale, which never reserves.)
   */
  async fulfillReservedStock(
    tenantId: string,
    productId: string,
    variantId: string | null,
    quantity: number,
    orderId: string,
  ): Promise<void> {
    const inventoryItem = await this.prisma.inventoryItem.findFirst({
      where: {
        tenantId,
        productId,
        variantId: variantId ?? null,
        reserved: { gte: quantity },
      },
      include: { warehouse: true },
      orderBy: { warehouse: { isDefault: 'desc' } },
    });

    if (!inventoryItem) {
      this.logger.warn(
        `Cannot fulfill ${quantity} units of product ${productId}: no matching reservation`,
      );
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      // Reservation becomes a real stock-out: reserved and quantity both drop
      await tx.inventoryItem.update({
        where: { id: inventoryItem.id },
        data: {
          reserved: { decrement: quantity },
          quantity: { decrement: quantity },
        },
      });

      // Create EXIT movement for audit trail
      await tx.inventoryMovement.create({
        data: {
          tenantId,
          productId,
          variantId,
          type: 'EXIT',
          reason: 'SALE',
          quantity,
          fromWarehouseId: inventoryItem.warehouseId,
          referenceType: 'ORDER',
          referenceId: orderId,
          notes: 'Baixa de estoque - expedição do pedido',
          userId: null,
        },
      });
    });

    // Raise/resolve low- and out-of-stock alerts after the shipment
    await this.checkAndUpdateAlerts(tenantId, productId, variantId, inventoryItem.warehouseId);

    this.logger.log(`Fulfilled ${quantity} reserved units of product ${productId} for order ${orderId}`);
  }

  /**
   * Check low stock levels and emit events.
   */
  async checkLowStock(tenantId: string): Promise<void> {
    const lowStockItems = await this.prisma.$queryRaw<any[]>`
      SELECT
        ii."productId",
        ii."variantId",
        ii."warehouseId",
        ii.available,
        ii."minStock"
      FROM inventory_items ii
      WHERE ii."tenantId" = ${tenantId}
        AND ii."minStock" > 0
        AND ii.available <= ii."minStock"
    `;

    for (const item of lowStockItems) {
      await this.createStockAlert(
        tenantId,
        item.productId,
        item.variantId,
        item.warehouseId,
        item.available,
        item.minStock,
      );
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  /**
   * Upsert inventory item: create if not exists, update quantity if exists.
   */
  /**
   * Custo médio ponderado do saldo do depósito.
   *
   * `costAverage` existia no schema e era exibido na tela do produto, mas
   * nenhum caminho de escrita o atualizava: a coluna "Custo Médio" mostrava
   * R$ 0,00 para todo produto, sempre — margem e CMV nasciam zerados.
   *
   * Só **entrada** reprecifica o saldo; saída consome ao custo que já estava
   * lá. Sem estoque anterior o custo é o da entrada, que também cobre a
   * divisão por zero de um item zerado recebendo entrada sem custo.
   *
   * Trabalha em `Decimal` porque a coluna guarda 4 casas — arredondar para 2
   * a cada entrada faria o custo derivar a cada compra.
   */
  private weightedAverageCost(args: {
    currentQuantity: number;
    currentAverage: Prisma.Decimal | number | null;
    inboundQuantity: number;
    inboundUnitCost: number;
  }): Prisma.Decimal {
    const inboundCost = new Prisma.Decimal(args.inboundUnitCost);
    const previousQty = Math.max(args.currentQuantity, 0);
    const newQty = previousQty + args.inboundQuantity;

    if (newQty <= 0) {return inboundCost;}
    if (previousQty <= 0) {return inboundCost;}

    const previousAvg = new Prisma.Decimal(args.currentAverage ?? 0);
    return previousAvg
      .mul(previousQty)
      .add(inboundCost.mul(args.inboundQuantity))
      .div(newQty);
  }

  /**
   * AE-12a: em pt-BR e **acionável** — dizer "Current: 19" obriga o operador a
   * adivinhar de qual depósito é esse 19.
   */
  private async insufficientStockError(
    tx: Prisma.TransactionClient,
    args: {
      productId: string;
      warehouseId: string;
      available: number;
      requested: number;
    },
  ): Promise<BadRequestException> {
    const [product, warehouse] = await Promise.all([
      tx.product.findUnique({
        where: { id: args.productId },
        select: { name: true, sku: true },
      }),
      tx.warehouse.findUnique({
        where: { id: args.warehouseId },
        select: { name: true },
      }),
    ]);
    const where = warehouse ? ` no depósito ${warehouse.name}` : '';
    const what = product ? `de ${product.name} (${product.sku})` : '';
    return new BadRequestException(
      `Estoque insuficiente ${what}${where}: disponível ${args.available}, saída solicitada ${args.requested}.`.replace(
        /\s+/g,
        ' ',
      ),
    );
  }

  /** Custo da entrada: o informado, ou o de cadastro do produto. */
  private async resolveEntryCost(
    tx: Prisma.TransactionClient,
    productId: string,
    unitCost?: number,
  ): Promise<number> {
    if (unitCost !== undefined && unitCost !== null) {return unitCost;}
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { costPrice: true },
    });
    return Number(product?.costPrice ?? 0);
  }

  private async upsertInventoryItem(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productId: string,
    variantId: string | null,
    warehouseId: string,
    delta: number,
    /**
     * Custo unitário da entrada. Ausente, cai no `costPrice` do produto — é
     * melhor um custo de cadastro do que a coluna zerada para sempre.
     */
    unitCost?: number,
  ): Promise<number> {
    const existing = await tx.inventoryItem.findFirst({
      where: {
        productId,
        variantId: variantId ?? null,
        warehouseId,
      },
    });

    if (existing) {
      // O custo médio do saldo antes desta movimentação — é o que uma
      // transferência leva do depósito de origem.
      const previousCost = Number(existing.costAverage ?? 0);
      const newQuantity = existing.quantity + delta;
      if (newQuantity < 0) {
        throw await this.insufficientStockError(tx, {
          productId,
          warehouseId,
          available: existing.quantity,
          requested: Math.abs(delta),
        });
      }
      const newAvailable = existing.available + delta;

      await tx.inventoryItem.update({
        where: { id: existing.id },
        data: {
          quantity: Math.max(newQuantity, 0),
          available: Math.max(newAvailable, 0),
          ...(delta > 0
            ? {
                costAverage: this.weightedAverageCost({
                  currentQuantity: existing.quantity,
                  currentAverage: existing.costAverage,
                  inboundQuantity: delta,
                  // Sem custo informado, a entrada entra pelo custo médio do
                  // próprio saldo — não dilui a média com o custo de cadastro.
                  // Só um depósito sem saldo parte do custo de cadastro.
                  inboundUnitCost:
                    unitCost !== undefined && unitCost !== null
                      ? unitCost
                      : existing.quantity > 0
                        ? previousCost
                        : await this.resolveEntryCost(tx, productId),
                }),
              }
            : {}),
        },
      });
      return previousCost;
    } else {
      if (delta < 0) {
        const warehouse = await tx.warehouse.findUnique({
          where: { id: warehouseId },
          select: { name: true },
        });
        const where = warehouse ? ` no depósito ${warehouse.name}` : '';
        throw new BadRequestException(
          `Este produto ainda não tem estoque${where}, então não é possível registrar uma saída.`,
        );
      }

      // The item is created lazily on the first movement, so it inherits the
      // product's default minimum (SCRUM-37). An item that later gets its own
      // minimum keeps it — this only seeds the initial value.
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { defaultMinStock: true, costPrice: true },
      });

      // Primeira entrada: o custo do saldo é o custo dela (ou o de cadastro).
      const createdCost = unitCost ?? Number(product?.costPrice ?? 0);

      await tx.inventoryItem.create({
        data: {
          tenantId,
          productId,
          variantId,
          warehouseId,
          quantity: delta,
          available: delta,
          reserved: 0,
          minStock: product?.defaultMinStock ?? 0,
          costAverage: new Prisma.Decimal(createdCost),
        },
      });
      return createdCost;
    }
  }

  /**
   * O custo de cadastro do produto acompanha a média ponderada do estoque
   * (ADR 0004), somando todos os depósitos e variantes com saldo. Sem saldo, o
   * último custo fica como está. Uma compra também registra o último custo pago.
   */
  private async syncProductCost(
    tx: Prisma.TransactionClient,
    tenantId: string,
    productId: string,
    purchaseCost?: number,
  ): Promise<void> {
    const items = await tx.inventoryItem.findMany({
      where: { tenantId, productId, quantity: { gt: 0 } },
      select: { quantity: true, costAverage: true },
    });

    const data: Prisma.ProductUpdateInput = {};
    const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0);
    if (totalQuantity > 0) {
      const totalValue = items.reduce(
        (sum, i) => sum.add(new Prisma.Decimal(i.costAverage ?? 0).mul(i.quantity)),
        new Prisma.Decimal(0),
      );
      data.costPrice = totalValue.div(totalQuantity).toDecimalPlaces(4);
    }
    if (purchaseCost !== undefined) {
      data.lastPurchaseCost = new Prisma.Decimal(purchaseCost);
      data.lastPurchaseAt = new Date();
    }
    if (Object.keys(data).length === 0) {
      return;
    }

    await tx.product.update({ where: { id: productId }, data });
  }

  /**
   * Resolve a stock alert when stock normalizes above minStock.
   */
  private async resolveStockAlert(
    tenantId: string,
    productId: string,
    variantId: string | null,
    warehouseId: string,
  ): Promise<void> {
    const updated = await this.prisma.stockAlert.updateMany({
      where: {
        tenantId,
        productId,
        variantId: variantId ?? undefined,
        warehouseId,
        isResolved: false,
      },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
      },
    });

    if (updated.count > 0) {
      this.logger.log(
        `Resolved ${updated.count} stock alert(s) for product ${productId} in warehouse ${warehouseId}`,
      );
    }
  }

  /**
   * Check and update stock alerts after any movement.
   */
  private async checkAndUpdateAlerts(
    tenantId: string,
    productId: string,
    variantId: string | null,
    warehouseId: string,
  ): Promise<void> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: {
        tenantId,
        productId,
        variantId: variantId ?? null,
        warehouseId,
      },
    });

    if (!item) return;

    // Alert on zero stock (out-of-stock) even when no minStock is configured,
    // and on low stock when the item drops to/below its configured minimum.
    const needsAlert =
      item.available <= 0 || (item.minStock > 0 && item.available <= item.minStock);

    if (needsAlert) {
      await this.createStockAlert(
        tenantId,
        productId,
        variantId,
        warehouseId,
        item.available,
        item.minStock,
      );
    } else {
      await this.resolveStockAlert(tenantId, productId, variantId, warehouseId);
    }
  }

  /**
   * Create a stock alert record and emit event.
   */
  private async createStockAlert(
    tenantId: string,
    productId: string,
    variantId: string | null,
    warehouseId: string,
    currentQty: number,
    minStock: number,
  ): Promise<void> {
    // Check if there's already an unresolved alert for this combination
    const existingAlert = await this.prisma.stockAlert.findFirst({
      where: {
        tenantId,
        productId,
        variantId: variantId ?? undefined,
        warehouseId,
        isResolved: false,
      },
    });

    if (existingAlert) return; // Already has an active alert

    await this.prisma.stockAlert.create({
      data: {
        tenantId,
        productId,
        variantId,
        warehouseId,
        currentQty,
        minStock,
      },
    });

    this.eventEmitter.emit(
      'stock.low',
      new StockLowEvent(tenantId, productId, variantId, warehouseId, currentQty, minStock),
    );
  }
}

// ─── Row shapes returned by the queries above (relations included) ──────────

interface NamedRef {
  id: string;
  name: string;
  code?: string;
}

interface MovementRow {
  id: string;
  productId: string;
  variantId: string | null;
  type: MovementType;
  reason: MovementReason;
  quantity: number;
  unitCost: Prisma.Decimal | null;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  notes: string | null;
  userId: string | null;
  createdAt: Date;
  product: { id: string; name: string; sku: string } | null;
  user: { id: string; name: string } | null;
  fromWarehouse: NamedRef | null;
  toWarehouse: NamedRef | null;
}

interface AlertRow {
  id: string;
  productId: string;
  variantId: string | null;
  warehouseId: string;
  currentQty: number;
  minStock: number;
  isResolved: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
  product: { id: string; name: string; sku: string } | null;
  warehouse: NamedRef | null;
}
