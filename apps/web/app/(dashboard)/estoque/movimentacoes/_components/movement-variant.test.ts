import { describe, expect, it } from "vitest";
import { z } from "zod";

import { requireVariant, variantFields } from "./movement-variant";

const schema = z.object({ productId: z.string(), ...variantFields }).superRefine(requireVariant);

describe("requireVariant", () => {
  it("asks for the size/colour of a product that has them", () => {
    const result = schema.safeParse({ productId: "p1", hasVariants: true, variantId: "" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["variantId"], message: "Escolha o tamanho/cor" });
  });

  it("accepts a product with variants once the size is chosen", () => {
    expect(schema.safeParse({ productId: "p1", hasVariants: true, variantId: "v1" }).success).toBe(true);
  });

  it("does not ask anything of a simple product", () => {
    expect(schema.safeParse({ productId: "p1", hasVariants: false, variantId: "" }).success).toBe(true);
  });
});
