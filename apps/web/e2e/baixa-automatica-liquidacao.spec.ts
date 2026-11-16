import {
  test,
  expect,
  createCustomer,
  ensureOpenCashSession,
  ensureSellableProduct,
  stamp,
} from "./fixtures";

/**
 * Prazo de liquidação combinado com a operadora (inclusive o antecipado).
 *
 * O lojista põe, na forma de pagamento, em quantos dias a operadora paga. A venda
 * tem que nascer com o dinheiro nesse dia — e isso se confere em Financeiro, que é
 * a outra tela, não no toast da configuração. A taxa segue a do cadastro.
 */
const TZ = "America/Sao_Paulo";

function dayKey(daysFromToday: number): { iso: string; br: string } {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + daysFromToday);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
  const [y, m, d] = parts.split("-");
  return { iso: parts, br: `${d}/${m}/${y}` };
}

test.describe("financeiro: liquidação no prazo combinado", () => {
  test("a venda no cartão cai no dia de liquidação cadastrado", async ({
    apiClient,
    appPage,
  }) => {
    const { sessionId } = await ensureOpenCashSession(apiClient);
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);

    const accounts = await apiClient.get("/financial-accounts?limit=5");
    const account = ((accounts.body as { data: { id: string }[] }).data ?? [])[0];
    expect(account, "nenhuma conta financeira").toBeTruthy();

    const name = `Cartão liquida em 2 dias ${stamp()}`;
    const created = await apiClient.post("/payment-methods", {
      name,
      type: "CREDIT_CARD",
      defaultAccountId: account.id,
      feePercentage: 3,
      settlementDays: 30,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const method = (created.body as { data: { id: string } }).data;

    // O prazo é cadastrado pela tela.
    await appPage.goto("/configuracoes/metodos-pagamento");
    await appPage.getByPlaceholder("Buscar por nome...").fill(name);
    await appPage.getByRole("button", { name: `Editar ${name}` }).click();
    await appPage.getByLabel("Liquidação (dias)").fill("2");
    await appPage.getByLabel("Dar baixa automática no dia da liquidação").check();
    await appPage.getByRole("button", { name: "Salvar" }).click();
    await expect(appPage.getByRole("dialog")).toBeHidden();

    const saved = await apiClient.get(`/payment-methods/${method.id}`);
    expect((saved.body as { data: { settlementDays: number; autoSettle: boolean } }).data).toMatchObject({
      settlementDays: 2,
      autoSettle: true,
    });

    // A venda de R$ 200 em 1x nasce com o dinheiro daqui a 2 dias, não 30 (o prazo antigo do cadastro).
    const sold = await apiClient.post("/orders", {
      customerId: customer.id,
      origin: "BALCAO",
      cashRegisterSessionId: sessionId,
      items: [{ productId: product.id, quantity: 1, unitPrice: 200 }],
      payments: [{ paymentMethodId: method.id, amount: 200 }],
    });
    expect(sold.status, JSON.stringify(sold.body)).toBe(201);
    const order = (sold.body as { data: { orderNumber: string } }).data;

    const due = dayKey(2);
    await appPage.goto("/financeiro/lancamentos");
    await appPage.getByLabel("De", { exact: true }).fill(due.iso);
    await appPage.getByLabel("Até", { exact: true }).fill(due.iso);

    const receivable = appPage
      .getByRole("row")
      .filter({ hasText: `${order.orderNumber} - ${name}` })
      .first();
    await expect(receivable).toBeVisible();
    await expect(receivable).toContainText(due.br);

    // A taxa da operadora (3% de R$ 200) vence no mesmo dia: R$ 6,00.
    const fee = appPage
      .getByRole("row")
      .filter({ hasText: `Taxa ${name} - ${order.orderNumber}` })
      .first();
    await expect(fee).toBeVisible();
    await expect(fee).toContainText(due.br);
    await expect(fee).toContainText("6,00");
  });
});
