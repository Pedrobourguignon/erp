import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  CustomerQueryDto,
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
} from './dto/customer.dto';
import {
  PaginatedResponse,
  buildPaginatedResponse,
  buildPrismaOrderBy,
} from '../../common/utils/pagination';
import { formatDocument, onlyDigits } from '@erp/validators';
import { sumMoney } from '../../common/utils/money.util';
import { startOfDayInTz, toLocalDateKey } from '../../common/utils/date-range.util';

/**
 * A data de nascimento é uma data civil (o aniversário não muda com o fuso):
 * meia-noite no fuso do lojista, como `dueDate` — nunca `new Date('1990-05-20')`,
 * que é meia-noite UTC e mostraria o dia 19 (FN-02).
 *
 * `undefined` = não enviada; `null` = apagar. Recusa, e não ajusta, o que não
 * existe, o que ainda não aconteceu e o que é antes de 1900.
 */
const MIN_BIRTH_DATE_KEY = '1900-01-01';

function toBirthDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) return value;

  const [year, month, day] = value.split('-').map(Number);
  const real = new Date(Date.UTC(year, month - 1, day));
  const exists =
    real.getUTCFullYear() === year &&
    real.getUTCMonth() === month - 1 &&
    real.getUTCDate() === day;
  if (!exists) {
    throw new BadRequestException('Data de nascimento inválida.');
  }
  if (value < MIN_BIRTH_DATE_KEY) {
    throw new BadRequestException('Informe uma data de nascimento a partir de 1900.');
  }
  if (value > toLocalDateKey(new Date())) {
    throw new BadRequestException('A data de nascimento não pode ser no futuro.');
  }
  return startOfDayInTz(value);
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List customers with pagination, search, and filters.
   */
  async findAll(
    tenantId: string,
    query: CustomerQueryDto,
  ): Promise<PaginatedResponse<unknown>> {
    const {
      page = 1,
      limit = 20,
      search,
      sortBy,
      sortOrder = 'desc',
      segment,
      tag,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (segment) {
      where.segment = segment;
    }

    if (tag) {
      where.tags = { has: tag };
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { document: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { tradeName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: buildPrismaOrderBy(sortBy, sortOrder),
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          document: true,
          documentType: true,
          tradeName: true,
          segment: true,
          tags: true,
          score: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { orders: true },
          },
          // AE-13: a tabela lê `totalOrders` e `totalSpent`; a API devolvia só
          // `_count.orders`, então as duas colunas ficavam vazias — e um
          // cliente com três pedidos aparecia como se nunca tivesse comprado.
          // Um `select` aninhado evita o N+1 de somar pedido a pedido.
          orders: {
            where: { status: { notIn: NON_BILLABLE_ORDER_STATUSES } },
            select: { totalAmount: true },
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return buildPaginatedResponse(
      data.map(withOrderTotals),
      total,
      { page, limit, sortBy, sortOrder },
    );
  }

  /**
   * Get a single customer by ID with addresses and recent interactions.
   */
  async findById(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        addresses: {
          orderBy: { isDefault: 'desc' },
        },
        interactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            user: { select: { id: true, name: true } },
          },
        },
        _count: {
          select: { orders: true, invoices: true },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(
        `Cliente com id ${id} não encontrado`,
      );
    }

    return customer;
  }

  /**
   * Create a new customer.
   */
  async create(tenantId: string, dto: CreateCustomerDto) {
    // AE-15: documento é guardado só com dígitos. Comparar a string com a
    // máscara deixava `12345678909` e `123.456.789-09` conviverem como dois
    // clientes — e a duplicidade era burlável só mudando a formatação.
    const document = dto.document ? onlyDigits(dto.document) : undefined;
    const birthDate = toBirthDate(dto.birthDate);

    if (document) {
      const existing = await this.prisma.customer.findFirst({
        where: { tenantId, document, deletedAt: null },
      });
      if (existing) {
        throw new ConflictException(
          `Já existe um cliente com o documento "${formatDocument(document)}"`,
        );
      }
    }

    // Check for duplicate email within tenant
    if (dto.email) {
      const existingEmail = await this.prisma.customer.findFirst({
        where: { tenantId, email: dto.email, deletedAt: null },
      });
      if (existingEmail) {
        throw new ConflictException(
          `Já existe um cliente com o e-mail "${dto.email}"`,
        );
      }
    }

    const customer = await this.prisma.customer.create({
      data: {
        tenantId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        document,
        documentType: dto.documentType ?? undefined,
        birthDate: birthDate ?? undefined,
        tradeName: dto.tradeName,
        segment: dto.segment,
        tags: dto.tags ?? [],
        notes: dto.notes,
        metadata: dto.metadata as Prisma.InputJsonValue,
      },
      include: {
        addresses: true,
      },
    });

    this.logger.log(
      `Customer created: ${customer.id} (${customer.name}) for tenant ${tenantId}`,
    );
    return customer;
  }

  /**
   * Update a customer.
   */
  async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    const existing = await this.prisma.customer.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(
        `Cliente com id ${id} não encontrado`,
      );
    }

    // AE-15: mesma normalização da criação, senão editar um cliente com a
    // máscara "muda" o documento e escapa da checagem de duplicidade.
    const normalizedDocument = dto.document
      ? onlyDigits(dto.document)
      : undefined;
    // `null` apaga; ausente deixa como está.
    const clearsDocument = dto.document === null;
    const birthDate = toBirthDate(dto.birthDate);

    if (normalizedDocument && normalizedDocument !== existing.document) {
      const docExists = await this.prisma.customer.findFirst({
        where: {
          tenantId,
          document: normalizedDocument,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (docExists) {
        throw new ConflictException(
          `Já existe um cliente com o documento "${formatDocument(normalizedDocument)}"`,
        );
      }
    }

    // Check for duplicate email if changed
    if (dto.email && dto.email !== existing.email) {
      const emailExists = await this.prisma.customer.findFirst({
        where: {
          tenantId,
          email: dto.email,
          deletedAt: null,
          id: { not: id },
        },
      });
      if (emailExists) {
        throw new ConflictException(
          `Já existe um cliente com o e-mail "${dto.email}"`,
        );
      }
    }

    const customer = await this.prisma.customer.update({
      where: { id },
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        document: clearsDocument ? null : normalizedDocument,
        documentType: clearsDocument ? null : dto.documentType,
        birthDate,
        tradeName: dto.tradeName,
        segment: dto.segment,
        tags: dto.tags,
        notes: dto.notes,
        metadata: dto.metadata as Prisma.InputJsonValue,
      },
      include: {
        addresses: true,
      },
    });

    this.logger.log(
      `Customer updated: ${customer.id} for tenant ${tenantId}`,
    );
    return customer;
  }

  /**
   * Soft delete a customer.
   */
  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.customer.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(
        `Cliente com id ${id} não encontrado`,
      );
    }

    await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.log(
      `Customer soft-deleted: ${id} for tenant ${tenantId}`,
    );
    return { success: true, message: 'Cliente removido com sucesso' };
  }

  // ─── Addresses (AE-16) ──────────────────────────────────────────────────

  /**
   * Confirms the customer belongs to the tenant before touching its addresses.
   *
   * `CustomerAddress` has no `tenantId` of its own — it is scoped through the
   * customer, so every address operation has to pass here first. Skipping it
   * would let an id from another tenant be edited by anyone who guessed it.
   */
  private async assertCustomerOfTenant(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(`Cliente com id ${customerId} não encontrado`);
    }
    return customer;
  }

  async findAddresses(tenantId: string, customerId: string) {
    await this.assertCustomerOfTenant(tenantId, customerId);

    return this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async createAddress(
    tenantId: string,
    customerId: string,
    dto: CreateCustomerAddressDto,
  ) {
    await this.assertCustomerOfTenant(tenantId, customerId);

    const existingCount = await this.prisma.customerAddress.count({
      where: { customerId },
    });

    // The first address is the default whether or not the box was ticked — a
    // customer whose only address is not the default has no delivery address.
    const isDefault = dto.isDefault === true || existingCount === 0;

    return this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const address = await tx.customerAddress.create({
        data: {
          customerId,
          label: dto.label,
          street: dto.street,
          number: dto.number,
          complement: dto.complement,
          neighborhood: dto.neighborhood,
          city: dto.city,
          state: dto.state.toUpperCase(),
          zipCode: onlyDigits(dto.zipCode),
          isDefault,
        },
      });

      this.logger.log(`Customer address created: ${address.id} for ${customerId}`);
      return address;
    });
  }

  async updateAddress(
    tenantId: string,
    customerId: string,
    addressId: string,
    dto: UpdateCustomerAddressDto,
  ) {
    await this.assertCustomerOfTenant(tenantId, customerId);

    const existing = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
    if (!existing) {
      throw new NotFoundException(`Endereço com id ${addressId} não encontrado`);
    }

    return this.prisma.$transaction(async (tx) => {
      // AE-12c, same shape: demote the previous default in the same
      // transaction, or two addresses end up marked as the main one.
      if (dto.isDefault === true) {
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true, id: { not: addressId } },
          data: { isDefault: false },
        });
      }

      return tx.customerAddress.update({
        where: { id: addressId },
        data: {
          ...(dto.label !== undefined && { label: dto.label }),
          ...(dto.street !== undefined && { street: dto.street }),
          ...(dto.number !== undefined && { number: dto.number }),
          ...(dto.complement !== undefined && { complement: dto.complement }),
          ...(dto.neighborhood !== undefined && { neighborhood: dto.neighborhood }),
          ...(dto.city !== undefined && { city: dto.city }),
          ...(dto.state !== undefined && { state: dto.state.toUpperCase() }),
          ...(dto.zipCode !== undefined && { zipCode: onlyDigits(dto.zipCode) }),
          // Un-ticking the default is refused silently: the customer would be
          // left with no main address at all. Promote another one instead.
          ...(dto.isDefault === true && { isDefault: true }),
        },
      });
    });
  }

  async removeAddress(tenantId: string, customerId: string, addressId: string) {
    await this.assertCustomerOfTenant(tenantId, customerId);

    const existing = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
    if (!existing) {
      throw new NotFoundException(`Endereço com id ${addressId} não encontrado`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.delete({ where: { id: addressId } });

      // Deleting the default promotes the oldest survivor, so the customer is
      // never left with addresses but no main one.
      if (existing.isDefault) {
        const next = await tx.customerAddress.findFirst({
          where: { customerId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (next) {
          await tx.customerAddress.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }
    });

    this.logger.log(`Customer address removed: ${addressId} from ${customerId}`);
    return { success: true, message: 'Endereço removido com sucesso' };
  }
}

/** Pedidos que não representam venda concretizada, para os totais do cliente. */
const NON_BILLABLE_ORDER_STATUSES: OrderStatus[] = [
  'CANCELLED',
  'RETURNED',
  'DRAFT',
];

/**
 * Troca a relação crua por `totalOrders` e `totalSpent` — os campos que a tela
 * lê (AE-13). O somatório vai em centavos: três pedidos somados como float já
 * bastam para um total terminar em `...0000001` (FN-28).
 */
function withOrderTotals(customer: Record<string, unknown>) {
  const { _count, orders, ...rest } = customer as {
    _count?: { orders: number };
    orders?: { totalAmount: unknown }[];
  } & Record<string, unknown>;
  return {
    ...rest,
    totalOrders: _count?.orders ?? 0,
    totalSpent: sumMoney((orders ?? []).map((order) => order.totalAmount as never)),
  };
}
