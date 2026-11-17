import type { ProductLookupResult } from "@erp/shared-types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lookupProductCode = vi.fn();
let product: { variants: { id: string; name: string; isActive: boolean; inventoryItems: { available: number }[] }[] } | undefined;

vi.mock("@/lib/product-lookup", () => ({ lookupProductCode: (code: string) => lookupProductCode(code) }));
vi.mock("@/lib/scan-sound", () => ({ playScanSound: vi.fn(), scanSoundEnabled: () => false }));
vi.mock("@/hooks/use-products", () => ({
  useProduct: (id: string) => ({ data: id && product ? { data: product } : undefined, isLoading: false }),
}));
vi.mock("./movement-fields", () => ({
  useProductSearch: () => async () => [],
  FieldShell: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <span>{label}</span>
      {children}
    </div>
  ),
}));

import { ProductVariantField } from "./product-variant-field";

function Harness({ onHasVariants = vi.fn() }: { onHasVariants?: (has: boolean) => void }) {
  const [value, setValue] = useState({ productId: "", variantId: "" });
  return (
    <>
      <ProductVariantField
        productId={value.productId}
        variantId={value.variantId}
        onChange={setValue}
        onHasVariantsChange={onHasVariants}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

/** A read as the hardware sends it: keys back to back, then Enter. */
function scan(code: string) {
  for (const key of [...code, "Enter"]) {fireEvent.keyDown(document.body, { key });}
}

const value = () => JSON.parse(screen.getByTestId("value").textContent ?? "{}");

describe("ProductVariantField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    product = undefined;
  });

  it("fills product and size from the label read", async () => {
    lookupProductCode.mockResolvedValue({
      kind: "MATCH",
      item: { productId: "prod-cam", variantId: "var-m", name: "Camiseta — M", sku: "CAM-M", ean: null, salePrice: 10, available: 2 },
    } satisfies ProductLookupResult);
    render(<Harness />);

    scan("7891234567895");

    await waitFor(() => expect(value()).toEqual({ productId: "prod-cam", variantId: "var-m" }));
    expect(screen.getByText("Camiseta")).toBeInTheDocument();
  });

  it("fills only the product when the parent label is read, leaving the size to choose", async () => {
    lookupProductCode.mockResolvedValue({
      kind: "CHOOSE_VARIANT",
      productId: "prod-cam",
      productName: "Camiseta",
      variants: [],
    } satisfies ProductLookupResult);
    render(<Harness />);

    scan("CAM-BASE");

    await waitFor(() => expect(value()).toEqual({ productId: "prod-cam", variantId: "" }));
  });

  it("warns about an unknown label and changes nothing", async () => {
    lookupProductCode.mockResolvedValue({
      kind: "NOT_FOUND",
      code: "7890000000000",
      message: "Nenhum produto com o código 7890000000000",
    } satisfies ProductLookupResult);
    render(<Harness />);

    scan("7890000000000");

    expect(await screen.findByRole("alert")).toHaveTextContent("Nenhum produto com o código 7890000000000");
    expect(value()).toEqual({ productId: "", variantId: "" });
  });

  it("asks for the size of a product with variants, and tells the form it must", async () => {
    product = {
      variants: [
        { id: "var-p", name: "P", isActive: true, inventoryItems: [{ available: 3 }] },
        { id: "var-x", name: "X", isActive: false, inventoryItems: [] },
      ],
    };
    lookupProductCode.mockResolvedValue({
      kind: "CHOOSE_VARIANT",
      productId: "prod-cam",
      productName: "Camiseta",
      variants: [],
    } satisfies ProductLookupResult);
    const onHasVariants = vi.fn();
    render(<Harness onHasVariants={onHasVariants} />);

    scan("CAM-BASE");

    expect(await screen.findByLabelText("Tamanho/cor")).toBeInTheDocument();
    await waitFor(() => expect(onHasVariants).toHaveBeenLastCalledWith(true));
  });
});
