import { randomInt } from 'crypto';

import { PERMISSION_DEFINITIONS, ROLE_DEFINITIONS } from '@erp/constants';
import { checkPassword, isValidCNPJ, onlyDigits } from '@erp/validators';
import type { Permission, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

export interface OnboardTenantInput {
  companyName: string;
  /** CNPJ, with or without mask. Stored as digits. */
  document: string;
  ownerName: string;
  ownerEmail: string;
  /** When omitted a strong password is generated and returned once. */
  password?: string;
  phone?: string;
}

export interface OnboardTenantResult {
  tenantId: string;
  ownerEmail: string;
  /** Only set when the password was generated here. */
  generatedPassword: string | undefined;
}

/** A refusal the operator can read and act on (pt-BR). */
export class OnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingError';
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_ALPHABETS = [
  'abcdefghijkmnopqrstuvwxyz',
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  '23456789',
  '!@#$%&*?',
];

/** Uses `crypto.randomInt` (CSPRNG) and guarantees one char of every class. */
export function generatePassword(length = 16): string {
  const all = PASSWORD_ALPHABETS.join('');
  const chars = PASSWORD_ALPHABETS.map((set) => set[randomInt(set.length)]);
  while (chars.length < length) {
    chars.push(all[randomInt(all.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function validate(input: OnboardTenantInput) {
  const document = onlyDigits(input.document);
  const email = input.ownerEmail.trim().toLowerCase();
  const companyName = input.companyName.trim();
  const ownerName = input.ownerName.trim();

  if (!companyName) {
    throw new OnboardingError('Informe o nome da empresa.');
  }
  if (!ownerName) {
    throw new OnboardingError('Informe o nome do dono.');
  }
  if (!isValidCNPJ(document)) {
    throw new OnboardingError('CNPJ inválido.');
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new OnboardingError('E-mail do dono inválido.');
  }

  const password = input.password ?? generatePassword();
  const generated = input.password === undefined ? password : undefined;
  const check = checkPassword(password, [email, ownerName]);
  if (!check.valid) {
    throw new OnboardingError(`Senha fraca: ${check.message ?? 'não atende à política.'}`);
  }

  return { document, email, companyName, ownerName, password, generated };
}

/**
 * Creates a company ready to log in to: tenant, the system roles with their
 * permissions, the owner user and the default warehouse. Nothing else — payment
 * methods, accounts and catalog are the owner's to configure.
 *
 * Refuses (rather than merges) when the CNPJ already has a company, so running
 * it twice by mistake cannot touch a live tenant. Every write of the new company
 * is one transaction: a failure leaves no half-built tenant behind.
 */
export async function onboardTenant(
  prisma: PrismaClient,
  input: OnboardTenantInput,
): Promise<OnboardTenantResult> {
  const data = validate(input);

  const existing = await prisma.tenant.findFirst({
    where: { document: data.document, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    throw new OnboardingError('Já existe uma empresa cadastrada com este CNPJ.');
  }

  // Permissions are global, and `migrate deploy` does not seed them: a fresh
  // production database would otherwise have roles that grant nothing.
  const permissions: Permission[] = [];
  for (const def of PERMISSION_DEFINITIONS) {
    permissions.push(
      await prisma.permission.upsert({
        where: { resource_action: { resource: def.resource, action: def.action } },
        update: { description: def.description },
        create: def,
      }),
    );
  }

  const passwordHash = await bcrypt.hash(data.password, 10);

  const tenantId = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        name: data.companyName,
        document: data.document,
        email: data.email,
        phone: input.phone,
        plan: 'TRIAL',
        status: 'ACTIVE',
        settings: { currency: 'BRL', timezone: 'America/Sao_Paulo', language: 'pt-BR' },
      },
      select: { id: true },
    });

    const roleIds: Record<string, string> = {};
    for (const def of ROLE_DEFINITIONS) {
      const role = await tx.role.create({
        data: {
          tenantId: tenant.id,
          name: def.name,
          description: def.description,
          isSystem: true,
        },
        select: { id: true },
      });
      roleIds[def.name] = role.id;

      const granted = permissions.filter((p) =>
        def.grants({ resource: p.resource, action: p.action }),
      );
      await tx.rolePermission.createMany({
        data: granted.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
    }

    await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: data.email,
        password: passwordHash,
        name: data.ownerName,
        status: 'ACTIVE',
        roleId: roleIds['owner'],
      },
    });

    await tx.warehouse.create({
      data: {
        tenantId: tenant.id,
        name: 'Depósito Principal',
        code: 'DEP-001',
        isDefault: true,
        isActive: true,
      },
    });

    return tenant.id;
  });

  return { tenantId, ownerEmail: data.email, generatedPassword: data.generated };
}
