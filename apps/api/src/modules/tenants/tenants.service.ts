import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ReceiptFormat, TaxRegime } from '@prisma/client';
import { onlyDigits } from '@erp/validators';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  startOfDayInTz,
  toLocalDateKey,
} from '../../common/utils/date-range.util';
import { UpdateTenantDto } from './dto/update-tenant.dto';

/** A plan limit as the Settings screen renders it. */
export interface TenantUsageLimit {
  key: 'users' | 'products' | 'orders' | 'warehouses';
  label: string;
  current: number;
  max: number;
}

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  private readonly BCRYPT_SALT_ROUNDS = 12;

  /**
   * Default role definitions with permission filters.
   * Used when creating a new tenant to seed system roles.
   */
  private readonly DEFAULT_ROLE_DEFINITIONS = [
    {
      name: 'admin',
      description: 'Administrador - acesso total ao sistema',
      filter: () => true,
    },
    {
      name: 'manager',
      description: 'Gerente - acesso à maioria dos módulos',
      filter: (p: { resource: string; action: string }) =>
        !['users', 'settings'].includes(p.resource) || p.action === 'read',
    },
    {
      name: 'operator',
      description: 'Operador - operações do dia a dia',
      filter: (p: { resource: string; action: string }) => {
        if (['orders', 'customers'].includes(p.resource))
          return ['create', 'read', 'update'].includes(p.action);
        if (p.resource === 'products') return p.action === 'read';
        if (p.resource === 'inventory') return ['read', 'update'].includes(p.action);
        if (p.resource === 'reports') return p.action === 'read';
        return false;
      },
    },
    {
      name: 'viewer',
      description: 'Visualizador - somente leitura',
      filter: (p: { resource: string; action: string }) => p.action === 'read',
    },
  ];

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        document: true,
        email: true,
        phone: true,
        plan: true,
        status: true,
        taxRegime: true,
        maxUsers: true,
        maxProducts: true,
        maxOrders: true,
        maxWarehouses: true,
        settings: true,
        addressStreet: true,
        addressNumber: true,
        addressComplement: true,
        addressNeighborhood: true,
        addressCity: true,
        addressState: true,
        addressZipCode: true,
        receiptFormat: true,
        receiptFooter: true,
        trialEndsAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant com id ${id} não encontrado`);
    }

    return tenant;
  }

  async update(tenantId: string, dto: UpdateTenantDto) {
    // Verify tenant exists
    await this.findById(tenantId);

    // AE-15: store the digits, format on display. A document kept with its
    // mask makes duplicate detection bypassable by changing the formatting —
    // `12.345.678/0001-90` and `12345678000190` are the same company and were
    // two different rows.
    const document = dto.document !== undefined ? onlyDigits(dto.document) : undefined;

    if (document) {
      const existing = await this.prisma.tenant.findFirst({
        where: {
          document,
          deletedAt: null,
          id: { not: tenantId },
        },
      });

      if (existing) {
        throw new ConflictException(`Já existe um tenant com o CNPJ ${dto.document}`);
      }
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(document !== undefined && { document }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.addressStreet !== undefined && { addressStreet: dto.addressStreet }),
        ...(dto.addressNumber !== undefined && { addressNumber: dto.addressNumber }),
        ...(dto.addressComplement !== undefined && { addressComplement: dto.addressComplement }),
        ...(dto.addressNeighborhood !== undefined && { addressNeighborhood: dto.addressNeighborhood }),
        ...(dto.addressCity !== undefined && { addressCity: dto.addressCity }),
        ...(dto.addressState !== undefined && { addressState: dto.addressState }),
        ...(dto.addressZipCode !== undefined && { addressZipCode: dto.addressZipCode }),
        ...(dto.taxRegime !== undefined && { taxRegime: dto.taxRegime as TaxRegime }),
        ...(dto.receiptFormat !== undefined && {
          receiptFormat: dto.receiptFormat as ReceiptFormat,
        }),
        // An empty footer means "no footer", not a line of blanks on paper.
        ...(dto.receiptFooter !== undefined && {
          receiptFooter: dto.receiptFooter.trim() || null,
        }),
      },
      select: {
        id: true,
        name: true,
        document: true,
        email: true,
        phone: true,
        plan: true,
        status: true,
        taxRegime: true,
        addressStreet: true,
        addressNumber: true,
        addressComplement: true,
        addressNeighborhood: true,
        addressCity: true,
        addressState: true,
        addressZipCode: true,
        receiptFormat: true,
        receiptFooter: true,
        updatedAt: true,
      },
    });

    this.logger.log(`Tenant updated: ${tenantId}`);

    return updated;
  }

  /**
   * Plan limits with the tenant's real consumption (FN-08).
   *
   * The Settings screen used to render four hardcoded numbers ("245/500
   * produtos") for every tenant. The limits have always existed on the model —
   * only the reading was missing.
   *
   * The monthly order window opens at the first day of the **civil** month in
   * the tenant timezone: `new Date(y, m, 1)` would use the process timezone and
   * a container running in UTC would count the last three hours of the previous
   * month (TZ-01).
   */
  async getUsage(tenantId: string) {
    const tenant = await this.findById(tenantId);

    const monthStartKey = `${toLocalDateKey(new Date()).slice(0, 7)}-01`;
    const monthStart = startOfDayInTz(monthStartKey);

    const [users, products, orders, warehouses] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.product.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.order.count({
        where: {
          tenantId,
          createdAt: { gte: monthStart },
          status: { notIn: ['CANCELLED'] },
        },
      }),
      // Warehouse has no soft delete — `isActive` is its lifecycle flag.
      this.prisma.warehouse.count({ where: { tenantId, isActive: true } }),
    ]);

    const limits: TenantUsageLimit[] = [
      { key: 'users', label: 'Usuários', current: users, max: tenant.maxUsers },
      { key: 'products', label: 'Produtos', current: products, max: tenant.maxProducts },
      { key: 'orders', label: 'Pedidos / mês', current: orders, max: tenant.maxOrders },
      { key: 'warehouses', label: 'Depósitos', current: warehouses, max: tenant.maxWarehouses },
    ];

    return {
      plan: tenant.plan,
      status: tenant.status,
      trialEndsAt: tenant.trialEndsAt,
      limits,
    };
  }

  async findByDocument(document: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { document, deletedAt: null },
      select: {
        id: true,
        name: true,
        document: true,
        email: true,
        phone: true,
        plan: true,
        status: true,
        taxRegime: true,
        createdAt: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant com CNPJ ${document} não encontrado`);
    }

    return tenant;
  }

  /**
   * Create a new tenant with default roles and the first admin user.
   */
  async create(data: {
    name: string;
    document: string;
    email: string;
    phone?: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
  }) {
    // Check for duplicate document
    const existing = await this.prisma.tenant.findFirst({
      where: { document: data.document, deletedAt: null },
    });

    if (existing) {
      throw new ConflictException(`Já existe um tenant com o CNPJ ${data.document}`);
    }

    const hashedPassword = await bcrypt.hash(data.adminPassword, this.BCRYPT_SALT_ROUNDS);

    return this.prisma.$transaction(async (tx) => {
      // 1. Create the tenant
      const tenant = await tx.tenant.create({
        data: {
          name: data.name,
          document: data.document,
          email: data.email,
          phone: data.phone,
          plan: 'TRIAL',
          status: 'ACTIVE',
          trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
          settings: {
            currency: 'BRL',
            timezone: 'America/Sao_Paulo',
            language: 'pt-BR',
          },
        },
      });

      // 2. Get all permissions
      const allPermissions = await tx.permission.findMany({
        select: { id: true, resource: true, action: true },
      });

      // 3. Create default roles with permissions
      let adminRoleId: string | undefined;

      for (const roleDef of this.DEFAULT_ROLE_DEFINITIONS) {
        const role = await tx.role.create({
          data: {
            tenantId: tenant.id,
            name: roleDef.name,
            description: roleDef.description,
            isSystem: true,
          },
        });

        if (roleDef.name === 'admin') {
          adminRoleId = role.id;
        }

        // Assign matching permissions
        const matchedPermissions = allPermissions.filter((p) =>
          roleDef.filter({ resource: p.resource, action: p.action }),
        );

        if (matchedPermissions.length > 0) {
          await tx.rolePermission.createMany({
            data: matchedPermissions.map((p) => ({
              roleId: role.id,
              permissionId: p.id,
            })),
          });
        }
      }

      // 4. Create the first user (admin)
      const adminUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: data.adminEmail,
          password: hashedPassword,
          name: data.adminName,
          status: 'ACTIVE',
          roleId: adminRoleId,
        },
        select: {
          id: true,
          email: true,
          name: true,
          roleId: true,
        },
      });

      this.logger.log(
        `Tenant created: ${tenant.id} (${tenant.name}) with admin user ${adminUser.id}`,
      );

      return {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          document: tenant.document,
          plan: tenant.plan,
          status: tenant.status,
        },
        user: adminUser,
      };
    });
  }
}
