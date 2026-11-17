import type { ProductLookupResult, SaleCandidate } from "@erp/shared-types";
import { describe, expect, it } from "vitest";

import { exchangeTargetFromScan } from "./exchange-scan";

const candidate = (overrides: Partial<SaleCandidate> = {}): SaleCandidate => ({
  productId: "prod-cam",
  variantId: "var-g",
  name: "Camiseta — G",
  sku: "CAM-G",
  ean: "7891234567895",
  salePrice: 59.9,
  available: 4,
  ...overrides,
});
const match = (c: SaleCandidate): ProductLookupResult => ({ kind: "MATCH", item: c });
const sold = { soldProductId: "prod-cam", returnedVariantId: "var-m" };

describe("exchangeTargetFromScan — another size", () => {
  it("picks the size read on the label", () => {
    expect(exchangeTargetFromScan({ mode: "size", ...sold, result: match(candidate()) })).toEqual({
      target: { productId: "prod-cam", variantId: "var-g", productName: "Camiseta" },
    });
  });

  it("refuses a label of another product and says how to do it", () => {
    expect(
      exchangeTargetFromScan({ mode: "size", ...sold, result: match(candidate({ productId: "prod-bone" })) })
    ).toEqual({ notice: 'Essa etiqueta é de outro produto. Para trocar por ele, use "Outro produto".' });
  });

  it("refuses the same size the customer is giving back", () => {
    expect(
      exchangeTargetFromScan({ mode: "size", ...sold, result: match(candidate({ variantId: "var-m" })) })
    ).toEqual({ notice: "Essa é a mesma variação que o cliente está devolvendo." });
  });
});

describe("exchangeTargetFromScan — another product", () => {
  it("picks the product and the size read", () => {
    expect(
      exchangeTargetFromScan({
        mode: "product",
        ...sold,
        result: match(candidate({ productId: "prod-calca", variantId: "var-40", name: "Calça — 40" })),
      })
    ).toEqual({ target: { productId: "prod-calca", variantId: "var-40", productName: "Calça" } });
  });

  it("picks a simple product, with no size", () => {
    expect(
      exchangeTargetFromScan({
        mode: "product",
        ...sold,
        result: match(candidate({ productId: "prod-bone", variantId: null, name: "Boné" })),
      })
    ).toEqual({ target: { productId: "prod-bone", variantId: "", productName: "Boné" } });
  });

  it("picks the product and leaves the size to choose when the parent label is read", () => {
    const result: ProductLookupResult = {
      kind: "CHOOSE_VARIANT",
      productId: "prod-calca",
      productName: "Calça",
      variants: [candidate({ productId: "prod-calca" })],
    };

    expect(exchangeTargetFromScan({ mode: "product", ...sold, result })).toEqual({
      target: { productId: "prod-calca", variantId: "", productName: "Calça" },
    });
  });
});

describe("exchangeTargetFromScan — unknown label", () => {
  it("says nothing has that code", () => {
    expect(
      exchangeTargetFromScan({
        mode: "product",
        ...sold,
        result: { kind: "NOT_FOUND", code: "0001", message: "Nenhum produto com o código 0001" },
      })
    ).toEqual({ notice: "Nenhum produto com o código 0001" });
  });
});
