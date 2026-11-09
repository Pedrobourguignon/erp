import {
  test,
  expect,
  createCustomer,
  ensureOpenCashSession,
  ensureSellableProduct,
  productAvailable,
  waitFor,
} from "./fixtures";

/**
 * Jornada: cancelamento e estorno.
 *
 * Cobre VD-01 (cancelar não estornava nada), VD-03 (troca em pedido cancelado)
 * e VD-14 (estorno de venda de balcão).
 */
test.describe("cancelamento e estorno", () => {
  test("VD-01: cancelar libera a reserva e cancela o recebível", async ({ apiClient }) => {
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
    const order = (created.body as { data: { id: string } }).data;

    await apiClient.patch(`/orders/${order.id}/status`, { status: "CONFIRMED" });

    // A reserva saiu do disponível.
    const reserved = await waitFor(
      () => productAvailable(apiClient, product.id),
      (value) => value === before - 1,
      { label: "reserva do pedido confirmado" }
    );
    expect(reserved).toBe(before - 1);

    const cancelled = await apiClient.patch(`/orders/${order.id}/cancel`, {
      reason: "Cancelamento pelo teste E2E",
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

    // O efeito colateral que o bug não fazia: a reserva volta.
    const released = await waitFor(
      () => productAvailable(apiClient, product.id),
      (value) => value === before,
      { label: "liberação da reserva após o cancelamento" }
    );
    expect(released, `saldo ${before} -> ${reserved} -> ${released}`).toBe(before);

    const detail = await apiClient.get(`/orders/${order.id}`);
    const data = (detail.body as {
      data: { status: string; receivables?: { status: string }[] };
    }).data;
    expect(data.status).toBe("CANCELLED");
    expect(
      (data.receivables ?? []).every((r) => r.status === "CANCELLED"),
      "sobrou recebível vivo em pedido cancelado"
    ).toBeTruthy();
  });

  test("VD-01: o cancelamento exige um motivo", async ({ apiClient }) => {
    await ensureOpenCashSession(apiClient);
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);

    const created = await apiClient.post("/orders", {
      customerId: customer.id,
      origin: "MANUAL",
      items: [{ productId: product.id, quantity: 1, unitPrice: 10 }],
    });
    const order = (created.body as { data: { id: string } }).data;

    const noReason = await apiClient.patch(`/orders/${order.id}/cancel`, {});
    expect(noReason.status).toBe(400);
  });

  test("VD-01: pedir CANCELLED pela rota de status também estorna", async ({
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
    const order = (created.body as { data: { id: string } }).data;
    await apiClient.patch(`/orders/${order.id}/status`, { status: "CONFIRMED" });

    // O caminho errado não foi bloqueado: foi eliminado. `updateStatus`
    // delega para `cancel()`, então nenhum chamador consegue mudar a coluna
    // sem liberar a reserva e cancelar o título — que era o bug.
    const viaStatus = await apiClient.patch(`/orders/${order.id}/status`, {
      status: "CANCELLED",
    });
    expect(viaStatus.status, JSON.stringify(viaStatus.body)).toBe(200);

    const released = await waitFor(
      () => productAvailable(apiClient, product.id),
      (value) => value === before,
      { label: "liberação da reserva pela rota de status" }
    );
    expect(released).toBe(before);

    const detail = await apiClient.get(`/orders/${order.id}`);
    const data = (detail.body as {
      data: { status: string; cancelReason?: string; receivables?: { status: string }[] };
    }).data;
    expect(data.status).toBe("CANCELLED");
    expect(data.cancelReason, "cancelamento sem motivo registrado").toBeTruthy();
    expect(
      (data.receivables ?? []).every((r) => r.status === "CANCELLED")
    ).toBeTruthy();
  });

  test("VD-14: estornar a venda de balcão devolve o estoque e gera contas a pagar", async ({
    apiClient,
  }) => {
    const { sessionId } = await ensureOpenCashSession(apiClient);
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);

    const methods = await apiClient.get("/payment-methods?limit=50");
    const cash = (
      (methods.body as { data?: { id: string; type: string }[] }).data ?? []
    ).find((m) => m.type === "CASH");

    const before = await productAvailable(apiClient, product.id);

    const created = await apiClient.post("/orders", {
      customerId: customer.id,
      origin: "BALCAO",
      cashRegisterSessionId: sessionId,
      items: [{ productId: product.id, quantity: 1, unitPrice: 89.9 }],
      payments: [{ paymentMethodId: cash!.id, amount: 89.9 }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const order = (created.body as { data: { id: string; orderNumber: string } }).data;

    const sold = await waitFor(
      () => productAvailable(apiClient, product.id),
      (value) => value === before - 1,
      { label: "baixa da venda de balcão" }
    );
    expect(sold).toBe(before - 1);

    const reversed = await apiClient.post(`/orders/${order.id}/reverse`, {
      reason: "Estorno pelo teste E2E",
    });
    expect(reversed.status, JSON.stringify(reversed.body)).toBeLessThan(300);

    const restored = await waitFor(
      () => productAvailable(apiClient, product.id),
      (value) => value === before,
      { label: "devolução do estoque no estorno" }
    );
    expect(restored).toBe(before);

    // O dinheiro já recebido vira conta a pagar — a devolução ao cliente.
    //
    // A busca percorre as páginas em vez de olhar só a primeira: a listagem é
    // ordenada por vencimento, não por criação, e o título do estorno nasce com
    // vencimento de hoje — no meio de centenas de outros. Pedir `limit=100` e
    // filtrar no cliente dava um "não gerou" que era só "não estava nas cem
    // primeiras", e apontava para o financeiro um defeito que não existia.
    const entries: { kind: string; description: string; amount: number }[] = [];
    for (let page = 1; page <= 20; page++) {
      const resposta = await apiClient.get(
        `/financial-entries?limit=100&page=${page}`
      );
      const body = resposta.body as {
        data?: { kind: string; description: string; amount: number }[];
        meta?: { hasMore?: boolean };
      };
      const lote = body.data ?? [];
      entries.push(
        ...lote.filter(
          (e) => e.kind === "PAYABLE" && e.description.includes(order.orderNumber)
        )
      );
      if (entries.length > 0 || !body.meta?.hasMore) {
        break;
      }
    }

    expect(entries.length, "o estorno não gerou a devolução em contas a pagar")
      .toBeGreaterThan(0);
    // O valor devolvido é o que o cliente pagou, não o total do pedido.
    expect(entries[0].amount).toBeCloseTo(89.9, 2);

    // E o estorno não é oferecido duas vezes.
    const twice = await apiClient.post(`/orders/${order.id}/reverse`, {
      reason: "Segundo estorno",
    });
    expect(twice.status).toBeGreaterThanOrEqual(400);
  });

  test("VD-03: pedido cancelado não aceita troca", async ({ apiClient }) => {
    await ensureOpenCashSession(apiClient);
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);

    const created = await apiClient.post("/orders", {
      customerId: customer.id,
      origin: "MANUAL",
      items: [{ productId: product.id, quantity: 1, unitPrice: 10 }],
    });
    const order = (created.body as { data: { id: string; items: { id: string }[] } }).data;

    await apiClient.patch(`/orders/${order.id}/cancel`, { reason: "Para o teste de troca" });

    // A rota antiga deste teste (`/items/:id/exchange`) não existia: o 404
    // satisfazia `>= 400` e o teste passava sem exercitar regra nenhuma.
    const exchange = await apiClient.post(`/orders/${order.id}/exchange`, {
      orderItemId: order.items[0].id,
      newProductId: product.id,
      quantity: 1,
      reason: "Troca em pedido cancelado",
    });
    expect(exchange.status).toBe(400);
    expect(JSON.stringify(exchange.body)).toMatch(/cancelado/);
  });
});
