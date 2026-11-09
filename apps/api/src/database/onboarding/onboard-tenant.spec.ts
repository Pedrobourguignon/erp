import { PERMISSION_DEFINITIONS, ROLE_DEFINITIONS } from '@erp/constants';
import { checkPassword } from '@erp/validators';

import { OnboardingError, onboardTenant } from './onboard-tenant';

const VALID_CNPJ = '11222333000181';

function buildPrisma() {
  const tx = {
    tenant: { create: jest.fn().mockResolvedValue({ id: 'tenant-new' }) },
    role: {
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: { name: string } }) =>
          Promise.resolve({ id: `role-${data.name}` }),
        ),
    },
    rolePermission: {
      createMany: jest
        .fn<Promise<{ count: number }>, [{ data: { roleId: string; permissionId: string }[] }]>()
        .mockResolvedValue({ count: 0 }),
    },
    user: {
      create: jest
        .fn<Promise<{ id: string }>, [{ data: { password: string } }]>()
        .mockResolvedValue({ id: 'user-owner' }),
    },
    warehouse: { create: jest.fn().mockResolvedValue({ id: 'wh-1' }) },
  };
  const prisma = {
    permission: {
      upsert: jest
        .fn()
        .mockImplementation(
          ({ create }: { create: { resource: string; action: string } }) =>
            Promise.resolve({ id: `perm-${create.resource}-${create.action}`, ...create }),
        ),
    },
    tenant: { findFirst: jest.fn().mockResolvedValue(null) },
    user: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx };
}

const baseInput = {
  companyName: 'Loja do João Ltda',
  document: '11.222.333/0001-81',
  ownerName: 'João da Silva',
  ownerEmail: 'Joao@Loja.com.br',
  password: 'Sup3r-Segura!2026',
};

describe('onboardTenant', () => {
  it('should create tenant, system roles, owner user and default warehouse', async () => {
    const { prisma, tx } = buildPrisma();

    const result = await onboardTenant(prisma as never, baseInput);

    expect(tx.tenant.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Loja do João Ltda',
          document: VALID_CNPJ,
          email: 'joao@loja.com.br',
        }),
      }),
    );
    expect(tx.role.create).toHaveBeenCalledTimes(ROLE_DEFINITIONS.length);
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-new',
          email: 'joao@loja.com.br',
          roleId: 'role-owner',
          status: 'ACTIVE',
        }),
      }),
    );
    expect(tx.warehouse.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'tenant-new', isDefault: true }),
      }),
    );
    expect(result).toEqual({
      tenantId: 'tenant-new',
      ownerEmail: 'joao@loja.com.br',
      generatedPassword: undefined,
    });
  });

  it('should sync the global permissions before anything else', async () => {
    const { prisma } = buildPrisma();

    await onboardTenant(prisma as never, baseInput);

    expect(prisma.permission.upsert).toHaveBeenCalledTimes(PERMISSION_DEFINITIONS.length);
  });

  it('should grant each role exactly the permissions its definition allows', async () => {
    const { prisma, tx } = buildPrisma();

    await onboardTenant(prisma as never, baseInput);

    const owner = ROLE_DEFINITIONS.find((r) => r.name === 'owner');
    const ownerCall = tx.rolePermission.createMany.mock.calls.find(
      ([arg]) => arg.data[0]?.roleId === 'role-owner',
    );
    const expected = PERMISSION_DEFINITIONS.filter((p) =>
      owner?.grants({ resource: p.resource, action: p.action }),
    ).length;
    expect(ownerCall?.[0].data).toHaveLength(expected);
  });

  it('should store a bcrypt hash, never the plain password', async () => {
    const { prisma, tx } = buildPrisma();

    await onboardTenant(prisma as never, baseInput);

    const stored = tx.user.create.mock.calls[0][0].data.password;
    expect(stored).not.toContain(baseInput.password);
    expect(stored).toMatch(/^\$2[aby]\$/);
  });

  it('should generate a strong password when none is given and return it once', async () => {
    const { prisma, tx } = buildPrisma();
    const withoutPassword = { ...baseInput, password: undefined };

    const result = await onboardTenant(prisma as never, withoutPassword);

    expect(result.generatedPassword).toBeDefined();
    expect(
      checkPassword(result.generatedPassword as string, [baseInput.ownerEmail, baseInput.ownerName])
        .valid,
    ).toBe(true);
    const stored = tx.user.create.mock.calls[0][0].data.password;
    expect(stored).not.toContain(result.generatedPassword as string);
  });

  it('should refuse an invalid CNPJ before touching the database', async () => {
    const { prisma } = buildPrisma();

    await expect(
      onboardTenant(prisma as never, { ...baseInput, document: '12345678000190' }),
    ).rejects.toThrow(/CNPJ inválido/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.permission.upsert).not.toHaveBeenCalled();
  });

  it('should refuse an invalid e-mail', async () => {
    const { prisma } = buildPrisma();

    await expect(
      onboardTenant(prisma as never, { ...baseInput, ownerEmail: 'sem-arroba' }),
    ).rejects.toThrow(/e-mail/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('should refuse a weak password', async () => {
    const { prisma } = buildPrisma();

    await expect(
      onboardTenant(prisma as never, { ...baseInput, password: '123456' }),
    ).rejects.toThrow(OnboardingError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('should refuse a company whose CNPJ is already registered', async () => {
    const { prisma } = buildPrisma();
    prisma.tenant.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(onboardTenant(prisma as never, baseInput)).rejects.toThrow(/Já existe uma empresa/);
    expect(prisma.tenant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { document: VALID_CNPJ, deletedAt: null } }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('should run every write inside one transaction', async () => {
    const { prisma } = buildPrisma();

    await onboardTenant(prisma as never, baseInput);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
