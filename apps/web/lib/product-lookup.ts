import type { ApiResponse, ProductLookupResult } from "@erp/shared-types";

import api from "@/lib/api";

/** Exact match of what the barcode reader read (EAN or SKU). */
export async function lookupProductCode(code: string): Promise<ProductLookupResult> {
  const { data } = await api.get<ApiResponse<ProductLookupResult>>("/products/lookup", {
    params: { code },
  });
  return data.data;
}

/** A product picked by name, or a cart line refreshed: its variants or the line itself. */
export async function lookupForSale(productId: string, variantId?: string | null): Promise<ProductLookupResult> {
  const { data } = await api.get<ApiResponse<ProductLookupResult>>("/products/lookup", {
    params: variantId ? { productId, variantId } : { productId },
  });
  return data.data;
}
