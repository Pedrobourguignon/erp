import type { Page } from "@playwright/test";

import { test, expect, createCustomer, ensureOpenCashSession, waitFor, type ApiClient } from "./fixtures";
import { createScanProduct, scan, type ScanProduct } from "./scan-helpers";

/**
 * Leitor de código de barras fora do balcão: Novo pedido e troca.
 * O efeito se confere no pedido gravado (a variação certa), não no toast.
 */

const WIDE = { width: 1440, height: 950 };
const cartRows = (page: Page) => page.locator("table tbody tr");

type OrderBody = {
  data: {
    id: string;
    items: { id: string; productId: string; variantId: string | null; quantity: number }[];
    adjustments: { newSku: string | null; newName: string | null }[];
  };
};

/** A counter sale of one unit, paid in cash, already settled. */
async function counterSale(client: ApiClient, sessionId: string, product: ScanProduct, variantId?: string) {
  const customer = await createCustomer(client);
  const methods = await client.get("/payment-methods?limit=100");
  const cash = (methods.body as { data: { id: string; type: string; isActive: boolean }[] }).data.find(
    (m) => m.type === "CASH" && m.isActive
  )!;
  const created = await client.post("/orders", {
    origin: "BALCAO",
    customerId: customer.id,
    cashRegisterSessionId: sessionId,
    items: [{ productId: product.id, ...(variantId ? { variantId } : {}), quantity: 1, unitPrice: 30 }],
    payments: [{ paymentMethodId: cash.id, amount: 30 }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const order = (created.body as { data: { id: string } }).data;
  await waitFor(
    async () => ((await client.get(`/orders/${order.id}`)).body as { data: { receivables: unknown[] } }).data,
    (o) => o.receivables.length > 0,
    { label: "recebíveis da venda" }
  );
  return order.id;
}

async function openExchange(page: Page, orderId: string) {
  await page.goto(`/vendas/pedidos/${orderId}`);
  await page.getByRole("button", { name: "Trocar" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Troca ou devolução" })).toBeVisible();
  return dialog;
}

test.describe("leitor no Novo pedido e na troca", () => {
  test.beforeEach(async ({ appPage, apiClient }) => {
    await ensureOpenCashSession(apiClient);
    await appPage.setViewportSize(WIDE);
  });

  test("LP-01: no Novo pedido, a etiqueta da variação entra no pedido com a variação", async ({
    appPage,
    apiClient,
  }) => {
    const camiseta = await createScanProduct(apiClient, ["P", "M"]);
    const customer = await createCustomer(apiClient);

    await appPage.goto("/vendas/pedidos/novo");
    await appPage.getByRole("heading", { name: "Nova Venda" }).click();
    await scan(appPage, camiseta.variants.M.ean);
    await expect(cartRows(appPage).first()).toContainText(camiseta.name);
    await expect(cartRows(appPage).first().getByText("M", { exact: true })).toBeVisible();

    // Com o cursor na quantidade, ler de novo soma 1 — sem digitar nada nela.
    const quantity = appPage.locator("input[name='items.0.quantity']");
    await quantity.click();
    await scan(appPage, camiseta.variants.M.ean);
    await expect(quantity).toHaveValue("2");

    await appPage.getByRole("button", { name: "Buscar cliente por nome ou documento..." }).click();
    await appPage.getByPlaceholder("Buscar...").fill(customer.name);
    await appPage.getByRole("button", { name: new RegExp(customer.name) }).last().click();
    await appPage.getByRole("button", { name: "Adicionar pagamento" }).click();
    await appPage.getByRole("combobox").filter({ hasText: "Selecione..." }).first().click();
    await appPage.getByRole("option", { name: "Dinheiro · dinheiro" }).click();
    await appPage.getByRole("button", { name: "Criar Pedido" }).click();
    // "/vendas/pedidos/novo" já combina com o padrão: espera sair dela.
    await appPage.waitForURL((url) => /\/vendas\/pedidos\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("/novo"));

    const orderId = appPage.url().split("/").pop()!;
    const order = (await apiClient.get(`/orders/${orderId}`)).body as OrderBody;
    expect(order.data.items).toHaveLength(1);
    expect(order.data.items[0]).toMatchObject({ variantId: camiseta.variants.M.id, quantity: 2 });
  });

  test("LP-02: código desconhecido no Novo pedido avisa e não mexe no pedido", async ({ appPage }) => {
    await appPage.goto("/vendas/pedidos/novo");
    await appPage.getByRole("heading", { name: "Nova Venda" }).click();

    await scan(appPage, "7890000000000");

    await expect(
      appPage.getByRole("alert").filter({ hasText: "Nenhum produto com o código 7890000000000" })
    ).toBeVisible();
    await expect(cartRows(appPage)).toHaveCount(0);
  });

  test("LT-01: na troca de tamanho, ler a etiqueta da G escolhe a G e a troca sai com ela", async ({
    appPage,
    apiClient,
  }) => {
    const { sessionId } = await ensureOpenCashSession(apiClient);
    const camiseta = await createScanProduct(apiClient, ["M", "G"]);
    const orderId = await counterSale(apiClient, sessionId, camiseta, camiseta.variants.M.id);

    const dialog = await openExchange(appPage, orderId);
    await expect(dialog.getByRole("radio", { name: "Outro tamanho/cor" })).toHaveAttribute("aria-checked", "true");
    await scan(appPage, camiseta.variants.G.ean);
    await expect(dialog.locator("#adjust-variant")).toContainText("G");

    await dialog.getByRole("button", { name: "Confirmar troca" }).click();
    await expect(appPage.getByText(/Troca registrada/)).toBeVisible();

    const order = (await apiClient.get(`/orders/${orderId}`)).body as OrderBody;
    expect(order.data.adjustments[0]).toMatchObject({ newSku: `${camiseta.sku}-G`, newName: "G" });
  });

  test("LT-02: etiqueta de outro produto na troca de tamanho avisa; em Outro produto, entra", async ({
    appPage,
    apiClient,
  }) => {
    const { sessionId } = await ensureOpenCashSession(apiClient);
    const camiseta = await createScanProduct(apiClient, ["M", "G"]);
    const bone = await createScanProduct(apiClient);
    const orderId = await counterSale(apiClient, sessionId, camiseta, camiseta.variants.M.id);

    const dialog = await openExchange(appPage, orderId);
    await scan(appPage, bone.ean!);
    await expect(
      dialog.getByRole("alert").filter({ hasText: 'Essa etiqueta é de outro produto. Para trocar por ele, use "Outro produto".' })
    ).toBeVisible();

    await dialog.getByRole("radio", { name: "Outro produto" }).click();
    await scan(appPage, bone.ean!);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    // O campo mostra o produto lido, não "Buscar por nome ou SKU".
    await expect(dialog.getByText(bone.name)).toBeVisible();
    await expect(dialog.getByText("Sem diferença a acertar")).toBeVisible();
    await dialog.getByRole("button", { name: "Confirmar troca" }).click();
    await expect(appPage.getByText(/Troca registrada/)).toBeVisible();

    const order = (await apiClient.get(`/orders/${orderId}`)).body as OrderBody;
    expect(order.data.adjustments[0]).toMatchObject({ newSku: bone.sku, newName: bone.name });
  });
});
