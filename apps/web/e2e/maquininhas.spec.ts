import type { Page } from "@playwright/test";

import {
  test,
  expect,
  createCustomer,
  ensureOpenCashSession,
  ensureSellableProduct,
  stamp,
  waitFor,
} from "./fixtures";

/**
 * Maquininhas: as taxas e os prazos do cartão saem da forma de pagamento e
 * passam a morar na maquininha. O que se confere é o efeito em outra tela —
 * os títulos e as taxas no Financeiro —, não o toast do cadastro.
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

type Receivable = { amount: string; installment: number; totalInstallments: number };

/** The table row with `text`, paging forward through the list until it shows up. */
async function findRow(page: Page, text: string) {
  const row = page.getByRole("row").filter({ hasText: text }).first();
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await row.isVisible()) {return row;}
    const next = page.getByRole("button", { name: "Próxima página" });
    if (!(await next.isVisible()) || !(await next.isEnabled())) {break;}
    await next.click();
    await page.waitForLoadState("networkidle");
  }
  await expect(row).toBeVisible();
  return row;
}

test.describe("maquininhas", () => {
  test("cadastrar pela tela, vincular ao crédito e vender 3x gera 3 títulos e 3 taxas", async ({
    apiClient,
    appPage,
  }) => {
    const suffix = stamp();
    const machineName = `Stone E2E ${suffix}`;
    const methodName = `Crédito Stone E2E ${suffix}`;

    // 1. A maquininha, pela tela: débito 1,5% em D+1; crédito parcela a
    //    parcela, 1x 3,19% e 2x–3x 4,99% preenchidos pela faixa.
    await appPage.goto("/configuracoes/maquininhas");
    await appPage.getByRole("button", { name: "Nova maquininha" }).click();
    const machineDialog = appPage.getByRole("dialog");
    await machineDialog.getByLabel("Nome *").fill(machineName);
    await machineDialog.getByLabel("Operadora").fill("Stone");
    await machineDialog.getByLabel("Taxa (%)", { exact: true }).fill("1.5");
    await machineDialog.getByLabel("Cai em (dias)").fill("1");
    await machineDialog.getByLabel("Parcela em até").fill("3");
    await machineDialog.getByLabel("À vista (1x)").fill("3.19");
    await machineDialog.getByLabel("De", { exact: true }).fill("2");
    await machineDialog.getByLabel("Até", { exact: true }).fill("3");
    await machineDialog.locator("#rate-range-fee").fill("4,99");
    await machineDialog.getByRole("button", { name: "Aplicar" }).click();
    await expect(machineDialog.getByLabel("3x")).toHaveValue("4.99");
    await machineDialog.getByRole("button", { name: "Cadastrar" }).click();
    await expect(machineDialog).toBeHidden();

    const row = appPage.getByRole("row").filter({ hasText: machineName });
    await expect(row).toContainText("1x 3,19% · 2–3x 4,99%");
    await expect(row).toContainText("Parcela a parcela · 1º repasse em 30 dias");

    // 2. A forma de pagamento de crédito só aponta para a maquininha.
    await appPage.goto("/configuracoes/metodos-pagamento");
    await appPage.getByRole("button", { name: "Novo Método" }).click();
    const methodDialog = appPage.getByRole("dialog");
    await methodDialog.getByPlaceholder("Ex: Cartao Visa").fill(methodName);
    await methodDialog.getByRole("combobox").first().click();
    await appPage.getByRole("option", { name: "Cartão de Crédito", exact: true }).click();
    // No cartão, taxa e liquidação não aparecem mais.
    await expect(methodDialog.getByText("Liquidação (dias)")).toBeHidden();
    await methodDialog.getByRole("combobox", { name: "Maquininha *" }).click();
    await appPage.getByRole("option", { name: machineName }).click();
    await expect(methodDialog.getByText("1x 3,19% · 2–3x 4,99%")).toBeVisible();
    await methodDialog.getByRole("button", { name: "Criar" }).click();
    await expect(methodDialog).toBeHidden();

    const methods = await apiClient.get(`/payment-methods?search=${encodeURIComponent(methodName)}`);
    const method = ((methods.body as { data: { id: string; maxInstallments: number }[] }).data ?? [])[0];
    expect(method, "a forma de pagamento não foi criada").toBeTruthy();
    // O máximo de parcelas veio da tabela da maquininha.
    expect(method.maxInstallments).toBe(3);

    // 3. Venda de R$ 300 em 3x.
    const { sessionId } = await ensureOpenCashSession(apiClient);
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);
    const sold = await apiClient.post("/orders", {
      customerId: customer.id,
      origin: "BALCAO",
      cashRegisterSessionId: sessionId,
      items: [{ productId: product.id, quantity: 1, unitPrice: 300 }],
      payments: [{ paymentMethodId: method.id, installments: 3, amount: 300 }],
    });
    expect(sold.status, JSON.stringify(sold.body)).toBe(201);
    const order = (sold.body as { data: { id: string; orderNumber: string } }).data;

    // 3 títulos de R$ 100, numerados 1/3, 2/3, 3/3.
    const receivables = await waitFor(
      async () => {
        const detail = await apiClient.get(`/orders/${order.id}`);
        return (detail.body as { data: { receivables?: Receivable[] } }).data.receivables ?? [];
      },
      (rows) => rows.length === 3,
      { label: "títulos da venda 3x" }
    );
    expect(receivables.map((r) => Number(r.amount))).toEqual([100, 100, 100]);
    expect(receivables.every((r) => r.totalInstallments === 3)).toBeTruthy();

    // 4. No Financeiro: o 1º título vence em 30 dias e a taxa dele (4,99% de
    //    R$ 300 = R$ 14,97, um terço por parcela) vence no mesmo dia.
    const due = dayKey(30);
    const openDay = async () => {
      await appPage.goto("/financeiro/lancamentos");
      await appPage.getByLabel("De", { exact: true }).fill(due.iso);
      await appPage.getByLabel("Até", { exact: true }).fill(due.iso);
      await appPage.waitForLoadState("networkidle");
    };
    await openDay();

    // As rodadas da suíte acumulam títulos no mesmo vencimento: o desta venda
    // pode estar numa página adiante.
    const first = await findRow(appPage, `${order.orderNumber} - ${methodName} (1/3)`);
    await expect(first).toContainText(due.br);

    await openDay();
    const fee = await findRow(appPage, `Taxa ${methodName} - ${order.orderNumber} (1/3)`);
    await expect(fee).toContainText("4,99");
  });

  test("o cartão sem maquininha é recusado", async ({ apiClient }) => {
    const response = await apiClient.post("/payment-methods", {
      name: `Crédito sem maquininha ${stamp()}`,
      type: "CREDIT_CARD",
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("Escolha a maquininha");
  });

  test("a tabela de taxas com buraco é recusada", async ({ apiClient }) => {
    const response = await apiClient.post("/card-machines", {
      name: `Maquininha com buraco ${stamp()}`,
      rates: [
        { installments: 1, feePercentage: 3 },
        { installments: 3, feePercentage: 5 },
      ],
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain("Falta a taxa de 2x");
  });
});
