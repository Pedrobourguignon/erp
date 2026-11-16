import { execFileSync } from "node:child_process";
import {
  test,
  expect,
  createCustomer,
  ensureOpenCashSession,
  ensureSellableProduct,
} from "./fixtures";

/**
 * TZ-01: venda à noite aparecia no dia seguinte em Financeiro > Lançamentos.
 *
 * `createdAt` é um instante UTC; depois das 21h em Brasília o dia UTC já é o
 * seguinte. A tela lia o dia pelos componentes UTC e mostrava "amanhã".
 * O horário da movimentação é ajustado direto no banco para simular a venda
 * às 22h sem depender do relógio da máquina.
 */
function sql(query: string): string {
  return execFileSync(
    "docker",
    ["exec", "erp-postgres", "psql", "-U", "erp_user", "-d", "erp", "-tA", "-c", query],
    { encoding: "utf8" }
  ).trim();
}

test.describe("financeiro: data de venda feita à noite", () => {
  test("TZ-01: venda PIX às 22h de Brasília aparece no mesmo dia", async ({
    apiClient,
    appPage,
  }) => {
    const { sessionId } = await ensureOpenCashSession(apiClient);
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);

    const methods = await apiClient.get("/payment-methods?limit=50");
    const pix = (
      (methods.body as { data?: { id: string; type: string }[] }).data ?? []
    ).find((m) => m.type === "PIX");
    expect(pix, "nenhuma forma de pagamento PIX").toBeTruthy();

    const created = await apiClient.post("/orders", {
      customerId: customer.id,
      origin: "BALCAO",
      cashRegisterSessionId: sessionId,
      items: [{ productId: product.id, quantity: 1, unitPrice: 37.77 }],
      payments: [{ paymentMethodId: pix!.id, amount: 37.77 }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const order = (created.body as { data: { id: string; orderNumber: string } }).data;

    // 22:00 BRT de 11/11/2026 = 01:00 UTC de 12/11/2026.
    const updated = sql(
      `update financial_transactions set "createdAt" = '2026-11-12T01:00:00Z'
       where description like '%${order.orderNumber}%' returning id`
    );
    expect(updated, "a venda não gerou movimentação na conta").not.toBe("");

    await appPage.goto("/financeiro/lancamentos");
    await appPage.getByLabel("De", { exact: true }).fill("2026-11-11");
    await appPage.getByLabel("Até", { exact: true }).fill("2026-11-11");

    const row = appPage.getByRole("row").filter({ hasText: order.orderNumber }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("11/11/2026");
    await expect(row).not.toContainText("12/11/2026");
  });
});
