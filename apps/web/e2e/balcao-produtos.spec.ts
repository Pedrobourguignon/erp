import { test, expect } from "./fixtures";

/**
 * O seletor de produtos do balcão.
 *
 * Era uma busca própria com tabela de resultados; agora é o mesmo seletor do
 * cliente. A troca só é aceitável porque o fluxo de teclado do PDV foi inteiro
 * preservado: o operador trabalha com as duas mãos no teclado e o leitor de
 * código de barras digita e termina com Enter (VD-18). Um dropdown que
 * custasse um clique por item bipado seria um retrocesso, não um ajuste.
 *
 * O campo abria sozinho ao entrar na tela — pensado para o primeiro bipe não
 * custar nem um F2. Na prática abria um dropdown cobrindo o resto da tela sem
 * nenhum gesto do operador, o que o usuário reportou como comportamento
 * indevido. O campo agora começa fechado; o ganho do bipe sem clique continua
 * valendo a partir do primeiro F2 (ou clique), inclusive entre bipes
 * seguidos — só o "abre sozinho ao carregar" saiu.
 */

const WIDE = { width: 1440, height: 950 };

function opcoes(page: import("@playwright/test").Page) {
  return page.locator("div.max-h-56 > button");
}

/** Abre o seletor de produtos com F2 e espera a lista carregar. */
async function abrirBusca(page: import("@playwright/test").Page) {
  await page.keyboard.press("F2");
  await expect(opcoes(page).first()).toBeVisible();
}

async function skusReais(
  apiClient: { get: (path: string) => Promise<{ body: unknown }> },
  quantos: number
) {
  const { body } = await apiClient.get(
    `/products?limit=${quantos}&status=ACTIVE`
  );
  return ((body as { data?: { sku: string }[] }).data ?? []).map((p) => p.sku);
}

test.describe("balcão: seletor de produtos", () => {
  test.beforeEach(async ({ appPage }) => {
    await appPage.setViewportSize(WIDE);
    await appPage.goto("/vendas/balcao");
    await appPage.getByRole("button", { name: /Buscar produto/ }).waitFor();
  });

  test("o campo começa fechado; nenhum gesto do operador abre a lista sozinha", async ({
    appPage,
  }) => {
    await expect(opcoes(appPage)).toHaveCount(0);
    await expect
      .poll(async () =>
        appPage.evaluate(
          () => document.activeElement?.getAttribute("placeholder") ?? null
        )
      )
      .not.toBe("Buscar...");
  });

  test("a lista vem preenchida, sem digitar nada", async ({ appPage }) => {
    await abrirBusca(appPage);

    // As opções chegam por requisição: contar antes de esperar é uma corrida.
    expect(await opcoes(appPage).count()).toBeGreaterThan(1);

    const texto = await opcoes(appPage).first().innerText();
    expect(texto).toMatch(/R\$/);
    expect(texto).toMatch(/un\.|sem estoque/);
  });

  test("digitar filtra a lista", async ({ appPage, apiClient }) => {
    const [sku] = await skusReais(apiClient, 1);
    await abrirBusca(appPage);

    await appPage.getByPlaceholder("Buscar...").fill(sku);

    await expect(opcoes(appPage).first()).toContainText(sku);
    await expect(opcoes(appPage)).toHaveCount(1);
  });

  test("VD-18: o bipe termina em Enter e some para o carrinho", async ({
    appPage,
    apiClient,
  }) => {
    const [sku] = await skusReais(apiClient, 1);
    await abrirBusca(appPage);

    // O leitor digita e termina com Enter, sem esperar o debounce de 300ms.
    await appPage.keyboard.type(sku);
    await appPage.keyboard.press("Enter");

    await expect(appPage.locator("input[name^='items.']").first()).toBeVisible();
    await expect(appPage.getByText(/Subtotal \(1 item\)/)).toBeVisible();
  });

  test("VD-18: bipes seguidos não pedem clique nenhum entre eles", async ({
    appPage,
    apiClient,
  }) => {
    // O teste que justifica `keepOpenOnSelect`: se a lista fechasse ao escolher,
    // cada item custaria um clique ou um F2. O primeiro F2 abre; daí em diante
    // nenhum gesto extra deveria ser necessário entre um bipe e o outro.
    const [primeiro, segundo] = await skusReais(apiClient, 2);
    await abrirBusca(appPage);

    await appPage.keyboard.type(primeiro);
    await appPage.keyboard.press("Enter");
    await expect(appPage.getByText(/Subtotal \(1 item\)/)).toBeVisible();

    await appPage.keyboard.type(segundo);
    await appPage.keyboard.press("Enter");
    await expect(appPage.getByText(/Subtotal \(2 itens\)/)).toBeVisible();
  });

  test("VD-18: o mesmo produto bipado duas vezes soma quantidade", async ({
    appPage,
    apiClient,
  }) => {
    const [sku] = await skusReais(apiClient, 1);
    await abrirBusca(appPage);

    await appPage.keyboard.type(sku);
    await appPage.keyboard.press("Enter");
    await expect(appPage.getByText(/Subtotal \(1 item\)/)).toBeVisible();

    await appPage.keyboard.type(sku);
    await appPage.keyboard.press("Enter");

    // Continua um item — o que mudou foi a quantidade.
    await expect(appPage.getByText(/Subtotal \(1 item\)/)).toBeVisible();
    await expect(appPage.locator("input[name$='.quantity']").first()).toHaveValue(
      "2"
    );
  });

  test("VD-18: F2 abre a busca com foco e ESC fecha a lista", async ({
    appPage,
  }) => {
    await appPage.keyboard.press("F2");
    await expect(opcoes(appPage).first()).toBeVisible();
    await expect
      .poll(async () =>
        appPage.evaluate(
          () => document.activeElement?.getAttribute("placeholder") ?? null
        )
      )
      .toBe("Buscar...");

    await appPage.keyboard.press("Escape");
    await expect(opcoes(appPage)).toHaveCount(0);
  });

  test("a legenda de atalhos continua na tela", async ({ appPage }) => {
    // É o que torna o ganho de teclado descobrível (VD-18).
    const corpo = (await appPage.textContent("body")) ?? "";
    expect(corpo).toMatch(/F2/);
    expect(corpo).toMatch(/F9/);
  });
});
