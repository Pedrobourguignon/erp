import { readFile, writeFile } from 'fs/promises';

import { isValidCNPJ, onlyDigits } from '@erp/validators';
import { PrismaClient } from '@prisma/client';

import { ImportError, importProducts } from './import-products';
import { dedupeBarcodes, mapProductRow, type MappedProductRow } from './map-product-row';
import { readProductRows } from './read-product-rows';

const USAGE = `Uso:
  npm run products:import -w @erp/api -- --file caminho/produtos.xlsx --tenant <id|cnpj> \\
    [--apply] [--report relatorio.csv]

Sem --apply é uma SIMULAÇÃO: lê, valida e mostra o que seria feito, sem gravar nada.
Rodar de novo é seguro: produtos cujo SKU já existe são pulados (e o estoque deles não é lançado outra vez).`;

function parseArgs(argv: string[]): { file: string; tenant: string; apply: boolean; report?: string } {
  const values: Record<string, string> = {};
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--apply') {
      apply = true;
    } else if (key.startsWith('--') && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
      values[key.slice(2)] = argv[++i];
    } else {
      throw new ImportError(`Argumento inválido: ${key}`);
    }
  }
  if (!values['file'] || !values['tenant']) {
    throw new ImportError('Faltam: --file e --tenant.');
  }
  return { file: values['file'], tenant: values['tenant'], apply, report: values['report'] };
}

async function resolveTenantId(prisma: PrismaClient, ref: string): Promise<string> {
  const digits = onlyDigits(ref);
  const where = isValidCNPJ(digits) ? { document: digits } : { id: ref };
  const tenant = await prisma.tenant.findFirst({
    where: { ...where, deletedAt: null },
    select: { id: true },
  });
  if (!tenant) {
    throw new ImportError(`Empresa não encontrada: ${ref}`);
  }
  return tenant.id;
}

const csvCell = (value: string): string => `"${value.replace(/"/g, '""')}"`;

function buildReport(rows: MappedProductRow[]): string {
  const lines = ['linha;sku;nome;situacao;codigos;detalhes'];
  for (const r of rows.filter((x) => x.issues.length > 0)) {
    lines.push(
      [
        r.rowNumber,
        r.sku,
        csvCell(r.name),
        r.rejected ? 'REJEITADA' : 'IMPORTADA COM AJUSTE',
        r.issues.map((i) => i.code).join(','),
        csvCell(r.issues.map((i) => i.message).join(' | ')),
      ].join(';'),
    );
  }
  return `${lines.join('\n')}\n`;
}

function summarise(rows: MappedProductRow[]): string[] {
  const counts = new Map<string, number>();
  rows.forEach((r) => r.issues.forEach((i) => counts.set(i.code, (counts.get(i.code) ?? 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code, n]) => `    ${String(n).padStart(5)}  ${code}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const tenantId = await resolveTenantId(prisma, args.tenant);
    const raw = await readProductRows(await readFile(args.file));
    const mapped = dedupeBarcodes(raw.map(mapProductRow));
    const result = await importProducts(prisma, tenantId, mapped, { apply: args.apply });

    const out = [
      args.apply ? 'IMPORTAÇÃO CONCLUÍDA' : 'SIMULAÇÃO (nada foi gravado — use --apply para importar)',
      `  Linhas lidas ........ ${raw.length}`,
      `  Produtos a criar .... ${result.toCreate}`,
      `  Já existiam (pulados) ${result.skippedExisting}`,
      `  Rejeitados .......... ${result.rejected}`,
      `  Categorias novas .... ${result.categoriesToCreate}`,
      `  Estoque inicial ..... ${result.stockUnits} peças`,
      '  Ocorrências por tipo:',
      ...summarise(mapped),
    ];
    process.stdout.write(`${out.join('\n')}\n`);

    if (args.report) {
      await writeFile(args.report, buildReport(mapped), 'utf8');
      process.stdout.write(`Relatório: ${args.report}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ImportError) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
  } else {
    process.stderr.write(`Falha: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exit(1);
});
