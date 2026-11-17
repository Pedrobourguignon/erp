import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$hashedPasswordValue'),
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-001';
const OTHER_TENANT_ID = 'tenant-uuid-999';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT_ID,
    name: 'Empresa Teste LTDA',
    document: '12.345.678/0001-90',
    email: 'empresa@teste.com',
    phone: '+5511999990000',
    plan: 'PRO',
    status: 'ACTIVE',
    taxRegime: 'SIMPLES_NACIONAL',
    maxUsers: 10,
    maxProducts: 1000,
    maxOrders: 5000,
    maxWarehouses: 3,
    settings: { currency: 'BRL', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
    addressStreet: 'Rua Teste',
    addressNumber: '123',
    addressComplement: null,
    addressNeighborhood: 'Centro',
    addressCity: 'São Paulo',
    addressState: 'SP',
    addressZipCode: '01000-000',
    trialEndsAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ─── Mock Factory ─────────────────────────────────────────────────────────────

function createMockPrisma() {
  const mockTx = {
    tenant: {
      create: jest.fn(),
    },
    permission: {
      findMany: jest.fn(),
    },
    role: {
      create: jest.fn(),
    },
    rolePermission: {
      createMany: jest.fn(),
    },
    user: {
      create: jest.fn(),
    },
  };

  return {
    tenant: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    user: { count: jest.fn() },
    product: { count: jest.fn() },
    order: { count: jest.fn() },
    warehouse: { count: jest.fn() },
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx)),
    _tx: mockTx,
  };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('TenantsService', () => {
  let service: TenantsService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── findById ─────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('should return tenant data when found', async () => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());

      const result = await service.findById(TENANT_ID);

      expect(result.id).toBe(TENANT_ID);
      expect(result.name).toBe('Empresa Teste LTDA');
      expect(result.plan).toBe('PRO');
      expect(result.status).toBe('ACTIVE');
    });

    it('should return all expected fields', async () => {
      const tenant = makeTenant();
      prisma.tenant.findUnique.mockResolvedValue(tenant);

      const result = await service.findById(TENANT_ID);

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('document');
      expect(result).toHaveProperty('email');
      expect(result).toHaveProperty('plan');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('taxRegime');
      expect(result).toHaveProperty('maxUsers');
      expect(result).toHaveProperty('settings');
    });

    it('should throw NotFoundException when tenant not found', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should pass correct id to Prisma', async () => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());

      await service.findById(TENANT_ID);

      expect(prisma.tenant.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TENANT_ID },
        }),
      );
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    const updateDto: UpdateTenantDto = {
      name: 'Updated Empresa',
      email: 'updated@teste.com',
    };

    it('should update tenant fields', async () => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.tenant.update.mockResolvedValue(makeTenant({ name: 'Updated Empresa', email: 'updated@teste.com' }));

      const result = await service.update(TENANT_ID, updateDto);

      expect(result.name).toBe('Updated Empresa');
      expect(result.email).toBe('updated@teste.com');
      expect(prisma.tenant.update).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException when tenant not found', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', updateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when updated document collides with another tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.tenant.findFirst.mockResolvedValue(makeTenant({ id: OTHER_TENANT_ID })); // collision

      await expect(
        service.update(TENANT_ID, { document: '99.999.999/0001-99' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow update when document is not being changed', async () => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.tenant.update.mockResolvedValue(makeTenant({ name: 'New Name' }));

      const result = await service.update(TENANT_ID, { name: 'New Name' });

      expect(result.name).toBe('New Name');
      // findFirst should not have been called for document check when document is not in dto
      expect(prisma.tenant.findFirst).not.toHaveBeenCalled();
    });

    // Recibo do cliente: o lojista escolhe o formato da impressora e o rodapé.
    it('saves the receipt format and footer', async () => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.tenant.update.mockResolvedValue(makeTenant());

      await service.update(TENANT_ID, {
        receiptFormat: 'THERMAL_58',
        receiptFooter: 'Trocas em até 30 dias com este recibo.',
      });

      const { data, select } = prisma.tenant.update.mock.calls[0][0];
      expect(data.receiptFormat).toBe('THERMAL_58');
      expect(data.receiptFooter).toBe('Trocas em até 30 dias com este recibo.');
      expect(select).toMatchObject({ receiptFormat: true, receiptFooter: true });
    });

    it('clears the receipt footer when it is sent empty', async () => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.tenant.update.mockResolvedValue(makeTenant());

      await service.update(TENANT_ID, { receiptFooter: '   ' });

      expect(prisma.tenant.update.mock.calls[0][0].data.receiptFooter).toBeNull();
    });

    it('should update address fields', async () => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.tenant.update.mockResolvedValue(makeTenant({
        addressStreet: 'Nova Rua',
        addressNumber: '456',
        addressCity: 'Rio de Janeiro',
        addressState: 'RJ',
      }));

      const dto: UpdateTenantDto = {
        addressStreet: 'Nova Rua',
        addressNumber: '456',
        addressCity: 'Rio de Janeiro',
        addressState: 'RJ',
      };
      const result = await service.update(TENANT_ID, dto);

      expect(result.addressStreet).toBe('Nova Rua');
      expect(result.addressCity).toBe('Rio de Janeiro');
    });

    it('should update taxRegime', async () => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.tenant.update.mockResolvedValue(makeTenant({ taxRegime: 'LUCRO_PRESUMIDO' }));

      const result = await service.update(TENANT_ID, { taxRegime: 'LUCRO_PRESUMIDO' });

      expect(result.taxRegime).toBe('LUCRO_PRESUMIDO');
    });
  });

  // ─── findByDocument ───────────────────────────────────────────────────────

  describe('findByDocument', () => {
    it('should return tenant when found by document', async () => {
      prisma.tenant.findFirst.mockResolvedValue(makeTenant());

      const result = await service.findByDocument('12.345.678/0001-90');

      expect(result.id).toBe(TENANT_ID);
      expect(result.document).toBe('12.345.678/0001-90');
    });

    it('should throw NotFoundException when not found by document', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);

      await expect(
        service.findByDocument('00.000.000/0000-00'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should exclude soft-deleted tenants', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);

      await service.findByDocument('12.345.678/0001-90').catch(() => {});

      const findArgs = prisma.tenant.findFirst.mock.calls[0][0];
      expect(findArgs.where.deletedAt).toBeNull();
    });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    const createData = {
      name: 'New Company',
      document: '99.999.999/0001-99',
      email: 'new@company.com',
      adminName: 'Admin',
      adminEmail: 'admin@company.com',
      adminPassword: 'S3cur3P@ss',
    };

    it('should create tenant with default roles and admin user', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null); // no duplicate

      const tx = prisma._tx;
      tx.tenant.create.mockResolvedValue({
        id: 'new-tenant-001',
        name: 'New Company',
        document: '99.999.999/0001-99',
        plan: 'TRIAL',
        status: 'ACTIVE',
      });
      tx.permission.findMany.mockResolvedValue([
        { id: 'perm-001', resource: 'products', action: 'create' },
        { id: 'perm-002', resource: 'products', action: 'read' },
      ]);
      tx.role.create.mockResolvedValue({ id: 'role-new-001' });
      tx.rolePermission.createMany.mockResolvedValue({ count: 2 });
      tx.user.create.mockResolvedValue({
        id: 'user-new-001',
        email: 'admin@company.com',
        name: 'Admin',
        roleId: 'role-new-001',
      });

      const result = await service.create(createData);

      expect(result.tenant.name).toBe('New Company');
      expect(result.tenant.plan).toBe('TRIAL');
      expect(result.user.email).toBe('admin@company.com');
    });

    it('should throw ConflictException when duplicate document exists', async () => {
      prisma.tenant.findFirst.mockResolvedValue(makeTenant()); // duplicate

      await expect(service.create(createData)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should set plan to TRIAL on creation', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);

      const tx = prisma._tx;
      tx.tenant.create.mockResolvedValue({
        id: 'new-tenant-001',
        name: 'New Company',
        document: '99.999.999/0001-99',
        plan: 'TRIAL',
        status: 'ACTIVE',
      });
      tx.permission.findMany.mockResolvedValue([]);
      tx.role.create.mockResolvedValue({ id: 'role-new-001' });
      tx.user.create.mockResolvedValue({
        id: 'user-new-001',
        email: 'admin@company.com',
        name: 'Admin',
        roleId: 'role-new-001',
      });

      const result = await service.create(createData);

      const tenantCreateData = tx.tenant.create.mock.calls[0][0].data;
      expect(tenantCreateData.plan).toBe('TRIAL');
      expect(tenantCreateData.status).toBe('ACTIVE');
      expect(tenantCreateData.trialEndsAt).toBeInstanceOf(Date);
    });

    it('should create default system roles', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);

      const tx = prisma._tx;
      tx.tenant.create.mockResolvedValue({
        id: 'new-tenant-001',
        name: 'New Company',
        document: '99.999.999/0001-99',
        plan: 'TRIAL',
        status: 'ACTIVE',
      });
      tx.permission.findMany.mockResolvedValue([]);
      tx.role.create.mockResolvedValue({ id: 'role-new-001' });
      tx.user.create.mockResolvedValue({
        id: 'user-new-001',
        email: 'admin@company.com',
        name: 'Admin',
        roleId: 'role-new-001',
      });

      await service.create(createData);

      // Should create 4 default roles: admin, manager, operator, viewer
      expect(tx.role.create).toHaveBeenCalledTimes(4);
      const roleNames = tx.role.create.mock.calls.map(
        (call: Array<Record<string, unknown>>) => (call[0] as Record<string, Record<string, unknown>>).data.name,
      );
      expect(roleNames).toContain('admin');
      expect(roleNames).toContain('manager');
      expect(roleNames).toContain('operator');
      expect(roleNames).toContain('viewer');
    });

    it('should hash admin password before storing', async () => {
      prisma.tenant.findFirst.mockResolvedValue(null);

      const tx = prisma._tx;
      tx.tenant.create.mockResolvedValue({
        id: 'new-tenant-001',
        name: 'New Company',
        document: '99.999.999/0001-99',
        plan: 'TRIAL',
        status: 'ACTIVE',
      });
      tx.permission.findMany.mockResolvedValue([]);
      tx.role.create.mockResolvedValue({ id: 'role-new-001' });
      tx.user.create.mockResolvedValue({
        id: 'user-new-001',
        email: 'admin@company.com',
        name: 'Admin',
        roleId: 'role-new-001',
      });

      await service.create(createData);

      const userCreateData = tx.user.create.mock.calls[0][0].data;
      expect(userCreateData.password).toBe('$2b$12$hashedPasswordValue');
      expect(userCreateData.password).not.toBe('S3cur3P@ss');
    });
  });

  // ─── update: document normalization (AE-15) ───────────────────────────────

  describe('update: document', () => {
    beforeEach(() => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.tenant.findFirst.mockResolvedValue(null);
      prisma.tenant.update.mockResolvedValue(makeTenant());
    });

    it('should store the CNPJ with digits only', async () => {
      await service.update(TENANT_ID, {
        document: '12.345.678/0001-90',
      } as UpdateTenantDto);

      expect(prisma.tenant.update.mock.calls[0][0].data.document).toBe(
        '12345678000190',
      );
    });

    it('should look duplicates up by the normalized document', async () => {
      // The same CNPJ in another formatting must be found — comparing the raw
      // string is what let two rows hold one company (AE-15).
      await service.update(TENANT_ID, {
        document: '12.345.678/0001-90',
      } as UpdateTenantDto);

      expect(prisma.tenant.findFirst.mock.calls[0][0].where.document).toBe(
        '12345678000190',
      );
    });

    it('should reject a document already used by another tenant', async () => {
      prisma.tenant.findFirst.mockResolvedValue(makeTenant({ id: OTHER_TENANT_ID }));

      await expect(
        service.update(TENANT_ID, { document: '12345678000190' } as UpdateTenantDto),
      ).rejects.toThrow(ConflictException);
    });

    it('should not touch the document when it is not in the payload', async () => {
      await service.update(TENANT_ID, { name: 'Nome Novo' } as UpdateTenantDto);

      expect(prisma.tenant.update.mock.calls[0][0].data).not.toHaveProperty(
        'document',
      );
      expect(prisma.tenant.findFirst).not.toHaveBeenCalled();
    });
  });

  // ─── getUsage (FN-08) ─────────────────────────────────────────────────────

  describe('getUsage', () => {
    beforeEach(() => {
      prisma.tenant.findUnique.mockResolvedValue(makeTenant());
      prisma.user.count.mockResolvedValue(3);
      prisma.product.count.mockResolvedValue(245);
      prisma.order.count.mockResolvedValue(12);
      prisma.warehouse.count.mockResolvedValue(2);
    });

    it('should return the plan and the real limits stored on the tenant', async () => {
      const result = await service.getUsage(TENANT_ID);

      expect(result.plan).toBe('PRO');
      expect(result.limits).toEqual([
        { key: 'users', label: 'Usuários', current: 3, max: 10 },
        { key: 'products', label: 'Produtos', current: 245, max: 1000 },
        { key: 'orders', label: 'Pedidos / mês', current: 12, max: 5000 },
        { key: 'warehouses', label: 'Depósitos', current: 2, max: 3 },
      ]);
    });

    it('should scope every count by tenant', async () => {
      await service.getUsage(TENANT_ID);

      for (const counter of [
        prisma.user.count,
        prisma.product.count,
        prisma.order.count,
        prisma.warehouse.count,
      ]) {
        const where = counter.mock.calls[0][0].where;
        expect(where.tenantId).toBe(TENANT_ID);
      }
    });

    it('should count orders from the first day of the civil month in the tenant timezone', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-03T02:30:00.000Z'));

      await service.getUsage(TENANT_ID);

      // 03/08 02:30 UTC is still 02/08 in BRT — the window must open on
      // 01/08 00:00 BRT (03:00 UTC), never on 01/08 00:00 UTC.
      const where = prisma.order.count.mock.calls[0][0].where;
      expect(where.createdAt.gte.toISOString()).toBe('2026-08-01T03:00:00.000Z');

      jest.useRealTimers();
    });

    it('should not count cancelled orders against the monthly limit', async () => {
      await service.getUsage(TENANT_ID);

      const where = prisma.order.count.mock.calls[0][0].where;
      expect(where.status.notIn).toContain('CANCELLED');
    });

    it('should throw NotFoundException for an unknown tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      await expect(service.getUsage(TENANT_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
