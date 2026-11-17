import type { Page } from "@playwright/test";

import {
  test,
  expect,
  createCustomer,
  ensureOpenCashSession,
  ensureSellableProduct,
  stamp,
  waitFor,
  type ApiClient,
} from "./fixtures";

/**
 * Recibo do cliente (não fiscal).
 *
 * O recibo sai de um iframe oculto pelo diálogo de impressão do navegador. Aqui o
 * `print()` do iframe é trocado por um registro do que estava no papel, e a
 * prova é esse conteúdo — mais o efeito do outro lado: o troco gravado no
 * pagamento do pedido e a 2ª via contada pelo servidor.
 */

interface PrintedPage {
  text: string;
  head: string;
}

/** Replaces the print dialog of every frame with a record of its content. */
async function capturePrints(page: Page) {
  await page.addInitScript(() => {
    const prints: { text: string; head: string }[] = [];
    (window as unknown as { __prints: typeof prints }).__prints = prints;
    const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow")!;
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      get() {
        const win = original.get!.call(this) as (Window & { __captured?: boolean }) | null;
        if (win && !win.__captured) {
          win.__captured = true;
          win.print = () => {
            prints.push({ text: win.document.body.innerText, head: win.document.head.innerHTML });
          };
        }
        return win;
      },
    });
  });
}

async function printed(page: Page, count: number): Promise<PrintedPage[]> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __prints: unknown[] }).__prints.length))
    .toBe(count);
  return page.evaluate(() => (window as unknown as { __prints: PrintedPage[] }).__prints);
}

async function setReceiptFormat(client: ApiClient, receiptFormat: string) {
  const response = await client.patch("/tenants/current", { receiptFormat });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

async function cashMethodId(client: ApiClient): Promise<string> {
  const listed = await client.get("/payment-methods?limit=100");
  const methods = (listed.body as { data: { id: string; type: string; isActive: boolean }[] }).data;
  const cash = methods.find((m) => m.type === "CASH" && m.isActive);
  expect(cash, "nenhuma forma de pagamento em dinheiro ativa").toBeTruthy();
  return cash!.id;
}

test.describe("recibo do cliente", () => {
  test.afterEach(async ({ apiClient }) => {
    await setReceiptFormat(apiClient, "THERMAL_80");
  });

  test("RC-01: a venda no balcão com troco imprime o valor recebido, o troco e o CPF mascarado", async ({
    appPage,
    apiClient,
  }) => {
    await ensureOpenCashSession(apiClient);
    await setReceiptFormat(apiClient, "THERMAL_80");
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);
    await capturePrints(appPage);

    await appPage.goto("/vendas/balcao");
    await appPage.getByRole("button", { name: "Buscar cliente por nome ou documento..." }).click();
    await appPage.getByPlaceholder("Buscar...").fill(customer.name);
    await appPage.getByRole("button", { name: new RegExp(customer.name) }).last().click();

    await appPage.getByRole("button", { name: "Buscar produto por nome, SKU ou código de barras..." }).click();
    await appPage.getByPlaceholder("Buscar...").fill(product.sku);
    await appPage.getByRole("button", { name: new RegExp(product.sku) }).last().click();

    await appPage.getByRole("button", { name: "Adicionar pagamento" }).click();
    await appPage.getByRole("combobox").filter({ hasText: "Selecione..." }).first().click();
    await appPage.getByRole("option", { name: "Dinheiro · dinheiro" }).click();
    const received = appPage.getByLabel("Valor Recebido");
    // Como o vendedor faz: apaga o total que veio preenchido e digita o que o
    // cliente entregou. Apagar passava por valores abaixo do total, e a linha
    // voltava sozinha para o total.
    await received.click();
    for (let i = 0; i < 10; i++) {await received.press("Backspace");}
    await received.pressSequentially("50000");
    await expect(received).toHaveValue("500,00");
    await expect(appPage.getByText(/Troco/).first()).toBeVisible();

    await appPage.getByRole("button", { name: /Finalizar Venda/ }).click();
    await appPage.waitForURL(/\/vendas\/pedidos\/[^/]+$/);
    const orderId = appPage.url().split("/").pop()!;

    // O efeito do outro lado: o pagamento guarda o que o cliente entregou.
    const order = await waitFor(
      async () => (await apiClient.get(`/orders/${orderId}`)).body as {
        data: { totalAmount: string; payments: { amount: string; amountTendered: string | null }[] };
      },
      (o) => o.data.payments.length > 0,
      { label: "pagamento do pedido" }
    );
    const [cash] = order.data.payments;
    const total = Number(order.data.totalAmount);
    const tendered = 500;
    expect(total, "o produto da fixture precisa custar menos que R$ 500 para haver troco").toBeLessThan(tendered);
    expect(Number(cash.amount)).toBe(total);
    expect(Number(cash.amountTendered)).toBe(tendered);
    const brl = (v: number) =>
      v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const change = brl(Math.round((tendered - total) * 100) / 100);

    await appPage.getByRole("button", { name: "Imprimir recibo" }).click();
    const [first] = await printed(appPage, 1);
    expect(first.text).toContain("RECIBO DE VENDA");
    expect(first.text).toContain("NÃO É DOCUMENTO FISCAL");
    expect(first.text).toMatch(new RegExp(`Recebido\\s*R\\$\\s?${brl(tendered).replace(".", "\\.")}`));
    expect(first.text).toMatch(new RegExp(`Troco\\s*R\\$\\s?${change.replace(".", "\\.")}`));
    expect(first.text).toMatch(/CPF \*\*\*\.\d{3}\.\d{3}-\*\*/);
    expect(first.text).not.toContain("VIA");
    expect(first.head).toMatch(/size: 80mm \d+mm/);

    // Reimprimir conta a via no servidor.
    await expect(appPage.getByRole("button", { name: "Imprimir recibo" })).toBeEnabled();
    await appPage.getByRole("button", { name: "Imprimir recibo" }).click();
    const [, second] = await printed(appPage, 2);
    expect(second.text).toContain("2ª VIA");
  });

  test("RC-02: a devolução imprime o comprovante, no formato escolhido pela loja, sem CPF de quem não tem", async ({
    appPage,
    apiClient,
  }) => {
    const { sessionId } = await ensureOpenCashSession(apiClient);
    const product = await ensureSellableProduct(apiClient);
    const created = await apiClient.post("/customers", { name: `Sem documento ${stamp()}`, phone: "11987654321" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const customer = (created.body as { data: { id: string } }).data;
    const method = await cashMethodId(apiClient);

    const sale = await apiClient.post("/orders", {
      customerId: customer.id,
      origin: "BALCAO",
      cashRegisterSessionId: sessionId,
      items: [{ productId: product.id, quantity: 1, unitPrice: 20, discount: 0 }],
      payments: [{ paymentMethodId: method, amount: 20 }],
    });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    const order = (sale.body as { data: { id: string; items: { id: string }[] } }).data;
    const back = await apiClient.post(`/orders/${order.id}/return-item`, {
      orderItemId: order.items[0].id,
      reason: "Cliente desistiu",
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);

    // A loja troca a impressora: o recibo passa a sair em A4.
    await appPage.goto("/configuracoes");
    await appPage.getByRole("button", { name: "Recibo" }).click();
    await appPage.getByRole("radio", { name: /Folha A4/ }).click();
    await appPage.getByRole("button", { name: "Salvar" }).click();
    await expect(appPage.getByText("Configurações do recibo salvas!")).toBeVisible();

    await capturePrints(appPage);
    await appPage.goto(`/vendas/pedidos/${order.id}`);
    await appPage.getByRole("button", { name: "Imprimir comprovante" }).click();
    const [receipt] = await printed(appPage, 1);
    expect(receipt.text).toContain("COMPROVANTE DE DEVOLUÇÃO");
    expect(receipt.text).toContain("Cliente desistiu");
    expect(receipt.text).toContain("NÃO É DOCUMENTO FISCAL");
    expect(receipt.text).not.toContain("CPF");
    expect(receipt.head).toContain("size: A4");
  });

  test("RC-04: a tabela de pedidos imprime o recibo direto da linha", async ({ appPage, apiClient }) => {
    const { sessionId } = await ensureOpenCashSession(apiClient);
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);
    const method = await cashMethodId(apiClient);
    const sale = await apiClient.post("/orders", {
      customerId: customer.id,
      origin: "BALCAO",
      cashRegisterSessionId: sessionId,
      items: [{ productId: product.id, quantity: 1, unitPrice: 20, discount: 0 }],
      payments: [{ paymentMethodId: method, amount: 20 }],
    });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    const order = (sale.body as { data: { orderNumber: string } }).data;

    await capturePrints(appPage);
    await appPage.goto("/vendas/pedidos");
    const row = appPage.getByRole("row").filter({ hasText: order.orderNumber });
    await row.getByRole("button", { name: "Imprimir recibo" }).click();

    const [receipt] = await printed(appPage, 1);
    expect(receipt.text).toContain("RECIBO DE VENDA");
    expect(receipt.text).toContain(`Pedido ${order.orderNumber}`);
    // E a tela continua na lista: imprimir não abre o pedido.
    await expect(appPage).toHaveURL(/\/vendas\/pedidos$/);
  });

  test("RC-03: pedido cancelado não oferece recibo, e a API recusa", async ({ appPage, apiClient }) => {
    const product = await ensureSellableProduct(apiClient);
    const customer = await createCustomer(apiClient);
    const created = await apiClient.post("/orders", {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 1, unitPrice: 20, discount: 0 }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const orderId = (created.body as { data: { id: string } }).data.id;
    const cancelled = await apiClient.patch(`/orders/${orderId}/cancel`, { reason: "e2e: recibo" });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

    await appPage.goto(`/vendas/pedidos/${orderId}`);
    await expect(appPage.getByRole("heading", { name: /Pedido #/ })).toBeVisible();
    await expect(appPage.getByRole("button", { name: "Imprimir recibo" })).toHaveCount(0);

    const refused = await apiClient.post(`/orders/${orderId}/receipt`, {});
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("Pedido cancelado não tem recibo");
  });
});
