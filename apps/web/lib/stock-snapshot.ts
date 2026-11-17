import type { ApiResponse } from "@erp/shared-types";

import api from "@/lib/api";
import { lookupForSale } from "@/lib/product-lookup";

/**
 * VD-21: `availableStock` in the cart is a snapshot taken when the product was
 * searched. Between the search and the submit another operator may have sold
 * the same unit, so the amber "estoque insuficiente" warning could be lying in
 * either direction. These helpers refresh the snapshot on demand.
 */
interface ProductWithInventory {
  inventorySummary?: { totalAvailable?: number };
  inventory?: { totalAvailable?: number };
}

export async function fetchAvailableStock(
  productId: string,
  variantId?: string | null
): Promise<number | null> {
  if (variantId) {
    // A size/colour has its own stock: the product total would lie.
    try {
      const result = await lookupForSale(productId, variantId);
      return result.kind === "MATCH" ? result.item.available : null;
    } catch {
      return null;
    }
  }
  try {
    const { data } = await api.get<ApiResponse<ProductWithInventory>>(
      `/products/${productId}`
    );
    const product = data?.data;
    const available =
      product?.inventorySummary?.totalAvailable ??
      product?.inventory?.totalAvailable;
    return typeof available === "number" ? available : null;
  } catch {
    // A failed refresh must never block the sale — the API validates the stock
    // again when the order is created.
    return null;
  }
}

export interface CartStockItem {
  productId: string;
  variantId?: string | null;
  quantity: number;
  productName?: string;
}

export interface StockRefreshResult {
  /** Fresh available stock per item, in the same order (null when unknown). */
  available: (number | null)[];
  /** Items whose quantity no longer fits the fresh stock. */
  insufficient: { productName: string; quantity: number; available: number }[];
}

export async function refreshCartStock(
  items: CartStockItem[]
): Promise<StockRefreshResult> {
  const available = await Promise.all(
    items.map((item) => fetchAvailableStock(item.productId, item.variantId))
  );

  const insufficient = items.flatMap((item, index) => {
    const fresh = available[index];
    if (fresh === null || item.quantity <= fresh) {
      return [];
    }
    return [
      {
        productName: item.productName ?? item.productId,
        quantity: item.quantity,
        available: fresh,
      },
    ];
  });

  return { available, insufficient };
}
