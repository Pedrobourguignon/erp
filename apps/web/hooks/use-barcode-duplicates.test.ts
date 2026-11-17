import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ default: { get: vi.fn() } }));

import api from "@/lib/api";

import { useBarcodeDuplicates } from "./use-barcode-duplicates";
import { productKeys } from "./use-products";

const get = vi.mocked(api.get);

describe("useBarcodeDuplicates", () => {
  it("reads the repeated barcodes, under the products cache (an edit refreshes it)", async () => {
    get.mockResolvedValue({ data: { success: true, data: [{ ean: "7891234567895", owners: [] }] } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useBarcodeDuplicates(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([{ ean: "7891234567895", owners: [] }]));
    expect(get).toHaveBeenCalledWith("/products/barcode-duplicates");
    expect(client.getQueryCache().getAll()[0].queryKey.slice(0, 1)).toEqual(productKeys.all);
  });
});
