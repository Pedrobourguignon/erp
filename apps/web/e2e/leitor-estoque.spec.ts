import { test, expect, ensureWarehouse } from "./fixtures";
import { createScanProduct, scan, variantAvailable } from "./scan-helpers";

/**
 * Leitor de código de barras nas movimentações de estoque. A etiqueta escolhe o
 * produto e o tamanho; o efeito se confere no saldo da variação, e um produto
 * com tamanhos não move estoque sem dizer qual.
 */

test.describe("leitor nas movimentações de estoque", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.setViewportSize({ width: 1440, height: 950 });
  });

  test("LE-01: a entrada lida pela etiqueta da G soma no saldo da G, não no da M", async ({
    appPage,
    apiClient,
  }) => {
    const camiseta = await createScanProduct(apiClient, ["M", "G"]);
    const warehouse = await ensureWarehouse(apiClient);
    const gBefore = await variantAvailable(apiClient, camiseta.id, camiseta.variants.G.id);
    const mBefore = await variantAvailable(apiClient, camiseta.id, camiseta.variants.M.id);

    await appPage.goto("/estoque/movimentacoes");
    await appPage.getByRole("button", { name: "Nova movimentação" }).click();
    const dialog = appPage.getByRole("dialog", { name: "Nova movimentação" });
    await dialog.getByRole("button", { name: "Entrada", exact: true }).click();

    await scan(appPage, camiseta.variants.G.ean);
    await expect(dialog.getByText(camiseta.name)).toBeVisible();
    await expect(dialog.getByLabel("Tamanho/cor")).toContainText("G");

    await dialog.getByRole("combobox").filter({ hasText: "Selecione o depósito" }).click();
    await appPage.getByRole("option", { name: warehouse.name }).click();
    await dialog.locator("input[name='quantity']").fill("5");
    await dialog.getByRole("combobox").filter({ hasText: "Motivo" }).click();
    await appPage.getByRole("option", { name: "Compra" }).click();
    await dialog.getByRole("button", { name: "Registrar" }).click();
    await expect(dialog).toBeHidden();

    expect(await variantAvailable(apiClient, camiseta.id, camiseta.variants.G.id)).toBe(gBefore + 5);
    expect(await variantAvailable(apiClient, camiseta.id, camiseta.variants.M.id)).toBe(mBefore);
  });

  test("LE-02: a etiqueta do produto pai pede o tamanho, e sem ele o ajuste não sai", async ({
    appPage,
    apiClient,
  }) => {
    const camiseta = await createScanProduct(apiClient, ["M", "G"]);
    const warehouse = await ensureWarehouse(apiClient);

    await appPage.goto("/estoque/movimentacoes");
    await appPage.getByRole("button", { name: "Nova movimentação" }).click();
    const dialog = appPage.getByRole("dialog", { name: "Nova movimentação" });
    await dialog.getByRole("button", { name: "Ajuste", exact: true }).click();

    await scan(appPage, camiseta.sku);
    await expect(dialog.getByLabel("Tamanho/cor")).toBeVisible();

    await dialog.getByRole("combobox").filter({ hasText: "Selecione o depósito" }).click();
    await appPage.getByRole("option", { name: warehouse.name }).click();
    await dialog.getByPlaceholder("Ex.: contagem cíclica de agosto").fill("Contagem da prateleira");
    await dialog.getByRole("button", { name: "Registrar ajuste" }).click();

    await expect(dialog.getByText("Escolha o tamanho/cor")).toBeVisible();
    await expect(dialog).toBeVisible();
  });

  test("LE-03: etiqueta desconhecida avisa dentro do formulário", async ({ appPage }) => {
    await appPage.goto("/estoque/movimentacoes");
    await appPage.getByRole("button", { name: "Nova movimentação" }).click();
    const dialog = appPage.getByRole("dialog", { name: "Nova movimentação" });

    await scan(appPage, "7890000000000");

    await expect(dialog.getByRole("alert").filter({ hasText: "Nenhum produto com o código 7890000000000" })).toBeVisible();
  });
});
