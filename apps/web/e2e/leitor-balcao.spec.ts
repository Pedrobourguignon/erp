import type { Page } from "@playwright/test";

import {
  test,
  expect,
  createCustomer,
  ensureOpenCashSession,
  waitFor,
} from "./fixtures";
import { createScanProduct, scan, variantAvailable } from "./scan-helpers";

/**
 * Leitor de código de barras no balcão.
 *
 * O leitor é um teclado: digita o código a poucos ms por tecla e termina com
 * Enter. Aqui o Playwright digita do mesmo jeito (5 ms por tecla), com o cursor
 * onde estiver, e a prova é o carrinho e o estoque da variação — não o toast.
 */

const WIDE = { width: 1440, height: 950 };

const cartRows = (page: Page) => page.locator("table tbody tr");

test.describe("leitor de código de barras no balcão", () => {
  test.beforeEach(async ({ appPage, apiClient }) => {
    await ensureOpenCashSession(apiClient);
    await appPage.setViewportSize(WIDE);
  });

  test("LB-01: a leitura entra no carrinho mesmo com o cursor na quantidade, sem mexer nela", async ({
    appPage,
    apiClient,
  }) => {
    const boné = await createScanProduct(apiClient);
    const camiseta = await createScanProduct(apiClient);
    await appPage.goto("/vendas/balcao");
    await appPage.getByRole("heading", { name: "Venda no Balcão" }).click();

    await scan(appPage, boné.ean!);
    await expect(cartRows(appPage)).toHaveCount(1);
    await expect(cartRows(appPage).first()).toContainText(boné.name);

    // O cursor fica na quantidade do boné e o leitor lê a camiseta.
    const quantity = appPage.locator("input[name='items.0.quantity']");
    await quantity.click();
    await scan(appPage, camiseta.ean!);

    await expect(cartRows(appPage)).toHaveCount(2);
    await expect(cartRows(appPage).nth(1)).toContainText(camiseta.name);
    await expect(quantity).toHaveValue("1");
    // O Enter do leitor não finalizou nem enviou nada.
    await expect(appPage).toHaveURL(/\/vendas\/balcao$/);

    // Ler o boné de novo soma quantidade, não abre outra linha.
    await scan(appPage, boné.ean!);
    await expect(cartRows(appPage)).toHaveCount(2);
    await expect(quantity).toHaveValue("2");
  });

  test("LB-02: a etiqueta da variação M vende a M e baixa o estoque dela, não o da P", async ({
    appPage,
    apiClient,
  }) => {
    const camiseta = await createScanProduct(apiClient, ["P", "M"]);
    const customer = await createCustomer(apiClient);
    const mBefore = await variantAvailable(apiClient, camiseta.id, camiseta.variants.M.id);
    const pBefore = await variantAvailable(apiClient, camiseta.id, camiseta.variants.P.id);

    await appPage.goto("/vendas/balcao");
    await appPage.getByRole("heading", { name: "Venda no Balcão" }).click();
    await scan(appPage, camiseta.variants.M.ean);
    await expect(cartRows(appPage).first()).toContainText(camiseta.name);
    await expect(cartRows(appPage).first().getByText("M", { exact: true })).toBeVisible();

    await appPage.getByRole("button", { name: "Buscar cliente por nome ou documento..." }).click();
    await appPage.getByPlaceholder("Buscar...").fill(customer.name);
    await appPage.getByRole("button", { name: new RegExp(customer.name) }).last().click();
    await appPage.getByRole("button", { name: "Adicionar pagamento" }).click();
    await appPage.getByRole("combobox").filter({ hasText: "Selecione..." }).first().click();
    await appPage.getByRole("option", { name: "Dinheiro · dinheiro" }).click();
    await appPage.getByRole("button", { name: /Finalizar Venda/ }).click();
    await appPage.waitForURL(/\/vendas\/pedidos\/[^/]+$/);

    await waitFor(
      () => variantAvailable(apiClient, camiseta.id, camiseta.variants.M.id),
      (v) => v === mBefore - 1,
      { label: "baixa da variação M" }
    );
    expect(await variantAvailable(apiClient, camiseta.id, camiseta.variants.P.id)).toBe(pBefore);
  });

  test("LB-03: código não cadastrado avisa e não mexe no carrinho", async ({ appPage }) => {
    await appPage.goto("/vendas/balcao");
    await appPage.getByRole("heading", { name: "Venda no Balcão" }).click();

    await scan(appPage, "7890000000000");

    await expect(
      appPage.getByRole("alert").filter({ hasText: "Nenhum produto com o código 7890000000000" })
    ).toBeVisible();
    await expect(appPage.getByText("Nenhum item adicionado")).toBeVisible();
  });

  test("LB-04: produto com variações pede o tamanho, pela busca por nome ou pelo código do pai", async ({
    appPage,
    apiClient,
  }) => {
    const camiseta = await createScanProduct(apiClient, ["P", "M"]);
    await appPage.goto("/vendas/balcao");

    // Pela busca por nome: antes entrava o "pai" com quantidade vazia e R$ 0,00.
    await appPage.getByRole("button", { name: /Buscar produto/ }).click();
    await appPage.getByPlaceholder("Buscar...").fill(camiseta.sku);
    await appPage.getByRole("button", { name: new RegExp(camiseta.name) }).last().click();
    const dialog = appPage.getByRole("dialog", { name: new RegExp(camiseta.name) });
    await dialog.getByRole("button", { name: new RegExp(`${camiseta.name} — P`) }).click();
    await expect(cartRows(appPage).first().getByText("P", { exact: true })).toBeVisible();
    await expect(cartRows(appPage).first()).toContainText("30,00");

    // Pelo leitor, com o SKU do pai: o diálogo abre com a primeira opção em foco.
    await appPage.keyboard.press("Escape");
    await appPage.getByRole("heading", { name: "Venda no Balcão" }).click();
    await scan(appPage, camiseta.sku);
    await expect(dialog).toBeVisible();
    await appPage.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(cartRows(appPage).first().getByText("P", { exact: true })).toBeVisible();
    await expect(appPage.locator("input[name='items.0.quantity']")).toHaveValue("2");
  });
});
