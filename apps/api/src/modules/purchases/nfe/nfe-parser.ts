import { BadRequestException } from '@nestjs/common';
import { onlyDigits } from '@erp/validators';
import { XMLParser } from 'fast-xml-parser';

export interface NfeIssuer {
  document: string;
  name: string;
  tradeName: string | null;
  street: string | null;
  number: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
}

export interface NfeItem {
  line: number;
  code: string;
  ean: string | null;
  description: string;
  ncm: string | null;
  cfop: string | null;
  unit: string;
  quantity: number;
  /** Preço unitário de lista (vUnCom), só para exibir. */
  listUnitPrice: number;
  grossCents: number;
  discountCents: number;
  freightCents: number;
  insuranceCents: number;
  otherCents: number;
  ipiCents: number;
  stCents: number;
}

export interface NfeTotals {
  productsCents: number;
  freightCents: number;
  insuranceCents: number;
  discountCents: number;
  otherCents: number;
  ipiCents: number;
  stCents: number;
  invoiceCents: number;
}

export interface NfeInstallment {
  number: string;
  /** Data civil `YYYY-MM-DD`, como veio na nota. */
  dueDate: string;
  amountCents: number;
}

export interface ParsedNfe {
  accessKey: string;
  number: string;
  series: string;
  issuedAt: string;
  /** O dia da emissão como o emitente o escreveu — data civil, sem conversão. */
  issuedDate: string;
  issuer: NfeIssuer;
  items: NfeItem[];
  totals: NfeTotals;
  installments: NfeInstallment[];
}

type Node = Record<string, unknown>;

const NOT_AN_NFE =
  'O arquivo não é uma NF-e válida: envie o XML da nota fiscal eletrônica.';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Tudo como texto: um NCM `04012000` ou um CNPJ não podem perder o zero.
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
  trimValues: true,
  isArray: (name) => name === 'det' || name === 'dup',
});

const text = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result === '' ? null : result;
};

/** "123.45" → 12345. Texto vazio ou ausente é zero. */
const cents = (value: unknown): number => {
  const parsed = Number(text(value) ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
};

const node = (value: unknown): Node =>
  value && typeof value === 'object' ? (value as Node) : {};

/** Primeiro valor de `key` em qualquer nível abaixo de `value`. */
function findKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const current = value as Node;
  if (key in current) return current[key];
  for (const child of Object.values(current)) {
    const found = findKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** GTIN de verdade (8 a 14 dígitos); "SEM GTIN" e zeros de preenchimento não valem. */
function gtin(value: unknown): string | null {
  const digits = onlyDigits(text(value));
  return /^\d{8,14}$/.test(digits) && Number(digits) > 0 ? digits : null;
}

function parseItem(det: Node): NfeItem {
  const prod = node(det.prod);
  const tax = node(det.imposto);

  return {
    line: Number(det['@_nItem']),
    code: text(prod.cProd) ?? '',
    ean: gtin(prod.cEAN) ?? gtin(prod.cEANTrib),
    description: text(prod.xProd) ?? '',
    ncm: text(prod.NCM),
    cfop: text(prod.CFOP),
    unit: text(prod.uCom) ?? 'UN',
    quantity: Number(text(prod.qCom) ?? 0),
    listUnitPrice: Number(text(prod.vUnCom) ?? 0),
    grossCents: cents(prod.vProd),
    discountCents: cents(prod.vDesc),
    freightCents: cents(prod.vFrete),
    insuranceCents: cents(prod.vSeg),
    otherCents: cents(prod.vOutro),
    ipiCents: cents(findKey(tax.IPI, 'vIPI')),
    // Só o ICMS-ST desta nota: o `vICMSSTRet` (ST retido antes) não é custo dela.
    stCents: cents(findKey(tax.ICMS, 'vICMSST')),
  };
}

function parseIssuer(emit: Node): NfeIssuer {
  const address = node(emit.enderEmit);
  return {
    document: onlyDigits(text(emit.CNPJ) ?? text(emit.CPF)),
    name: text(emit.xNome) ?? '',
    tradeName: text(emit.xFant),
    street: text(address.xLgr),
    number: text(address.nro),
    city: text(address.xMun),
    state: text(address.UF),
    zipCode: text(address.CEP),
    phone: text(address.fone),
  };
}

function parseTotals(total: Node): NfeTotals {
  const t = node(total.ICMSTot);
  return {
    productsCents: cents(t.vProd),
    freightCents: cents(t.vFrete),
    insuranceCents: cents(t.vSeg),
    discountCents: cents(t.vDesc),
    otherCents: cents(t.vOutro),
    ipiCents: cents(t.vIPI),
    stCents: cents(t.vST),
    invoiceCents: cents(t.vNF),
  };
}

function locateInfNFe(doc: Node): Node | null {
  if (doc.procEventoNFe || doc.envEvento || doc.evento) {
    throw new BadRequestException(
      'Este arquivo é um evento da NF-e (cancelamento, carta de correção…) e não a nota. Envie o XML da nota.',
    );
  }
  const found =
    node(node(doc.nfeProc).NFe).infNFe ?? node(doc.NFe).infNFe ?? doc.infNFe;
  return found && typeof found === 'object' ? (found as Node) : null;
}

/**
 * Lê o XML de uma NF-e (modelo 55) para o que a entrada de mercadoria precisa:
 * fornecedor, itens, totais e duplicatas. Dinheiro em centavos inteiros.
 *
 * Não grava nada e não decide nada — só traduz o arquivo.
 */
export function parseNfeXml(xml: string): ParsedNfe {
  if (!xml || xml.trim() === '') {
    throw new BadRequestException(NOT_AN_NFE);
  }

  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch {
    throw new BadRequestException(NOT_AN_NFE);
  }

  const inf = locateInfNFe(doc);
  if (!inf) {
    throw new BadRequestException(NOT_AN_NFE);
  }

  const accessKey = String(inf['@_Id'] ?? '').replace(/^NFe/, '');
  if (!/^\d{44}$/.test(accessKey)) {
    throw new BadRequestException('A chave de acesso da NF-e é inválida.');
  }

  const detList = (inf.det as Node[] | undefined) ?? [];
  if (detList.length === 0) {
    throw new BadRequestException('A nota não tem itens.');
  }

  const ide = node(inf.ide);
  const issuedAt = text(ide.dhEmi) ?? text(ide.dEmi) ?? '';

  const duplicatas = (node(inf.cobr).dup as Node[] | undefined) ?? [];

  return {
    accessKey,
    number: text(ide.nNF) ?? '',
    series: text(ide.serie) ?? '',
    issuedAt,
    issuedDate: issuedAt.slice(0, 10),
    issuer: parseIssuer(node(inf.emit)),
    items: detList.map(parseItem),
    totals: parseTotals(node(inf.total)),
    installments: duplicatas.map((dup) => ({
      number: text(dup.nDup) ?? '',
      dueDate: text(dup.dVenc) ?? '',
      amountCents: cents(dup.vDup),
    })),
  };
}
