import {
  test,
  expect,
  createCustomer,
  ensureOpenCashSession,
  ensureSellableProduct,
} from "./fixtures";

/**
 * Os cards "Total de Pedidos" e "Total Gasto" da ficha do cliente.
 *
 * A ficha lia `totalOrders`/`totalSpent` e o detalhe da API nunca os devolveu:
 * todo cliente aparecia com 0 pedidos e R$ 0,00. A listagem, por sua vez,
 * contava pedido cancelado na quantidade e não no valor. Aqui: duas vendas e um
 * pedido cancelado — contam as duas vendas, nas duas telas.
 */
test.describe("clientes: totais de pedidos e gasto", () => {
  test("CLI-02: a ficha e a listagem contam as vendas, não o cancelado", async ({
    apiClient,
    appPage,
  }) => {
    const { sessionId } = await ensureOpenCashSession(apiClient);
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);

    const methods = await apiClient.get("/payment-methods?limit=50");
    const cash = (
      (methods.body as { data?: { id: string; type: string }[] }).data ?? []
    ).find((m) => m.type === "CASH");
    expect(cash, "nenhuma forma de pagamento em dinheiro").toBeTruthy();

    for (const unitPrice of [100, 50.5]) {
      const sale = await apiClient.post("/orders", {
        customerId: customer.id,
        origin: "BALCAO",
        cashRegisterSessionId: sessionId,
        items: [{ productId: product.id, quantity: 1, unitPrice }],
        payments: [{ paymentMethodId: cash!.id, amount: unitPrice }],
      });
      expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    }

    // Um pedido que nasce e é cancelado não é venda.
    const cancelled = await apiClient.post("/orders", {
      customerId: customer.id,
      origin: "MANUAL",
      items: [{ productId: product.id, quantity: 1, unitPrice: 999 }],
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(201);
    const moved = await apiClient.patch(
      `/orders/${(cancelled.body as { data: { id: string } }).data.id}/status`,
      { status: "CANCELLED" }
    );
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    await appPage.goto(`/clientes/${customer.id}`);
    await expect(appPage.getByText("Total de Pedidos").locator("..")).toContainText("2");
    // 100 + 50,50 — e não 1.149,50 (com o cancelado) nem R$ 0,00.
    await expect(appPage.getByText("Total Gasto").locator("..")).toContainText("150,50");

    await appPage.goto("/clientes");
    await appPage
      .getByPlaceholder("Buscar por nome, e-mail ou documento...")
      .fill(customer.name);
    const row = appPage.getByRole("row").filter({ hasText: customer.name }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("150,50");
    // A coluna "Pedidos" também conta só as duas vendas (não três).
    await expect(row.getByRole("cell", { name: "2", exact: true })).toBeVisible();
  });
});
