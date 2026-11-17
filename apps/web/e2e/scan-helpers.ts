import type { Page } from "@playwright/test";

import { expect, ensureWarehouse, makeEan13, stamp, type ApiClient } from "./fixtures";

/**
 * Helpers das jornadas do leitor de código de barras: produtos com EAN (no
 * produto ou em cada tamanho) e a "leitura", digitada como o leitor faz.
 */

type Body<T> = { data: T };

export interface ScanProduct {
  id: string;
  name: string;
  sku: string;
  ean: string | null;
  variants: Record<string, { id: string; ean: string }>;
}

/** A product with EAN on itself, or on each size when it has sizes. */
export async function createScanProduct(client: ApiClient, sizes: string[] = []): Promise<ScanProduct> {
  const suffix = stamp();
  const sku = `E2E-LEI-${suffix}`;
  const ean = makeEan13();
  const variantEans = Object.fromEntries(sizes.map((size, i) => [size, makeEan13(Date.now() + 7 * (i + 1))]));
  const created = await client.post("/products", {
    name: `E2E Leitor ${suffix}`,
    sku,
    status: "ACTIVE",
    costPrice: 10,
    salePrice: 30,
    ...(sizes.length === 0 ? { ean } : {}),
    ...(sizes.length > 0
      ? {
          variants: sizes.map((size) => ({
            sku: `${sku}-${size}`,
            name: size,
            ean: variantEans[size],
            attributes: { tamanho: size },
          })),
        }
      : {}),
  });
  expect(created.status, `produto E2E: ${JSON.stringify(created.body)}`).toBe(201);
  const product = (created.body as Body<{ id: string; name: string }>).data;

  const detail = await client.get(`/products/${product.id}`);
  const rows = (detail.body as Body<{ variants?: { id: string; name: string }[] }>).data.variants ?? [];
  const warehouse = await ensureWarehouse(client);
  for (const variantId of rows.length > 0 ? rows.map((v) => v.id) : [undefined]) {
    const stocked = await client.post("/inventory/adjustment", {
      productId: product.id,
      ...(variantId ? { variantId } : {}),
      warehouseId: warehouse.id,
      countedQuantity: 20,
      reason: "INITIAL",
    });
    expect(stocked.status, `estoque E2E: ${JSON.stringify(stocked.body)}`).toBeLessThan(300);
  }

  return {
    id: product.id,
    name: product.name,
    sku,
    ean: sizes.length === 0 ? ean : null,
    variants: Object.fromEntries(rows.map((v) => [v.name, { id: v.id, ean: variantEans[v.name] }])),
  };
}

export async function variantAvailable(client: ApiClient, productId: string, variantId: string) {
  const detail = await client.get(`/products/${productId}`);
  const data = (detail.body as Body<{ variants?: { id: string; inventoryItems?: { available: number }[] }[] }>).data;
  return (data.variants?.find((v) => v.id === variantId)?.inventoryItems ?? []).reduce(
    (sum, i) => sum + Number(i.available),
    0
  );
}

async function untilIdle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    () => new Promise((resolve) => requestIdleCallback(() => resolve(null), { timeout: 2000 }))
  );
}

/**
 * A read as the hardware does it: every key back to back, ending in Enter, and
 * each character landing in the focused field like a real keyboard's would.
 *
 * Playwright's own typing sends each key only after the page handled the
 * previous one, so a page busy for a moment (Next dev, a re-render per key)
 * splits the read in two — something a real reader never does, since its keys
 * carry the time they were generated. Here the keys go in one go.
 */
export async function scan(page: Page, code: string) {
  await untilIdle(page);
  await page.evaluate((text) => {
    const target = (document.activeElement as HTMLElement | null) ?? document.body;
    const field =
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null;
    const setter = field
      ? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set
      : undefined;
    for (const key of [...text, "Enter"]) {
      const allowed = target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
      );
      // The character lands in the field unless the page held it back.
      if (allowed && field && setter && key !== "Enter") {
        setter.call(field, field.value + key);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }, code);
}
