import { test, expect, makeEan13, stamp, type ApiClient } from "./fixtures";

/**
 * EAN único por empresa: o leitor do balcão procura o código por igualdade, e
 * dois cadastros no mesmo código travam a leitura ("está em mais de um
 * produto"). Todo caminho que grava EAN recusa o repetido; os que já existiam
 * aparecem na lista de produtos para o lojista corrigir.
 */

async function createProduct(client: ApiClient, body: Record<string, unknown>) {
  const suffix = stamp();
  return client.post("/products", {
    name: `E2E EAN ${suffix}`,
    sku: `E2E-EAN-${suffix}`,
    status: "ACTIVE",
    costPrice: 10,
    salePrice: 20,
    ...body,
  });
}

test.describe("EAN único por empresa", () => {
  test("EU-01: o segundo produto com o mesmo EAN é recusado, dizendo quem já usa o código", async ({
    apiClient,
  }) => {
    const ean = makeEan13();
    const first = await createProduct(apiClient, { ean });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const owner = (first.body as { data: { name: string; sku: string } }).data;

    const second = await createProduct(apiClient, { ean });

    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain(`O código ${ean} já está em ${owner.name} (${owner.sku})`);
  });

  test("EU-02: o EAN de um tamanho também conta, e o leitor continua achando um dono só", async ({
    apiClient,
  }) => {
    const ean = makeEan13();
    const shirt = await createProduct(apiClient, {
      variants: [{ sku: `E2E-EAN-V-${stamp()}`, name: "M", ean, attributes: { tamanho: "M" } }],
    });
    expect(shirt.status, JSON.stringify(shirt.body)).toBe(201);

    const clash = await createProduct(apiClient, { ean });
    expect(clash.status).toBe(409);
    expect(JSON.stringify(clash.body)).toMatch(/já está em .* — M/);

    const read = await apiClient.get(`/products/lookup?code=${ean}`);
    expect((read.body as { data: { kind: string } }).data.kind).toBe("MATCH");
  });

  test("EU-03: a lista de produtos mostra os códigos repetidos, com link para corrigir cada cadastro", async ({
    appPage,
  }) => {
    // Os caminhos de cadastro já não deixam criar um repetido; os que vêm de
    // antes desta regra são simulados na resposta da API.
    await appPage.route("**/products/barcode-duplicates", (route) =>
      route.fulfill({
        json: {
          success: true,
          data: [
            {
              ean: "7891234567895",
              owners: [
                { productId: "prod-a", variantId: null, name: "Boné Preto", sku: "BON-01" },
                { productId: "prod-b", variantId: "var-b", name: "Camiseta — M", sku: "CAM-M" },
              ],
            },
          ],
        },
      })
    );

    await appPage.goto("/estoque/produtos");
    await expect(appPage.getByText("1 código de barras repetido")).toBeVisible();
    await appPage.getByRole("button", { name: "Ver códigos repetidos" }).click();

    await expect(appPage.getByText("7891234567895")).toBeVisible();
    await expect(appPage.getByRole("link", { name: "Boné Preto" })).toHaveAttribute("href", "/estoque/produtos/prod-a");
    await expect(appPage.getByRole("link", { name: "Camiseta — M" })).toHaveAttribute("href", "/estoque/produtos/prod-b");
  });

  test("EU-04: sem repetidos, a lista de produtos não mostra aviso nenhum", async ({ appPage }) => {
    await appPage.route("**/products/barcode-duplicates", (route) =>
      route.fulfill({ json: { success: true, data: [] } })
    );

    await appPage.goto("/estoque/produtos");
    await expect(appPage.getByRole("heading", { name: "Produtos" })).toBeVisible();
    await expect(appPage.getByText(/código.* de barras repetido/)).toHaveCount(0);
  });
});
