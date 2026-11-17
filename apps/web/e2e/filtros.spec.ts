import { test, expect } from "./fixtures";

/**
 * Jornada: os filtros de cada listagem.
 *
 * Cobre FT-01 … FT-11. A barreira principal é a primeira: **nenhum campo que a
 * API recebe como id pode ser texto livre**. Categoria e Marca em Produtos eram
 * `<input>` cujo valor ia como `categoryId`/`brandId` — comparação exata contra
 * um cuid, então qualquer coisa digitada devolvia zero linhas, e a tabela dizia
 * "nenhum registro" igual a um filtro legítimo sem resultados.
 */

/** Telas de listagem que expõem um painel de filtros. */
const SCREENS = [
  { name: "Produtos", path: "/estoque/produtos", expectedFilters: 3 },
  { name: "Pedidos", path: "/vendas/pedidos", expectedFilters: 5 },
  { name: "Clientes", path: "/clientes", expectedFilters: 2 },
  { name: "Movimentações", path: "/estoque/movimentacoes", expectedFilters: 6 },
  { name: "Contas financeiras", path: "/financeiro/contas", expectedFilters: 2 },
  { name: "Métodos de pagamento", path: "/configuracoes/metodos-pagamento", expectedFilters: 2 },
  { name: "Caixa", path: "/financeiro/caixa", expectedFilters: 2 },
];

/**
 * Abre o painel, seja qual for o modo da largura atual.
 *
 * A partir de `xl` o painel já vem aberto e o botão não existe — clicar nele
 * incondicionalmente falha em toda a suíte. Abaixo disso o botão continua sendo
 * o caminho.
 */
async function openFilters(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200);

  const trigger = page.getByRole("button", { name: /^Filtros/ }).first();
  if (await trigger.isVisible()) {
    await trigger.click();
    await page.waitForTimeout(800);
  }
  return page.getByTestId("filter-panel");
}

test.describe("filtros", () => {
  for (const screen of SCREENS) {
    test(`FT-01: ${screen.name} não tem filtro de entidade em texto livre`, async ({
      appPage,
    }) => {
      const panel = await openFilters(appPage, screen.path);
      await expect(panel).toBeVisible();

      // Datas são `input[type=date]` e continuam legítimas; o que não pode
      // existir é um campo de texto cujo valor vira um id na query.
      //
      // A busca da tela mora no painel desde que ela passou a ser a última
      // célula, e é texto livre por definição — mas vai como `search`, não como
      // id. Ela é excluída nominalmente, pelo seu `data-testid`, para que
      // qualquer *outro* `<input>` que apareça aqui continue reprovando.
      const offenders = await panel
        .locator('input[type="text"]:not([role]), input:not([type]):not([role])')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => !node.closest('[data-testid="filter-search"]'))
            .map((node) => (node as HTMLInputElement).placeholder || "(sem placeholder)")
        );

      expect(
        offenders,
        `${screen.name} tem campo de texto no painel: ${offenders.join(", ")}`
      ).toEqual([]);
    });

    test(`${screen.name} oferece os filtros que a API aceita`, async ({ appPage }) => {
      const panel = await openFilters(appPage, screen.path);

      // Selects (Radix) + buscas assíncronas + datas.
      const controls = panel.locator(
        'button[role="combobox"], input[type="date"], button:has-text("Todos"), button:has-text("Todas")'
      );
      expect(
        await controls.count(),
        `${screen.name} expõe menos filtros do que a API aceita`
      ).toBeGreaterThanOrEqual(screen.expectedFilters);
    });
  }

  test("FT-01: escolher uma categoria devolve linhas, não zero", async ({
    appPage,
    apiClient,
  }) => {
    // O bug: o filtro sempre devolvia zero. A asserção é o efeito do outro
    // lado — a tabela responde com produtos.
    const categories = await apiClient.get("/products/categories");
    const withProducts = (
      (categories.body as { data?: { id: string; name: string; _count?: { products: number } }[] })
        .data ?? []
    ).find((c) => (c._count?.products ?? 0) > 0);
    test.skip(!withProducts, "nenhuma categoria com produtos");

    const panel = await openFilters(appPage, "/estoque/produtos");

    await panel.locator("#filtro-categoria").click();
    await appPage.waitForTimeout(600);
    await appPage
      .getByRole("option", { name: new RegExp(withProducts!.name) })
      .first()
      .click();
    await appPage.waitForTimeout(1800);

    const rows = await appPage.locator("tbody tr").count();
    expect(rows, "o filtro de categoria devolveu zero linhas").toBeGreaterThan(0);
  });

  test("FT-01: o filtro escolhido chega à API como id", async ({ appPage }) => {
    const panel = await openFilters(appPage, "/estoque/produtos");

    const requestPromise = appPage.waitForRequest(
      (request) =>
        request.url().includes("/products?") && request.url().includes("categoryId="),
      { timeout: 15_000 }
    );

    await panel.locator("#filtro-categoria").click();
    await appPage.waitForTimeout(600);
    await appPage.locator('[role="option"]').nth(1).click();

    const request = await requestPromise;
    const categoryId = new URL(request.url()).searchParams.get("categoryId");

    // Um cuid, não um nome digitado.
    expect(categoryId).toBeTruthy();
    expect(categoryId).toMatch(/^c[a-z0-9]{20,}$/);
  });

  test("FT-11: mudar um filtro volta para a página 1", async ({ appPage }) => {
    await appPage.goto("/estoque/produtos");
    await appPage.waitForLoadState("networkidle");
    await appPage.waitForTimeout(1200);

    // Força uma segunda página em vez de pular o teste quando a base é pequena:
    // é justamente o reset de página que está sob teste, e um skip silencioso
    // deixaria a cobertura parecer completa.
    await appPage.getByRole("combobox").filter({ hasText: /por página/ }).click();
    await appPage.waitForTimeout(400);
    await appPage.getByRole("option", { name: "10 por página" }).click();
    await appPage.waitForTimeout(1500);

    const next = appPage.getByRole("button", { name: /Próxima|Next/i }).first();
    await expect(next).toBeEnabled();
    await next.click();
    await appPage.waitForTimeout(1500);

    const pageRequest = appPage.waitForRequest(
      (request) => request.url().includes("/products?") && request.url().includes("status="),
      { timeout: 15_000 }
    );

    // Em `xl` o painel já está aberto e o botão não existe.
    const trigger = appPage.getByRole("button", { name: /^Filtros/ }).first();
    if (await trigger.isVisible()) {
      await trigger.click();
      await appPage.waitForTimeout(600);
    }
    const statusSelect = appPage.getByTestId("filter-panel").locator('button[role="combobox"]').first();
    await statusSelect.click();
    await appPage.waitForTimeout(400);
    await appPage.getByRole("option", { name: "Ativo", exact: true }).click();

    const request = await pageRequest;
    // Sem o reset, o usuário fica na página 7 de um resultado com duas.
    expect(new URL(request.url()).searchParams.get("page")).toBe("1");
  });

  test("FT-11: 'Limpar filtros' zera o contador", async ({ appPage }) => {
    const panel = await openFilters(appPage, "/estoque/produtos");

    await panel.locator("#filtro-categoria").click();
    await appPage.waitForTimeout(600);
    await appPage.locator('[role="option"]').nth(1).click();
    await appPage.waitForTimeout(1500);

    await expect(appPage.getByTestId("active-filter-count")).toHaveText("1");

    await appPage.getByRole("button", { name: /Limpar filtros/ }).click();
    await appPage.waitForTimeout(1200);

    await expect(appPage.getByTestId("active-filter-count")).toHaveCount(0);
  });

  test("FT-09: nenhum `<select>` nativo sobrou nas listagens", async ({ appPage }) => {
    for (const screen of SCREENS) {
      const panel = await openFilters(appPage, screen.path);
      const nativeSelects = await panel.locator("select").count();
      expect(nativeSelects, `${screen.name} ainda usa <select> nativo`).toBe(0);
    }
  });

  test("FT-10: os alertas de estoque aceitam filtro por depósito", async ({
    apiClient,
  }) => {
    const warehouses = await apiClient.get("/inventory/warehouses?limit=1");
    const warehouse = ((warehouses.body as { data?: { id: string }[] }).data ?? [])[0];

    // Respondia 400 — o DTO não conhecia o campo.
    const response = await apiClient.get(
      `/inventory/alerts?warehouseId=${warehouse.id}&limit=5`
    );
    expect(response.status).toBe(200);
  });
});
