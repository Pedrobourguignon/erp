import type { SaleCandidate } from "@erp/shared-types";

/** A line of the counter-sale cart, as the form holds it. */
export interface CounterCartLine {
  productId: string;
  variantId: string | null;
  productName: string;
  sku: string;
  availableStock: number;
  quantity: number;
  unitPrice: number;
  discount: number;
}

export type CartPlacement =
  | { kind: "increment"; index: number; quantity: number }
  | { kind: "append"; line: CounterCartLine };

export function cartLineFor(candidate: SaleCandidate): CounterCartLine {
  return {
    productId: candidate.productId,
    variantId: candidate.variantId,
    productName: candidate.name,
    sku: candidate.sku,
    availableStock: candidate.available,
    quantity: 1,
    unitPrice: candidate.salePrice,
    discount: 0,
  };
}

/**
 * The same product and variant read again adds a unit (VD-18); another size
 * or colour of the same product is another line, with its own stock.
 */
export function placeInCart(
  cart: ReadonlyArray<{ productId: string; variantId?: string | null; quantity: unknown }>,
  candidate: SaleCandidate
): CartPlacement {
  const index = cart.findIndex(
    (line) => line.productId === candidate.productId && (line.variantId ?? null) === candidate.variantId
  );
  if (index >= 0) {
    return { kind: "increment", index, quantity: (Number(cart[index].quantity) || 0) + 1 };
  }
  return { kind: "append", line: cartLineFor(candidate) };
}

const VARIANT_SEPARATOR = " — ";

/** "Camiseta Básica — M" → base and variant, so the size never hides in a "…". */
export function splitVariantName(name: string): { base: string; variant: string | null } {
  const at = name.lastIndexOf(VARIANT_SEPARATOR);
  if (at < 0) {return { base: name, variant: null };}
  return { base: name.slice(0, at), variant: name.slice(at + VARIANT_SEPARATOR.length) };
}
