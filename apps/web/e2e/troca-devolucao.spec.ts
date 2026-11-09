import type { Page } from "@playwright/test";

import {
  test,
  expect,
  API_URL,
  createCustomer,
  ensureOpenCashSession,
  ensureWarehouse,
  instrument,
  stamp,
  waitFor,
  type ApiClient,
} from "./fixtures";

/**
 * Jornada: troca e devolução de item de um pedido já vendido.
 *
 * Cada teste confirma pela tela e confere o efeito do outro lado — estoque da
 * variante, gaveta do caixa, títulos do pedido. O toast é a parte que mente.
 */

// ─── Massa ──────────────────────────────────────────────────────────────

type Body<T> = { data: T };

async function createProduct(
  client: ApiClient,
  opts: { price: number; variants?: string[] }
): Promise<{ id: string; name: string; sku: string; variants: Record<string, string> }> {
  const suffix = stamp();
  const sku = `E2E-TRC-${suffix}`;
  const created = await client.post("/products", {
    name: `E2E Troca ${suffix}`,
    sku,
    status: "ACTIVE",
    costPrice: 10,
    salePrice: opts.price,
    ...(opts.variants
      ? {
          variants: opts.variants.map((size) => ({
            sku: `${sku}-${size}`,
            name: `E2E Troca ${size}`,
            attributes: { tamanho: size },
          })),
        }
      : {}),
  });
  expect(created.status, `produto E2E: ${JSON.stringify(created.body)}`).toBe(201);
  const product = (created.body as Body<{ id: string; name: string }>).data;

  const detail = await client.get(`/products/${product.id}`);
  const variantRows = (detail.body as Body<{ variants?: { id: string; name: string }[] }>).data.variants ?? [];
  const variants = Object.fromEntries(variantRows.map((v) => [v.name.split(" ").pop()!, v.id]));

  const warehouse = await ensureWarehouse(client);
  const targets = variantRows.length > 0 ? variantRows.map((v) => v.id) : [undefined];
  for (const variantId of targets) {
    const stocked = await client.post("/inventory/adjustment", {
      productId: product.id,
      ...(variantId ? { variantId } : {}),
      warehouseId: warehouse.id,
      countedQuantity: 20,
      reason: "INITIAL",
    });
    expect(stocked.status, `estoque E2E: ${JSON.stringify(stocked.body)}`).toBeLessThan(300);
  }

  return { id: product.id, name: product.name, sku, variants };
}

async function variantAvailable(client: ApiClient, productId: string, variantId?: string) {
  const detail = await client.get(`/products/${productId}`);
  const data = (detail.body as Body<{
    variants?: { id: string; inventoryItems?: { available: number }[] }[];
    inventoryItems?: { variantId: string | null; available: number }[];
  }>).data;
  const rows = variantId
    ? data.variants?.find((v) => v.id === variantId)?.inventoryItems ?? []
    : (data.inventoryItems ?? []).filter((i) => !i.variantId);
  return rows.reduce((sum, i) => sum + Number(i.available), 0);
}

async function paymentMethodId(client: ApiClient, type: string): Promise<string> {
  const listed = await client.get("/payment-methods?limit=50");
  const method = ((listed.body as { data?: { id: string; type: string }[] }).data ?? []).find(
    (m) => m.type === type
  );
  expect(method, `forma de pagamento ${type} não cadastrada`).toBeTruthy();
  return method!.id;
}

type Order = {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number | string;
  items: { id: string; productId: string; variantId: string | null; quantity: number }[];
  receivables: { description: string; amount: number | string; status: string }[];
  adjustments: { type: string; difference: number | string; abatedAmount: number | string; payableId: string | null }[];
};

async function orderDetail(client: ApiClient, id: string): Promise<Order> {
  return ((await client.get(`/orders/${id}`)).body as Body<Order>).data;
}

async function counterSale(
  client: ApiClient,
  input: {
    sessionId: string;
    items: { productId: string; variantId?: string; quantity: number; unitPrice: number }[];
    paymentType: string;
  }
): Promise<Order> {
  const customer = await createCustomer(client);
  const total = input.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const created = await client.post("/orders", {
    origin: "BALCAO",
    customerId: customer.id,
    cashRegisterSessionId: input.sessionId,
    items: input.items,
    payments: [{ paymentMethodId: await paymentMethodId(client, input.paymentType), amount: total }],
  });
  expect(created.status, `venda E2E: ${JSON.stringify(created.body)}`).toBe(201);
  const order = (created.body as Body<{ id: string }>).data;
  // Recebíveis e baixa de estoque são escritos por evento, depois do 201.
  return waitFor(
    () => orderDetail(client, order.id),
    (o) => o.receivables.length > 0,
    { label: "recebíveis da venda de balcão" }
  );
}

async function drawerBalance(client: ApiClient, cashRegisterId: string): Promise<number> {
  const current = await client.get(`/cash-registers/${cashRegisterId}/session`);
  return Number((current.body as Body<{ totals?: { currentBalance: number } }>).data.totals?.currentBalance ?? 0);
}

// ─── Tela ───────────────────────────────────────────────────────────────

async function openAdjust(page: Page, orderId: string, action: "Trocar" | "Devolver", row = 0) {
  await page.goto(`/vendas/pedidos/${orderId}`);
  await page.getByRole("button", { name: action }).nth(row).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Troca ou devolução" })).toBeVisible();
  return dialog;
}

async function pickSelect(page: Page, triggerId: string, option: string | RegExp) {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole("option", { name: option }).click();
}

const BRL = (value: string) => new RegExp(`R\\$\\s?${value.replace(".", "\\.")}`);

// ─── Jornadas ───────────────────────────────────────────────────────────

test.describe("troca e devolução de item", () => {
  test("TROCA-01: troca de tamanho pela tela move o estoque das variantes e não gera título", async ({
    appPage,
    apiClient,
  }) => {
    const { sessionId } = await ensureOpenCashSession(apiClient);
    const shirt = await createProduct(apiClient, { price: 100, variants: ["P", "M", "G"] });
    const order = await counterSale(apiClient, {
      sessionId,
      items: [{ productId: shirt.id, variantId: shirt.variants.M, quantity: 2, unitPrice: 100 }],
      paymentType: "CASH",
    });
    const mBefore = await waitFor(
      () => variantAvailable(apiClient, shirt.id, shirt.variants.M),
      (v) => v === 18,
      { label: "baixa da venda na variante M" }
    );
    const gBefore = await variantAvailable(apiClient, shirt.id, shirt.variants.G);

    const dialog = await openAdjust(appPage, order.id, "Trocar");
    // Item vendido com variante abre direto na troca de tamanho.
    await expect(dialog.getByRole("radio", { name: "Outro tamanho/cor" })).toHaveAttribute("aria-checked", "true");
    await pickSelect(appPage, "adjust-variant", /E2E Troca G/);
    await dialog.locator("#adjust-quantity").fill("1");
    await expect(dialog.getByText("Sem diferença a acertar")).toBeVisible();
    await dialog.getByRole("button", { name: "Confirmar troca" }).click();
    await expect(appPage.getByText("Troca registrada. Sem diferença de valor.")).toBeVisible();

    await waitFor(
      () => variantAvailable(apiClient, shirt.id, shirt.variants.M),
      (v) => v === mBefore + 1,
      { label: "retorno da variante M" }
    );
    expect(await variantAvailable(apiClient, shirt.id, shirt.variants.G)).toBe(gBefore - 1);

    const after = await orderDetail(apiClient, order.id);
    expect(after.receivables, "troca de tamanho gerou título").toHaveLength(1);
    expect(after.adjustments[0]).toMatchObject({ type: "EXCHANGE" });
    expect(Number(after.adjustments[0].difference)).toBe(0);
    expect(after.items.map((i) => [i.variantId, i.quantity]).sort()).toEqual(
      [[shirt.variants.G, 1], [shirt.variants.M, 1]].sort()
    );
    // A tela mostra o histórico da troca.
    await expect(appPage.getByRole("heading", { name: "Trocas e devoluções" })).toBeVisible();
  });

  test("TROCA-02: troca por produto mais caro, recebendo em dinheiro, entra na gaveta", async ({
    appPage,
    apiClient,
  }) => {
    const { sessionId, cashRegisterId } = await ensureOpenCashSession(apiClient);
    const shirt = await createProduct(apiClient, { price: 100, variants: ["M"] });
    const pants = await createProduct(apiClient, { price: 150 });
    const order = await counterSale(apiClient, {
      sessionId,
      items: [{ productId: shirt.id, variantId: shirt.variants.M, quantity: 1, unitPrice: 100 }],
      paymentType: "CASH",
    });
    const drawerBefore = await drawerBalance(apiClient, cashRegisterId);
    const pantsBefore = await variantAvailable(apiClient, pants.id);

    const dialog = await openAdjust(appPage, order.id, "Trocar");
    await dialog.getByRole("radio", { name: "Outro produto" }).click();
    await dialog.getByRole("button", { name: "Buscar por nome ou SKU" }).click();
    await appPage.getByPlaceholder("Buscar...").fill(pants.sku);
    await dialog.getByRole("button", { name: new RegExp(pants.name) }).click();

    // A prévia é o valor que o operador fala para o cliente.
    await expect(dialog.getByText("Cliente paga")).toBeVisible();
    await expect(dialog.getByTestId("adjust-headline-amount")).toHaveText(BRL("50,00"));
    await expect(dialog.getByLabel("Receber agora")).toBeChecked();
    await pickSelect(appPage, "adjust-method", "Dinheiro");
    await dialog.getByRole("button", { name: "Confirmar troca" }).click();
    await expect(appPage.getByText(/Recebido R\$\s?50,00 do cliente/)).toBeVisible();

    await waitFor(
      () => drawerBalance(apiClient, cashRegisterId),
      (v) => v === drawerBefore + 50,
      { label: "entrada da diferença na gaveta" }
    );
    const after = await orderDetail(apiClient, order.id);
    const difference = after.receivables.find((r) => r.description.startsWith("Diferença de troca"));
    expect(difference, "diferença sem título a receber").toBeTruthy();
    expect(difference).toMatchObject({ status: "PAID" });
    expect(Number(difference!.amount)).toBe(50);
    expect(Number(after.totalAmount)).toBe(150);
    expect(await variantAvailable(apiClient, pants.id)).toBe(pantsBefore - 1);
  });

  test("TROCA-03: devolução de venda a prazo abate o que o cliente deve, sem reembolso", async ({
    appPage,
    apiClient,
  }) => {
    const { sessionId, cashRegisterId } = await ensureOpenCashSession(apiClient);
    const product = await createProduct(apiClient, { price: 100 });
    // Cartão de crédito liquida em D+30: o recebível nasce em aberto.
    const order = await counterSale(apiClient, {
      sessionId,
      items: [{ productId: product.id, quantity: 2, unitPrice: 100 }],
      paymentType: "CREDIT_CARD",
    });
    expect(order.receivables.every((r) => r.status === "PENDING")).toBeTruthy();
    const drawerBefore = await drawerBalance(apiClient, cashRegisterId);

    const dialog = await openAdjust(appPage, order.id, "Devolver");
    await dialog.locator("#adjust-quantity").fill("1");
    await dialog.locator("#adjust-reason").fill("Defeito");

    await expect(dialog.getByText("Abatido do que o cliente deve")).toBeVisible();
    await expect(dialog.getByTestId("adjust-headline-amount")).toHaveText(BRL("100,00"));
    await expect(dialog.getByText(/nada a devolver em dinheiro/)).toBeVisible();
    // Não há dinheiro a movimentar: a opção de devolver agora nem aparece.
    await expect(dialog.getByLabel("Devolver agora")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Confirmar devolução" }).click();
    await expect(appPage.getByText(/R\$\s?100,00 abatidos do que o cliente devia/)).toBeVisible();

    const after = await orderDetail(apiClient, order.id);
    const open = after.receivables.filter((r) => r.status === "PENDING");
    expect(open.reduce((s, r) => s + Number(r.amount), 0), "o recebível não foi abatido").toBe(100);
    expect(after.adjustments[0].payableId, "abatimento gerou reembolso").toBeNull();
    expect(Number(after.adjustments[0].abatedAmount)).toBe(100);
    expect(Number(after.totalAmount)).toBe(100);
    expect(await drawerBalance(apiClient, cashRegisterId), "a gaveta mexeu sem dinheiro").toBe(drawerBefore);
  });

  test("TROCA-04: com dois caixas abertos e o da venda fechado, o operador escolhe por onde o dinheiro sai", async ({
    appPage,
    apiClient,
  }) => {
    const main = await ensureOpenCashSession(apiClient);
    const second = await ensureSecondRegister(apiClient, main.cashRegisterId);
    const product = await createProduct(apiClient, { price: 100 });

    try {
      // Venda no segundo caixa, que depois fecha e reabre: o caixa da venda não
      // existe mais e há dois abertos — a API não pode escolher sozinha.
      const saleSession = await openRegister(apiClient, second.id);
      const order = await counterSale(apiClient, {
        sessionId: saleSession,
        items: [{ productId: product.id, quantity: 1, unitPrice: 100 }],
        paymentType: "CASH",
      });
      await closeRegister(apiClient, second.id);
      await openRegister(apiClient, second.id);

      const drawerBefore = await drawerBalance(apiClient, second.id);

      const dialog = await openAdjust(appPage, order.id, "Devolver");
      await dialog.locator("#adjust-reason").fill("Desistiu");
      await expect(dialog.getByTestId("adjust-headline-amount")).toHaveText(BRL("100,00"));
      await pickSelect(appPage, "adjust-method", "Dinheiro");

      // Sem caixa escolhido, o formulário recusa antes de chamar a API.
      await dialog.getByRole("button", { name: "Confirmar devolução" }).click();
      await expect(dialog.getByText("Escolha por qual caixa o dinheiro passa.")).toBeVisible();

      await pickSelect(appPage, "adjust-session", second.name);
      await dialog.getByRole("button", { name: "Confirmar devolução" }).click();
      await expect(appPage.getByText(/Devolvido R\$\s?100,00 ao cliente/)).toBeVisible();

      await waitFor(
        () => drawerBalance(apiClient, second.id),
        (v) => v === drawerBefore - 100,
        { label: "saída do reembolso na gaveta escolhida" }
      );
    } finally {
      // Dois caixas abertos fazem toda venda sem caixa explícito ser recusada
      // (FN-05) — a suíte inteira depende de fechar e desativar este.
      await retireSecondRegister(apiClient, second.id);
    }
  });

  test("TROCA-05: sem permissão de editar pedidos, os botões aparecem desabilitados", async ({
    apiClient,
    browser,
    request,
    baseURL,
  }) => {
    const { sessionId } = await ensureOpenCashSession(apiClient);
    const product = await createProduct(apiClient, { price: 100 });
    const order = await counterSale(apiClient, {
      sessionId,
      items: [{ productId: product.id, quantity: 1, unitPrice: 100 }],
      paymentType: "CASH",
    });

    // O perfil financeiro lê pedidos, mas não os edita.
    const credentials = await ensureFinancialUser(apiClient);
    const loginResponse = await request.post(`${API_URL}/auth/login`, { data: credentials });
    expect(loginResponse.ok(), "login do usuário financeiro").toBeTruthy();
    const session = (await loginResponse.json()).data as { accessToken: string; refreshToken: string };

    const context = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
    const page = await context.newPage();
    const instrumentation = instrument(page);
    try {
      await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
      await page.evaluate(
        ([access, refresh]) => {
          localStorage.setItem("erp_token", access);
          localStorage.setItem("erp_refresh_token", refresh);
        },
        [session.accessToken, session.refreshToken]
      );
      await page.goto(`${baseURL}/vendas/pedidos/${order.id}`);

      const gated = page.getByTestId("permission-disabled");
      await expect(gated).toHaveCount(1);
      await expect(gated).toHaveAttribute("aria-disabled", "true");
      await expect(gated.getByRole("button", { name: "Trocar" })).toBeVisible();
      await expect(gated.getByRole("button", { name: "Devolver" })).toBeVisible();

      await gated.getByRole("button", { name: "Devolver" }).click({ force: true });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      instrumentation.assertClean();
    } finally {
      await context.close();
    }
  });

  test("TROCA-06: no modo escuro o diálogo usa as cores do tema escuro", async ({ appPage, apiClient }) => {
    const { sessionId } = await ensureOpenCashSession(apiClient);
    const product = await createProduct(apiClient, { price: 100 });
    const order = await counterSale(apiClient, {
      sessionId,
      items: [{ productId: product.id, quantity: 1, unitPrice: 100 }],
      paymentType: "CASH",
    });

    await appPage.evaluate(() => localStorage.setItem("theme", "dark"));
    const dialog = await openAdjust(appPage, order.id, "Devolver");
    await expect(appPage.locator("html")).toHaveClass(/\bdark\b/);

    const amount = dialog.getByTestId("adjust-headline-amount");
    await expect(amount).toHaveText(BRL("100,00"));
    const color = await amount.evaluate((el) => getComputedStyle(el).color);
    const background = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor);

    // O fundo escureceu de fato…
    expect(luminance(background), `fundo do diálogo no escuro: ${background}`).toBeLessThan(0.1);
    // …e o valor que o operador lê para o cliente continua legível sobre ele.
    // Sem a variante `dark:`, seria o azul escuro do tema claro sobre fundo
    // escuro (contraste perto de 2:1).
    expect(contrast(color, background), `contraste ${color} sobre ${background}`).toBeGreaterThanOrEqual(4.5);

    await appPage.evaluate(() => localStorage.removeItem("theme"));
  });
});

// ─── Contraste (WCAG 2.1) ───────────────────────────────────────────────

function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ─── Caixa e usuário auxiliares ─────────────────────────────────────────

const SECOND_REGISTER = "E2E Caixa Troca";

/**
 * Um caixa além do principal, ativo só durante o teste.
 *
 * Fica cadastrado (o nome é único) mas **inativo** entre execuções: um caixa
 * ativo a mais muda o que as outras jornadas encontram ao reabrir o caixa
 * principal e aparece na tela de caixas como se fosse da loja.
 */
async function ensureSecondRegister(
  client: ApiClient,
  mainRegisterId: string
): Promise<{ id: string; name: string }> {
  const listed = await client.get("/cash-registers?limit=50");
  const registers = (listed.body as { data?: { id: string; name: string }[] }).data ?? [];
  const existing = registers.find((r) => r.name === SECOND_REGISTER);
  expect(existing?.id, "o caixa principal não pode ser o segundo caixa do teste").not.toBe(mainRegisterId);

  if (existing) {
    // Sobra de uma execução interrompida: começa fechado e ativo.
    await closeRegister(client, existing.id);
    await client.patch(`/cash-registers/${existing.id}`, { isActive: true });
    return existing;
  }

  const account = await client.post("/financial-accounts", {
    name: `E2E Gaveta Troca ${stamp()}`,
    type: "CASH",
  });
  expect(account.status, `conta do caixa E2E: ${JSON.stringify(account.body)}`).toBe(201);
  const created = await client.post("/cash-registers", {
    name: SECOND_REGISTER,
    financialAccountId: (account.body as Body<{ id: string }>).data.id,
  });
  expect(created.status, `caixa E2E: ${JSON.stringify(created.body)}`).toBe(201);
  return (created.body as Body<{ id: string; name: string }>).data;
}

async function retireSecondRegister(client: ApiClient, registerId: string): Promise<void> {
  await closeRegister(client, registerId);
  const patched = await client.patch(`/cash-registers/${registerId}`, { isActive: false });
  expect(patched.status, `desativação do caixa E2E: ${JSON.stringify(patched.body)}`).toBeLessThan(300);
}

/** Abre declarando o saldo da conta — abrir não cria dinheiro. */
async function openRegister(client: ApiClient, registerId: string): Promise<string> {
  const registers = await client.get("/cash-registers?limit=50");
  const register = ((registers.body as { data?: { id: string; financialAccountId: string }[] }).data ?? []).find(
    (r) => r.id === registerId
  )!;
  const account = await client.get(`/financial-accounts/${register.financialAccountId}`);
  const balance = Number((account.body as Body<{ balance: number }>).data.balance);
  const opened = await client.post(`/cash-registers/${registerId}/open`, { openingBalance: balance });
  expect(opened.status, `abertura do caixa E2E: ${JSON.stringify(opened.body)}`).toBe(201);
  return (opened.body as Body<{ id: string }>).data.id;
}

/** Fecha contando exatamente o esperado — sem diferença, tudo fica na gaveta. */
async function closeRegister(client: ApiClient, registerId: string): Promise<void> {
  const current = await client.get(`/cash-registers/${registerId}/session`);
  // Sem sessão aberta a rota responde `data: { data: null }` — envelope duplo,
  // então "tem data" não quer dizer "tem sessão". O que diz é o id.
  if (!(current.body as Body<{ id?: string }> | null)?.data?.id) {
    return;
  }
  const balance = await drawerBalance(client, registerId);
  const closed = await client.post(`/cash-registers/${registerId}/close`, {
    closingBalance: balance,
    retainedAmount: balance,
  });
  expect(closed.status, `fechamento do caixa E2E: ${JSON.stringify(closed.body)}`).toBeLessThan(300);
}

const FINANCIAL_USER = {
  email: "e2e.financeiro@exemplo.com",
  password: "Planilha#Contas2026",
};

async function ensureFinancialUser(client: ApiClient) {
  const roles = await client.get("/users/roles");
  const role = ((roles.body as { data?: { id: string; name: string }[] }).data ?? []).find(
    (r) => r.name === "financial"
  );
  expect(role, "perfil financeiro não existe no seed").toBeTruthy();

  const created = await client.post("/users", {
    name: "E2E Financeiro",
    email: FINANCIAL_USER.email,
    password: FINANCIAL_USER.password,
    roleId: role!.id,
  });
  // 409 = criado numa execução anterior.
  expect([201, 409], `usuário financeiro E2E: ${JSON.stringify(created.body)}`).toContain(created.status);
  return FINANCIAL_USER;
}
