import {
  test,
  expect,
  ensureOpenCashSession,
  stamp,
  waitFor,
  type ApiClient,
} from "./fixtures";

/**
 * Sangria e suprimento são transferências entre a gaveta e outra conta.
 *
 * Antes a sangria só debitava a gaveta e o suprimento só a creditava: o
 * dinheiro sumia ou nascia do nada, e o patrimônio da empresa mudava sem venda
 * nem despesa que explicasse. As jornadas operam pela tela do caixa e conferem
 * o efeito onde ele tem que aparecer: no saldo da outra conta, em
 * /financeiro/contas, e na soma das duas contas, que não muda.
 */

const round = (n: number) => Math.round(n * 100) / 100;

async function accountBalance(client: ApiClient, accountId: string): Promise<number> {
  const response = await client.get(`/financial-accounts/${accountId}`);
  return Number((response.body as { data?: { balance?: number } }).data?.balance ?? 0);
}

async function createAccount(
  client: ApiClient,
  prefix: string,
  type: "CASH" | "CHECKING"
): Promise<{ id: string; name: string }> {
  const name = `${prefix} ${stamp()}`;
  const created = await client.post("/financial-accounts", { name, type });
  expect(created.status, `criação de "${name}": ${JSON.stringify(created.body)}`).toBe(201);
  return { id: (created.body as { data: { id: string } }).data.id, name };
}

async function registerOf(client: ApiClient, cashRegisterId: string) {
  const response = await client.get("/cash-registers?limit=50");
  const register = (
    (response.body as { data?: { id: string; name: string; financialAccountId: string }[] }).data ?? []
  ).find((r) => r.id === cashRegisterId);
  expect(register, "caixa da sessão aberta não encontrado").toBeTruthy();
  return register!;
}

/** Põe dinheiro na gaveta vindo de um banco (que pode ficar negativo), sem depender das vendas da suíte. */
async function fundDrawer(client: ApiClient, cashRegisterId: string, amount: number) {
  const bank = await createAccount(client, "Banco E2E", "CHECKING");
  const supply = await client.post(`/cash-registers/${cashRegisterId}/supply`, {
    amount,
    reason: "e2e: dinheiro para a jornada",
    sourceAccountId: bank.id,
  });
  expect(supply.status, JSON.stringify(supply.body)).toBe(201);
}

test.describe("caixa — sangria e suprimento", () => {
  test("SANGRIA-01: a sangria pela tela sai da gaveta e entra no cofre", async ({
    apiClient,
    appPage,
  }) => {
    const { cashRegisterId } = await ensureOpenCashSession(apiClient);
    const register = await registerOf(apiClient, cashRegisterId);
    const vault = await createAccount(apiClient, "Cofre E2E", "CASH");
    await fundDrawer(apiClient, cashRegisterId, 37.5);
    const drawerBefore = await accountBalance(apiClient, register.financialAccountId);

    await appPage.goto("/financeiro/caixa");
    await appPage.getByRole("button", { name: `Sangria - ${register.name}` }).click();
    const dialog = appPage.getByRole("dialog");
    await dialog.getByPlaceholder("0,00").fill("3750");
    await dialog.getByRole("combobox", { name: /Para onde vai o dinheiro/ }).click();
    await appPage.getByRole("option", { name: vault.name }).click();
    await dialog.getByLabel(/Motivo/).fill("e2e: excesso na gaveta");
    await dialog.getByRole("button", { name: "Confirmar sangria" }).click();
    await expect(dialog).toBeHidden();

    await waitFor(() => accountBalance(apiClient, vault.id), (b) => b === 37.5, { label: "saldo do cofre" });
    expect(await accountBalance(apiClient, register.financialAccountId)).toBe(round(drawerBefore - 37.5));

    await appPage.goto("/financeiro/contas");
    await expect(appPage.getByRole("row").filter({ hasText: vault.name })).toContainText("R$ 37,50");
  });

  test("SUPRIMENTO-01: o suprimento pela tela sai do cofre e entra na gaveta", async ({
    apiClient,
    appPage,
  }) => {
    const { cashRegisterId } = await ensureOpenCashSession(apiClient);
    const register = await registerOf(apiClient, cashRegisterId);
    const vault = await createAccount(apiClient, "Cofre E2E", "CASH");

    // Enche o cofre pelo caminho legítimo: sangria da gaveta para ele.
    await fundDrawer(apiClient, cashRegisterId, 60);
    const toVault = await apiClient.post(`/cash-registers/${cashRegisterId}/withdraw`, {
      amount: 60,
      reason: "e2e: guardar no cofre",
      destinationAccountId: vault.id,
    });
    expect(toVault.status, JSON.stringify(toVault.body)).toBe(201);
    const drawerBefore = await accountBalance(apiClient, register.financialAccountId);

    await appPage.goto("/financeiro/caixa");
    await appPage.getByRole("button", { name: `Suprimento - ${register.name}` }).click();
    const dialog = appPage.getByRole("dialog");
    await dialog.getByPlaceholder("0,00").fill("2500");
    await dialog.getByRole("combobox", { name: /De onde vem o dinheiro/ }).click();
    await appPage.getByRole("option", { name: vault.name }).click();
    await dialog.getByLabel(/Motivo/).fill("e2e: troco");
    await dialog.getByRole("button", { name: "Confirmar suprimento" }).click();
    await expect(dialog).toBeHidden();

    await waitFor(() => accountBalance(apiClient, vault.id), (b) => b === 35, { label: "saldo do cofre" });
    expect(await accountBalance(apiClient, register.financialAccountId)).toBe(round(drawerBefore + 25));

    await appPage.goto("/financeiro/contas");
    await expect(appPage.getByRole("row").filter({ hasText: vault.name })).toContainText("R$ 35,00");
  });

  test("SUPRIMENTO-02: o cofre não empresta o que não tem", async ({ apiClient }) => {
    const { cashRegisterId } = await ensureOpenCashSession(apiClient);
    const register = await registerOf(apiClient, cashRegisterId);
    const vault = await createAccount(apiClient, "Cofre E2E", "CASH");
    const drawerBefore = await accountBalance(apiClient, register.financialAccountId);

    const supply = await apiClient.post(`/cash-registers/${cashRegisterId}/supply`, {
      amount: 10,
      reason: "e2e: cofre vazio",
      sourceAccountId: vault.id,
    });

    expect(supply.status).toBe(400);
    expect(String((supply.body as { message?: string }).message)).toMatch(/Saldo insuficiente/);
    expect(await accountBalance(apiClient, vault.id)).toBe(0);
    expect(await accountBalance(apiClient, register.financialAccountId)).toBe(drawerBefore);
  });

  test("ABERTURA-01: o fundo de troco que falta na abertura sai do cofre", async ({
    apiClient,
    appPage,
  }) => {
    // Um caixa só desta jornada, com gaveta e cofre próprios.
    const drawer = await createAccount(apiClient, "Gaveta E2E", "CASH");
    const vault = await createAccount(apiClient, "Cofre E2E", "CASH");
    const name = `Caixa E2E ${stamp()}`;
    const created = await apiClient.post("/cash-registers", {
      name,
      financialAccountId: drawer.id,
      vaultAccountId: vault.id,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const registerId = (created.body as { data: { id: string } }).data.id;

    // Abastece o cofre pelo caminho legítimo: sangria do caixa principal para ele.
    const { cashRegisterId } = await ensureOpenCashSession(apiClient);
    await fundDrawer(apiClient, cashRegisterId, 80);
    const toVault = await apiClient.post(`/cash-registers/${cashRegisterId}/withdraw`, {
      amount: 80,
      reason: "e2e: fundo para a abertura",
      destinationAccountId: vault.id,
    });
    expect(toVault.status, JSON.stringify(toVault.body)).toBe(201);

    try {
      await appPage.goto("/financeiro/caixa");
      await appPage.getByRole("button", { name: `Abrir Caixa - ${name}` }).click();
      const dialog = appPage.getByRole("dialog");
      await dialog.getByLabel(/Saldo de abertura/).fill("8000");
      await expect(dialog.getByRole("combobox", { name: /De onde vem o dinheiro/ })).toContainText(vault.name);
      await dialog.getByRole("button", { name: "Abrir" }).click();
      await expect(dialog).toBeHidden();

      await waitFor(() => accountBalance(apiClient, drawer.id), (b) => b === 80, { label: "saldo da gaveta nova" });
      expect(await accountBalance(apiClient, vault.id)).toBe(0);

      await appPage.goto("/financeiro/contas");
      await expect(appPage.getByRole("row").filter({ hasText: drawer.name })).toContainText("R$ 80,00");
    } finally {
      // Dois caixas abertos tornam a venda ambígua (FN-05) para as outras jornadas.
      await apiClient.post(`/cash-registers/${registerId}/close`, { closingBalance: 80 });
    }
  });

  test("CAIXA-TRANSF-01: a API recusa sangria e suprimento sem a outra conta", async ({ apiClient }) => {
    const { cashRegisterId } = await ensureOpenCashSession(apiClient);
    const register = await registerOf(apiClient, cashRegisterId);
    const drawerBefore = await accountBalance(apiClient, register.financialAccountId);

    // O caixa da suíte não tem cofre configurado: sem a conta, nada se move.
    const withdraw = await apiClient.post(`/cash-registers/${cashRegisterId}/withdraw`, {
      amount: 1,
      reason: "e2e: sangria sem destino",
    });
    const supply = await apiClient.post(`/cash-registers/${cashRegisterId}/supply`, {
      amount: 1,
      reason: "e2e: suprimento sem origem",
    });

    expect(withdraw.status).toBe(400);
    expect(String((withdraw.body as { message?: string }).message)).toMatch(/conta de destino/);
    expect(supply.status).toBe(400);
    expect(String((supply.body as { message?: string }).message)).toMatch(/conta de origem/);
    expect(await accountBalance(apiClient, register.financialAccountId)).toBe(drawerBefore);
  });
});
