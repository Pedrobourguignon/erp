import { z } from "zod";

/** The size/colour of a stock movement, and whether the product has any. */
export const variantFields = {
  variantId: z.string().optional(),
  hasVariants: z.boolean().optional(),
};

/**
 * A product with sizes keeps its stock per size: a movement without one would
 * create a balance that belongs to no size and that no sale ever consumes.
 */
export function requireVariant(
  values: { variantId?: string; hasVariants?: boolean },
  ctx: z.RefinementCtx
): void {
  if (values.hasVariants && !values.variantId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["variantId"], message: "Escolha o tamanho/cor" });
  }
}
