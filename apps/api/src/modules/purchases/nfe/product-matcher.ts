import type { NfeItem } from './nfe-parser';

/** Produto (ou variante) do catálogo da empresa, achatado para a comparação. */
export interface CatalogEntry {
  productId: string;
  variantId: string | null;
  sku: string;
  name: string;
  ean: string | null;
  ncm: string | null;
}

/** Código que este fornecedor já usou para um produto (de-para lembrado). */
export interface KnownCode {
  supplierCode: string;
  productId: string;
  variantId: string | null;
}

export type MatchKind = 'SUPPLIER_CODE' | 'EAN' | 'SKU' | 'NAME';

export interface MatchCandidate {
  productId: string;
  variantId: string | null;
  sku: string;
  name: string;
  ean: string | null;
  kind: MatchKind;
  /** 0 a 1: o quanto o sistema confia nesta correspondência. */
  score: number;
  /**
   * 0 a 1: o quanto o nome do produto se parece com o do item da nota,
   * independentemente de ter casado por EAN ou código. Um casamento "seguro"
   * com nome totalmente diferente merece um aviso na tela.
   */
  nameSimilarity: number;
}

export interface ItemMatch {
  /**
   * MATCHED: há uma correspondência segura (código já usado ou EAN único).
   * SUGGESTED: há candidatos, mas o lojista decide.
   * NEW: nada se parece — provavelmente um produto novo.
   *
   * Em nenhum caso o sistema grava sozinho: a entrada sempre passa pela
   * confirmação do lojista.
   */
  status: 'MATCHED' | 'SUGGESTED' | 'NEW';
  candidates: MatchCandidate[];
}

const MAX_CANDIDATES = 5;
const MIN_NAME_SCORE = 0.5;
const NCM_BONUS = 0.1;
const FILLER = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'em', 'c']);

/** Minúsculas, sem acento nem pontuação e sem palavras de ligação. */
export function normalizeText(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token !== '' && !FILLER.has(token));
}

/** Coeficiente de Dice entre dois conjuntos de palavras. */
function similarity(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  left.forEach((token) => {
    if (right.has(token)) shared += 1;
  });
  return (2 * shared) / (left.size + right.size);
}

const keyOf = (productId: string, variantId: string | null) => `${productId}:${variantId ?? ''}`;

function toCandidate(
  entry: CatalogEntry,
  kind: MatchKind,
  score: number,
  nameSimilarity: number,
): MatchCandidate {
  return {
    productId: entry.productId,
    variantId: entry.variantId,
    sku: entry.sku,
    name: entry.name,
    ean: entry.ean,
    kind,
    score: Math.round(score * 100) / 100,
    nameSimilarity: Math.round(nameSimilarity * 100) / 100,
  };
}

/**
 * Procura, no catálogo, o produto que corresponde a um item da nota.
 *
 * Do mais seguro ao menos: código que este fornecedor já usou, EAN, SKU igual ao
 * código do fornecedor e, por último, nome parecido. Um mesmo produto aparece uma
 * vez, com o melhor motivo.
 */
export function matchItem(
  item: NfeItem,
  catalog: CatalogEntry[],
  known: KnownCode[],
): ItemMatch {
  const itemTokens = normalizeText(item.description);
  const nameLike = (entry: CatalogEntry) => similarity(itemTokens, normalizeText(entry.name));
  const byKey = new Map(catalog.map((e) => [keyOf(e.productId, e.variantId), e]));
  const found = new Map<string, MatchCandidate>();
  const keep = (candidate: MatchCandidate) => {
    const key = keyOf(candidate.productId, candidate.variantId);
    const current = found.get(key);
    if (!current || candidate.score > current.score) found.set(key, candidate);
  };

  let safe = false;

  const remembered = known.filter((k) => k.supplierCode === item.code);
  for (const code of remembered) {
    const entry = byKey.get(keyOf(code.productId, code.variantId));
    if (entry) {
      keep(toCandidate(entry, 'SUPPLIER_CODE', 1, nameLike(entry)));
      safe = true;
    }
  }

  if (item.ean) {
    const sameEan = catalog.filter((e) => e.ean === item.ean);
    sameEan.forEach((entry) => keep(toCandidate(entry, 'EAN', 1, nameLike(entry))));
    // um EAN que aponta para mais de um produto não decide nada
    if (sameEan.length === 1) safe = true;
  }

  const code = item.code.trim().toLowerCase();
  if (code) {
    catalog
      .filter((e) => e.sku.trim().toLowerCase() === code)
      .forEach((entry) => keep(toCandidate(entry, 'SKU', 0.9, nameLike(entry))));
  }

  for (const entry of catalog) {
    const nameScore = nameLike(entry);
    let score = nameScore;
    if (score > 0 && item.ncm && entry.ncm && item.ncm === entry.ncm) {
      score = Math.min(1, score + NCM_BONUS);
    }
    if (score >= MIN_NAME_SCORE) keep(toCandidate(entry, 'NAME', score, nameScore));
  }

  const candidates = [...found.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);

  if (candidates.length === 0) return { status: 'NEW', candidates: [] };
  return { status: safe ? 'MATCHED' : 'SUGGESTED', candidates };
}
