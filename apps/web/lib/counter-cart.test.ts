import type { SaleCandidate } from "@erp/shared-types";
import { describe, expect, it } from "vitest";

import { cartLineFor, placeInCart, splitVariantName } from "./counter-cart";

const candidate = (overrides: Partial<SaleCandidate> = {}): SaleCandidate => ({
  productId: "prod-cam",
  variantId: "var-m",
  name: "Camiseta Básica — M",
  sku: "CAM-M",
  ean: "7891000000017",
  salePrice: 59.9,
  available: 6,
  ...overrides,
});

describe("placeInCart", () => {
  it("adds a new line for something not in the cart", () => {
    expect(placeInCart([], candidate())).toEqual({ kind: "append", line: cartLineFor(candidate()) });
  });

  it("adds one more unit when the same variant is read again", () => {
    const cart = [{ productId: "prod-cam", variantId: "var-m", quantity: 2 }];

    expect(placeInCart(cart, candidate())).toEqual({ kind: "increment", index: 0, quantity: 3 });
  });

  it("opens a new line for another size of the same product", () => {
    const cart = [{ productId: "prod-cam", variantId: "var-p", quantity: 1 }];

    expect(placeInCart(cart, candidate()).kind).toBe("append");
  });

  it("treats a simple product with no variant as one line", () => {
    const cart = [{ productId: "prod-bone", variantId: null, quantity: 1 }];

    expect(placeInCart(cart, candidate({ productId: "prod-bone", variantId: null }))).toEqual({
      kind: "increment",
      index: 0,
      quantity: 2,
    });
  });

  it("treats a missing variant on an old line as no variant", () => {
    const cart = [{ productId: "prod-bone", quantity: 1 }];

    expect(placeInCart(cart, candidate({ productId: "prod-bone", variantId: null })).kind).toBe("increment");
  });
});

describe("cartLineFor", () => {
  it("carries the variant, the price and the stock into the cart", () => {
    expect(cartLineFor(candidate())).toEqual({
      productId: "prod-cam",
      variantId: "var-m",
      productName: "Camiseta Básica — M",
      sku: "CAM-M",
      availableStock: 6,
      quantity: 1,
      unitPrice: 59.9,
      discount: 0,
    });
  });
});

// A coluna do produto é estreita: o tamanho no fim do nome sumia no "…".
describe("splitVariantName", () => {
  it("separates the size/colour from the product name", () => {
    expect(splitVariantName("Camiseta Básica — M")).toEqual({ base: "Camiseta Básica", variant: "M" });
  });

  it("keeps a name without variant whole", () => {
    expect(splitVariantName("Boné")).toEqual({ base: "Boné", variant: null });
  });
});
