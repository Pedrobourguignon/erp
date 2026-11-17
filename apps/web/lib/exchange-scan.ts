import type { ProductLookupResult } from "@erp/shared-types";

import { splitVariantName } from "@/lib/counter-cart";
import type { AdjustMode } from "@/lib/order-adjustment";

export type ExchangeScanOutcome =
  /** `productName` lets the product field show what was read. */
  | { target: { productId: string; variantId: string; productName: string } }
  | { notice: string };

/**
 * What a label read inside the exchange dialog means for the item going out.
 * "Outro tamanho" only takes another size of the product being returned;
 * "Outro produto" takes whatever was read (and asks the size of a parent).
 */
export function exchangeTargetFromScan({
  mode,
  soldProductId,
  returnedVariantId,
  result,
}: {
  mode: AdjustMode;
  soldProductId: string;
  returnedVariantId: string | null;
  result: ProductLookupResult;
}): ExchangeScanOutcome {
  if (result.kind === "NOT_FOUND") {
    return { notice: result.message };
  }
  const productId = result.kind === "MATCH" ? result.item.productId : result.productId;
  const variantId = result.kind === "MATCH" ? result.item.variantId ?? "" : "";
  const productName =
    result.kind === "MATCH" ? splitVariantName(result.item.name).base : result.productName;

  if (mode === "size" && productId !== soldProductId) {
    return { notice: 'Essa etiqueta é de outro produto. Para trocar por ele, use "Outro produto".' };
  }
  if (productId === soldProductId && variantId && variantId === returnedVariantId) {
    return { notice: "Essa é a mesma variação que o cliente está devolvendo." };
  }
  return { target: { productId, variantId, productName } };
}
