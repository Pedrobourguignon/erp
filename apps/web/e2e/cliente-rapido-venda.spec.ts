import { test, expect, ensureOpenCashSession, stamp } from "./fixtures";

/**
 * Cadastro de cliente dentro da venda.
 *
 * Quem chega à loja nem sempre está cadastrado. O modal cria o cliente sem tirar
 * o operador da venda — sem CPF e sem e-mail, que são opcionais — e o deixa
 * escolhido no campo. O efeito do outro lado se confere na ficha do cliente.
 */
const TELAS = [
  { nome: "balcão", rota: "/vendas/balcao" },
  { nome: "pedido", rota: "/vendas/pedidos/novo" },
];

for (const tela of TELAS) {
  test(`o modal cadastra o cliente na tela de ${tela.nome} sem CPF nem e-mail`, async ({
    apiClient,
    appPage,
  }) => {
    await ensureOpenCashSession(apiClient);
    const nome = `Cliente rápido ${stamp()}`;

    await appPage.goto(tela.rota);
    await appPage.getByRole("button", { name: "Novo cliente" }).click();

    const modal = appPage.getByRole("dialog", { name: "Novo cliente" });
    await expect(modal).toBeVisible();
    await modal.getByPlaceholder("Nome completo").fill(nome);
    await modal.getByPlaceholder("(00) 00000-0000").fill("11987654321");
    await modal.getByLabel("Data de nascimento").fill("1990-05-20");
    await modal.getByRole("button", { name: "Salvar Cliente" }).click();

    // O cliente criado já fica escolhido no campo, sem precisar buscá-lo.
    await expect(modal).toBeHidden();
    await expect(appPage.getByRole("button", { name: new RegExp(nome) })).toBeVisible();
    // Salvar o cliente não pode ter enviado a venda.
    await expect(appPage).toHaveURL(new RegExp(`${tela.rota}$`));

    // Do outro lado: o cliente existe, sem documento e sem e-mail.
    const found = await apiClient.get(`/customers?search=${encodeURIComponent(nome)}&limit=5`);
    const customer = (
      found.body as { data: { id: string; document: string | null; email: string | null }[] }
    ).data[0];
    expect(customer, "o cliente não foi criado").toBeTruthy();
    expect(customer.document).toBeNull();
    expect(customer.email).toBeNull();

    await appPage.goto(`/clientes/${customer.id}`);
    await expect(appPage.getByText("Nascimento: 20/05/1990")).toBeVisible();
    await expect(appPage.getByText("Documento não informado")).toBeVisible();
  });
}

test("o modal recusa data de nascimento no futuro e mantém o modal aberto", async ({
  apiClient,
  appPage,
}) => {
  await ensureOpenCashSession(apiClient);
  await appPage.goto("/vendas/balcao");
  await appPage.getByRole("button", { name: "Novo cliente" }).click();

  const modal = appPage.getByRole("dialog", { name: "Novo cliente" });
  await modal.getByPlaceholder("Nome completo").fill(`Cliente futuro ${stamp()}`);
  await modal.getByPlaceholder("(00) 00000-0000").fill("11987654321");
  await modal.getByLabel("Data de nascimento").fill("2999-01-01");
  await modal.getByRole("button", { name: "Salvar Cliente" }).click();

  await expect(modal.getByText("A data de nascimento não pode ser no futuro")).toBeVisible();
  await expect(modal).toBeVisible();
});

test("a listagem de clientes não chama de 'Pessoa Jurídica' quem não tem documento", async ({
  apiClient,
  appPage,
}) => {
  const nome = `Cliente sem doc ${stamp()}`;
  const created = await apiClient.post("/customers", { name: nome, phone: "11987654321" });
  expect(created.status, JSON.stringify(created.body)).toBe(201);

  await appPage.goto("/clientes");
  await appPage.getByPlaceholder("Buscar por nome, e-mail ou documento...").fill(nome);

  const row = appPage.getByRole("row").filter({ hasText: nome }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Sem documento");
  await expect(row).not.toContainText("Pessoa Jurídica");
  await expect(row).not.toContainText("Pessoa Física");
});
