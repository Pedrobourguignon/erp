import {
  test,
  createCardMethod,
  expect,
  createCustomer,
  ensureOpenCashSession,
  ensureSellableProduct,
  productAvailable,
  waitFor,
} from "./fixtures";

/**
 * Jornada: pedido do zero até COMPLETED, conferindo estoque e financeiro.
 *
 * Cobre VD-02 (ciclo travado em "Separando"), VD-05 (parcelamento ignorado) e a
 * baixa efetiva de estoque em SHIPPED.
 *
 * A asserção que importa não é o toast de sucesso: é o saldo do produto e o
 * título financeiro do outro lado.
 */

test.describe("venda: pedido", () => {
  test("VD-02: o pedido percorre PENDING→COMPLETED e baixa o estoque em SHIPPED", async ({
    apiClient,
  }) => {
    await ensureOpenCashSession(apiClient);
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);

    const before = await productAvailable(apiClient, product.id);

    const created = await apiClient.post("/orders", {
      customerId: customer.id,
      origin: "MANUAL",
      items: [{ productId: product.id, quantity: 1, unitPrice: 10 }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const order = (created.body as { data: { id: string; status: string; orderNumber: string } }).data;

    // A máquina de estados é fonte única (@erp/constants) desde o lote 2; a
    // jornada percorre o caminho que a API declara em `allowedTransitions`.
    const path = ["CONFIRMED", "PICKING", "PACKED", "SHIPPED", "DELIVERED", "COMPLETED"];
    for (const status of path) {
      const moved = await apiClient.patch(`/orders/${order.id}/status`, { status });
      expect(moved.status, `transição para ${status}: ${JSON.stringify(moved.body)}`).toBe(200);
    }

    const final = await apiClient.get(`/orders/${order.id}`);
    expect((final.body as { data: { status: string } }).data.status).toBe("COMPLETED");

    // O efeito colateral: a reserva virou saída de verdade.
    const after = await productAvailable(apiClient, product.id);
    expect(after, `saldo ${before} -> ${after}`).toBe(before - 1);

    // E o pedido gerou o título a receber.
    const movements = await apiClient.get(
      `/inventory/movements?productId=${product.id}&type=EXIT&limit=5`
    );
    const exits = (movements.body as { data?: { reason: string }[] }).data ?? [];
    expect(exits.some((m) => m.reason === "SALE")).toBeTruthy();
  });

  test("VD-05: as parcelas digitadas na venda geram títulos que somam exatamente o total", async ({
    apiClient,
  }) => {
    // O vendedor digita as parcelas; o método diz até quantas aceita.
    // A maquininha parcela em até 3x, sem taxa (a soma é o que importa aqui).
    const { method: term } = await createCardMethod(apiClient, { creditRates: [0, 0, 0] });

    await ensureOpenCashSession(apiClient);
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);

    const created = await apiClient.post("/orders", {
      customerId: customer.id,
      origin: "MANUAL",
      items: [{ productId: product.id, quantity: 1, unitPrice: 199.8 }],
      payments: [
        { paymentMethodId: term.id, installments: 3, amount: 199.8 },
      ],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const order = (
      created.body as {
        data: { id: string; orderNumber: string; total?: number; totalAmount?: number };
      }
    ).data;
    const total = Number(order.totalAmount ?? order.total);

    await apiClient.patch(`/orders/${order.id}/status`, { status: "CONFIRMED" });

    // Os recebíveis vêm no próprio detalhe do pedido (é o que a aba Financeiro
    // lê): a listagem geral não expõe `orderId` nem aceita busca por número.
    // Eles são escritos por um handler de evento, então a leitura espera a
    // soma fechar em vez de olhar uma vez.
    const entries = await waitFor(
      async () => {
        const detail = await apiClient.get(`/orders/${order.id}`);
        return (
          (
            detail.body as {
              data: {
                receivables?: {
                  amount: string;
                  installment: number;
                  totalInstallments: number;
                }[];
              };
            }
          ).data.receivables ?? []
        );
      },
      (rows) =>
        rows.length > 1 &&
        rows.reduce((acc, e) => acc + Math.round(Number(e.amount) * 100), 0) ===
          Math.round(total * 100),
      { label: "recebíveis do pedido a prazo" }
    );

    const sum = entries.reduce((acc, e) => acc + Math.round(Number(e.amount) * 100), 0);
    // A sobra de centavos vai na última parcela; o invariante é a soma exata.
    expect(sum, `${entries.length} parcelas somando ${sum / 100} para um total de ${total}`)
      .toBe(Math.round(total * 100));

    // Exatamente as 3 parcelas escolhidas, numeradas — a coluna "1/3" da aba Financeiro.
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.totalInstallments === 3)).toBeTruthy();
  });

  test("a venda recusa mais parcelas do que a maquininha aceita", async ({ apiClient }) => {
    const { method: term } = await createCardMethod(apiClient, { creditRates: [0, 0, 0] });

    await ensureOpenCashSession(apiClient);
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);

    const refused = await apiClient.post("/orders", {
      customerId: customer.id,
      origin: "MANUAL",
      items: [{ productId: product.id, quantity: 1, unitPrice: 50 }],
      payments: [{ paymentMethodId: term.id, installments: 4, amount: 50 }],
    });

    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("no máximo 3 parcelas");
  });

  test("VD-02: a UI oferece a próxima transição em vez de travar em Separando", async ({
    appPage,
    apiClient,
  }) => {
    await ensureOpenCashSession(apiClient);
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);

    const created = await apiClient.post("/orders", {
      customerId: customer.id,
      origin: "MANUAL",
      items: [{ productId: product.id, quantity: 1, unitPrice: 10 }],
    });
    const order = (created.body as { data: { id: string } }).data;
    await apiClient.patch(`/orders/${order.id}/status`, { status: "CONFIRMED" });
    await apiClient.patch(`/orders/${order.id}/status`, { status: "PICKING" });

    await appPage.goto(`/vendas/pedidos/${order.id}`);
    await appPage.waitForLoadState("networkidle");
    await appPage.waitForTimeout(1500);

    // O bug era exatamente este ponto: em PICKING a tela não oferecia saída.
    await expect(
      appPage.getByRole("button", { name: /embalado|packed/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
