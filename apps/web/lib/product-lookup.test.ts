import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ default: { get: vi.fn() } }));

import api from "@/lib/api";

import { lookupForSale, lookupProductCode } from "./product-lookup";

const get = vi.mocked(api.get);

describe("product lookup", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks the API for an exact match of the code read", async () => {
    get.mockResolvedValue({ data: { success: true, data: { kind: "MATCH" } } });

    await expect(lookupProductCode("7891000000017")).resolves.toEqual({ kind: "MATCH" });
    expect(get).toHaveBeenCalledWith("/products/lookup", { params: { code: "7891000000017" } });
  });

  it("asks for a product (and variant) picked or already in the cart", async () => {
    get.mockResolvedValue({ data: { success: true, data: { kind: "CHOOSE_VARIANT" } } });

    await lookupForSale("prod-1", "var-1");

    expect(get).toHaveBeenCalledWith("/products/lookup", {
      params: { productId: "prod-1", variantId: "var-1" },
    });
  });
});
