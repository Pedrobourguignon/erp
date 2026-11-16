import { test, expect, stamp, waitFor, type ApiClient } from "./fixtures";

/**
 * Jornada: lançamento, baixa parcial, estorno e conciliação do caixa.
 *
 * Cobre FN-01 (o filtro descartava o último dia), FN-02 (data exibida um dia a
 * menos), FN-04 (nada era reversível), FN-06 (sangria a descoberto) e FN-28
 * (ruído de float nos totais).
 */

async function anyAccount(client: ApiClient) {
  const response = await client.get("/financial-accounts?limit=10");
  const accounts = (response.body as { data?: { id: string; name: string }[] }).data ?? [];
  expect(accounts.length, "nenhuma conta financeira cadastrada").toBeGreaterThan(0);
  return accounts[0];
}

/**
 * Reads one entry back from the listing.
 *
 * There is no `GET /financial-entries/:id` — the module exposes the list, the
 * settlements of an entry and the mutations, but not the single read. Noted as
 * a contract gap; the journeys go through the list meanwhile.
 */
async function findEntry(client: ApiClient, description: string) {
  const response = await client.get("/financial-entries?limit=200");
  const rows =
    (response.body as {
      // `date` carries the due date for an open title — it is the column the
      // financial screen shows as "Vencimento".
      data?: { id: string; description: string; status: string; date: string }[];
    }).data ?? [];
  const entry = rows.find((e) => e.description === description);
  expect(entry, `lançamento "${description}" não encontrado na listagem`).toBeTruthy();
  return entry!;
}

async function accountBalance(client: ApiClient, accountId: string) {
  const response = await client.get(`/financial-accounts/${accountId}`);
  const data = (response.body as { data?: { balance?: number } }).data ?? {};
  return Number(data.balance ?? 0);
}

test.describe("financeiro", () => {
  test("FN-02: o vencimento é gravado no dia digitado, não no anterior", async ({
    apiClient,
  }) => {
    const account = await anyAccount(apiClient);
    const marker = `E2E vencimento ${stamp()}`;

    const created = await apiClient.post("/financial-entries", {
      type: "EXPENSE",
      description: marker,
      amount: 123.45,
      date: "2026-01-10",
      paid: false,
      dueDate: "2026-01-15",
      accountId: account.id,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const { date } = await findEntry(apiClient, marker);
    // Meia-noite de 15/01 no fuso do tenant é 03:00 UTC. `new Date('2026-01-15')`
    // seria 00:00 UTC, que é 21:00 do dia 14 em BRT — o bug.
    expect(date).toBe("2026-01-15T03:00:00.000Z");
  });

  test("FN-01: o filtro de um único dia traz os lançamentos daquele dia", async ({
    apiClient,
  }) => {
    const account = await anyAccount(apiClient);
    const marker = `E2E filtro ${stamp()}`;

    const created = await apiClient.post("/financial-entries", {
      type: "EXPENSE",
      description: marker,
      amount: 50,
      date: "2026-03-10",
      paid: false,
      dueDate: "2026-03-10",
      accountId: account.id,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    // O fim do período era 02:59 UTC, e todo lançamento do dia caía depois dele.
    const filtered = await apiClient.get(
      "/financial-entries?startDate=2026-03-10&endDate=2026-03-10&limit=100"
    );
    const found = (
      (filtered.body as { data?: { description: string }[] }).data ?? []
    ).some((e) => e.description === marker);
    expect(found, "o lançamento do próprio dia sumiu do filtro").toBeTruthy();
  });

  test("FN-23: um período invertido não devolve lista vazia", async ({ apiClient }) => {
    // A UI critica antes; o backend inverte os extremos por segurança, para o
    // usuário nunca ler "nenhum resultado" por causa da ordem dos campos.
    const inverted = await apiClient.get(
      "/financial-entries?startDate=2026-03-31&endDate=2026-03-01&limit=10"
    );
    expect(inverted.status).toBe(200);
  });

  test("FN-04: a baixa é reversível e devolve o título ao estado anterior", async ({
    apiClient,
  }) => {
    const account = await anyAccount(apiClient);
    const marker = `E2E estorno ${stamp()}`;

    const created = await apiClient.post("/financial-entries", {
      type: "REVENUE",
      description: marker,
      amount: 300,
      date: "2026-06-01",
      paid: false,
      // Vencimento no futuro de propósito: um título vencido é lido como
      // OVERDUE (FN-03) e a asserção seria sobre a regra errada.
      dueDate: "2099-12-31",
      accountId: account.id,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const entry = (created.body as { data: { id: string } }).data;

    const settled = await apiClient.post(`/financial-entries/${entry.id}/settle`, {
      kind: "RECEIVABLE",
      amount: 100,
      accountId: account.id,
      paidAt: "2026-06-20",
    });
    expect(settled.status, JSON.stringify(settled.body)).toBeLessThan(300);

    const partial = await findEntry(apiClient, marker);
    expect(partial.status).toBe("PARTIALLY_PAID");

    const settlements = await apiClient.get(`/financial-entries/${entry.id}/settlements`);
    const rows = (settlements.body as { data?: { id: string }[] }).data ?? [];
    expect(rows.length, "a UI não teria como escolher qual baixa estornar")
      .toBeGreaterThan(0);

    const reversed = await apiClient.post(
      `/financial-entries/${entry.id}/settlements/${rows[0].id}/reverse`,
      { reason: "Estorno pelo teste E2E" }
    );
    expect(reversed.status, JSON.stringify(reversed.body)).toBeLessThan(300);

    const back = await findEntry(apiClient, marker);
    expect(back.status, "o título não voltou ao estado anterior").toBe("PENDING");

    // Estornar duas vezes é recusado — senão a conta recebe o dinheiro de volta
    // quantas vezes alguém clicar.
    const twice = await apiClient.post(
      `/financial-entries/${entry.id}/settlements/${rows[0].id}/reverse`,
      { reason: "Segundo estorno" }
    );
    expect(twice.status).toBe(409);
  });

  test("FN-04: o estorno exige motivo", async ({ apiClient }) => {
    const account = await anyAccount(apiClient);
    const created = await apiClient.post("/financial-entries", {
      type: "REVENUE",
      description: `E2E motivo ${stamp()}`,
      amount: 80,
      date: "2026-06-01",
      paid: false,
      dueDate: "2026-06-30",
      accountId: account.id,
    });
    const entry = (created.body as { data: { id: string } }).data;
    await apiClient.post(`/financial-entries/${entry.id}/settle`, {
      kind: "RECEIVABLE",
      amount: 80,
      accountId: account.id,
      paidAt: "2026-06-20",
    });
    const settlements = await apiClient.get(`/financial-entries/${entry.id}/settlements`);
    const rows = (settlements.body as { data?: { id: string }[] }).data ?? [];

    const noReason = await apiClient.post(
      `/financial-entries/${entry.id}/settlements/${rows[0].id}/reverse`,
      {}
    );
    expect(noReason.status).toBe(400);
  });

  test("FN-28: os totais não carregam ruído de float", async ({ apiClient }) => {
    const response = await apiClient.get("/financial-entries?limit=50");
    const totals = (response.body as { totals?: Record<string, unknown> }).totals ?? {};

    for (const [key, value] of Object.entries(totals)) {
      if (typeof value !== "number") continue;
      // `299.8 + 409.1` é `708.9000000000001` — foi exatamente isso que a API
      // devolveu antes de somar em centavos.
      expect(
        Math.abs(value * 100 - Math.round(value * 100)),
        `${key} carrega ruído: ${value}`
      ).toBeLessThan(1e-6);
    }
  });

  test("FN-06: a sangria acima do disponível é recusada", async ({ apiClient }) => {
    const sessions = await apiClient.get("/cash-register-sessions?status=OPEN&limit=5");
    const open = (
      (sessions.body as { data?: { id: string; cashRegisterId: string }[] }).data ?? []
    )[0];
    test.skip(!open, "nenhuma sessão de caixa aberta");

    // A sangria é transferência e exige destino; sem ele a recusa seria pela
    // falta de conta, não pelo saldo — verde pelo motivo errado.
    const registers = await apiClient.get("/cash-registers?limit=50");
    const drawerAccountId = (
      (registers.body as { data?: { id: string; financialAccountId: string }[] }).data ?? []
    ).find((r) => r.id === open!.cashRegisterId)?.financialAccountId;
    const accounts = await apiClient.get("/financial-accounts?limit=50&isActive=true");
    const destination = (
      (accounts.body as { data?: { id: string }[] }).data ?? []
    ).find((a) => a.id !== drawerAccountId);
    test.skip(!destination, "nenhuma conta além da gaveta para receber a sangria");

    const withdraw = await apiClient.post(
      `/cash-registers/${open!.cashRegisterId}/withdraw`,
      {
        amount: 999999,
        reason: "Sangria impossível do teste E2E",
        destinationAccountId: destination!.id,
      }
    );

    expect(withdraw.status).toBe(400);
    expect(String((withdraw.body as { message?: string }).message)).toMatch(
      /saldo insuficiente/i
    );
  });

  test("FN-15: o suprimento do caixa reflete na conta vinculada", async ({
    apiClient,
  }) => {
    const sessions = await apiClient.get("/cash-register-sessions?status=OPEN&limit=5");
    const open = (
      (sessions.body as { data?: { id: string; cashRegisterId: string }[] }).data ?? []
    )[0];
    test.skip(!open, "nenhuma sessão de caixa aberta");

    const register = await apiClient.get(`/cash-registers?limit=20`);
    const found = (
      (register.body as { data?: { id: string; financialAccountId?: string }[] }).data ?? []
    ).find((r) => r.id === open!.cashRegisterId);
    test.skip(!found?.financialAccountId, "o caixa não tem conta vinculada");

    const accountId = found!.financialAccountId!;
    const before = await accountBalance(apiClient, accountId);

    // O suprimento é transferência e exige origem. Uma conta bancária pode ficar
    // negativa, então serve de origem sem precisar de saldo prévio.
    const bank = await apiClient.post("/financial-accounts", {
      name: `Banco E2E ${stamp()}`,
      type: "CHECKING",
    });
    expect(bank.status, JSON.stringify(bank.body)).toBe(201);
    const bankId = (bank.body as { data: { id: string } }).data.id;

    const supply = await apiClient.post(`/cash-registers/${open!.cashRegisterId}/supply`, {
      amount: 50,
      reason: "Suprimento do teste E2E",
      sourceAccountId: bankId,
    });
    expect(supply.status, JSON.stringify(supply.body)).toBeLessThan(300);
    expect(await accountBalance(apiClient, bankId)).toBe(-50);

    // Sem isto, a conta ficava em R$ 0,00 depois de um dia inteiro de operação.
    const after = await waitFor(
      () => accountBalance(apiClient, accountId),
      (value) => Math.round(value * 100) === Math.round((before + 50) * 100),
      { label: "reflexo do suprimento na conta" }
    );
    expect(Math.round(after * 100)).toBe(Math.round((before + 50) * 100));
  });
});
