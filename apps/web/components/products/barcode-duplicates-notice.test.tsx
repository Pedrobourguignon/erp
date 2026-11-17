import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

let data: unknown = [];
vi.mock("@/hooks/use-barcode-duplicates", () => ({ useBarcodeDuplicates: () => ({ data }) }));

import { BarcodeDuplicatesNotice } from "./barcode-duplicates-notice";

describe("BarcodeDuplicatesNotice", () => {
  it("says nothing when every barcode has one owner", () => {
    data = [];
    render(<BarcodeDuplicatesNotice />);

    expect(screen.queryByText(/repetido/)).not.toBeInTheDocument();
  });

  it("tells how many barcodes are repeated and lists who shares each one", () => {
    data = [
      {
        ean: "7891234567895",
        owners: [
          { productId: "p1", variantId: null, name: "Boné", sku: "BON-01" },
          { productId: "p2", variantId: "v2", name: "Camiseta — M", sku: "CAM-M" },
        ],
      },
    ];
    render(<BarcodeDuplicatesNotice />);

    expect(screen.getByText("1 código de barras repetido")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver códigos repetidos" }));

    expect(screen.getByText("7891234567895")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Boné/ })).toHaveAttribute("href", "/estoque/produtos/p1");
    expect(screen.getByRole("link", { name: /Camiseta — M/ })).toHaveAttribute("href", "/estoque/produtos/p2");
  });
});
