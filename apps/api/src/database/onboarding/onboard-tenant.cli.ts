import { PrismaClient } from '@prisma/client';

import { OnboardingError, onboardTenant, type OnboardTenantInput } from './onboard-tenant';

const USAGE = `Uso:
  npm run tenant:create -w @erp/api -- \\
    --name "Loja do João Ltda" --document 11.222.333/0001-81 \\
    --owner-name "João da Silva" --owner-email joao@loja.com.br \\
    [--phone "(11) 99999-0000"] [--password "..."]

Sem --password, uma senha forte é gerada e mostrada uma única vez.
Prefira a variável ONBOARDING_PASSWORD a --password: argumentos ficam no histórico do shell.`;

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new OnboardingError(`Argumento inválido: ${key}`);
    }
    out[key.slice(2)] = value;
  }
  return out;
}

function toInput(args: Record<string, string>): OnboardTenantInput {
  const required = ['name', 'document', 'owner-name', 'owner-email'];
  const missing = required.filter((k) => !args[k]);
  if (missing.length > 0) {
    throw new OnboardingError(`Faltam: ${missing.map((k) => `--${k}`).join(', ')}`);
  }
  return {
    companyName: args['name'],
    document: args['document'],
    ownerName: args['owner-name'],
    ownerEmail: args['owner-email'],
    phone: args['phone'],
    password: args['password'] ?? process.env.ONBOARDING_PASSWORD,
  };
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const result = await onboardTenant(prisma, toInput(parseArgs(process.argv.slice(2))));
    const lines = [
      'Empresa criada.',
      `  Tenant : ${result.tenantId}`,
      `  Login  : ${result.ownerEmail}`,
      result.generatedPassword !== undefined
        ? `  Senha  : ${result.generatedPassword}   (mostrada só agora — repasse ao cliente)`
        : '  Senha  : a informada',
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof OnboardingError) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
  } else {
    process.stderr.write(`Falha inesperada: ${String(error)}\n`);
  }
  process.exit(1);
});
