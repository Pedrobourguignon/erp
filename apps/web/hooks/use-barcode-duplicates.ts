import type { ApiResponse, BarcodeDuplicate } from "@erp/shared-types";
import { useQuery } from "@tanstack/react-query";

import api from "@/lib/api";

import { productKeys } from "./use-products";

/**
 * Barcodes registered on more than one product/size. Under the products key,
 * so fixing a product (which invalidates the products cache) refreshes it.
 */
export function useBarcodeDuplicates() {
  return useQuery({
    queryKey: [...productKeys.all, "barcode-duplicates"] as const,
    queryFn: async () => {
      const { data } = await api.get<ApiResponse<BarcodeDuplicate[]>>("/products/barcode-duplicates");
      return data.data;
    },
  });
}
