import { test, expect } from "./fixtures";

/**
 * O topo não tem busca global: nem o campo "Buscar…", nem o atalho Ctrl/Cmd+K.
 * As telas de lista continuam com a busca própria.
 */
test.describe("layout: header", () => {
  test("o header não tem campo de busca nem abre busca com Ctrl+K", async ({ appPage }) => {
    await appPage.goto("/estoque/produtos");
    await expect(appPage.locator("header")).toBeVisible();

    await expect(appPage.locator("header").getByRole("button", { name: "Buscar" })).toHaveCount(0);
    await expect(appPage.locator("header").getByText("Buscar...")).toHaveCount(0);

    await appPage.keyboard.press("Control+k");
    await expect(appPage.getByRole("dialog", { name: "Busca global" })).toHaveCount(0);

    // A busca da própria lista segue funcionando.
    await expect(appPage.getByPlaceholder("Buscar por nome ou SKU...")).toBeVisible();
  });
});
