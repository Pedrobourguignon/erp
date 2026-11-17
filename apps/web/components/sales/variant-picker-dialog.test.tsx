import type { SaleCandidate } from "@erp/shared-types";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { VariantPickerDialog } from "./variant-picker-dialog";

const variant = (overrides: Partial<SaleCandidate>): SaleCandidate => ({
  productId: "prod-cam",
  variantId: "var-p",
  name: "Camiseta Básica — P",
  sku: "CAM-P",
  ean: null,
  salePrice: 59.9,
  available: 3,
  ...overrides,
});

const variants = [variant({}), variant({ variantId: "var-m", name: "Camiseta Básica — M", sku: "CAM-M", available: 0 })];

describe("VariantPickerDialog", () => {
  it("lists every size/colour with its stock", () => {
    render(<VariantPickerDialog picker={{ productName: "Camiseta Básica", variants }} onPick={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: /Camiseta Básica/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Camiseta Básica — P.*3 un\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Camiseta Básica — M.*sem estoque/ })).toBeInTheDocument();
  });

  it("puts the chosen variant in the cart", () => {
    const onPick = vi.fn();
    render(<VariantPickerDialog picker={{ productName: "Camiseta Básica", variants }} onPick={onPick} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Camiseta Básica — M/ }));

    expect(onPick).toHaveBeenCalledWith(variants[1]);
  });

  it("starts with the first option focused, so Enter picks it", () => {
    render(<VariantPickerDialog picker={{ productName: "Camiseta Básica", variants }} onPick={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Camiseta Básica — P/ })).toHaveFocus();
  });

  it("renders nothing without a product to choose", () => {
    render(<VariantPickerDialog picker={null} onPick={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
