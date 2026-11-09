import { test as base, expect, type Page, type APIRequestContext } from "@playwright/test";

export const API_URL = process.env.E2E_API_URL ?? "http://localhost:3001/api/v1";

export const CREDENTIALS = {
  owner: { email: "admin@admin.com", password: "123456" },
  seller: { email: "vendedor@exemplo.com", password: "Vendedor@123" },
} as const;

export type Role = keyof typeof CREDENTIALS;

// ─── API client ─────────────────────────────────────────────────────────

export interface ApiSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string };
}

export async function login(
  request: APIRequestContext,
  role: Role = "owner"
): Promise<ApiSession> {
  const response = await request.post(`${API_URL}/auth/login`, {
    data: CREDENTIALS[role],
  });
  expect(response.ok(), `login de ${role} falhou`).toBeTruthy();
  const body = await response.json();
  return body.data as ApiSession;
}

/**
 * Thin API client used to assert **side effects**.
 *
 * Every journey has to check something on the other side of the screen it just
 * used: the success toast is the part that lies, the stock balance and the
 * financial entry are not. That is how the QA cycle found the critical bugs.
 */
export function api(request: APIRequestContext, token: string) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const call = async (
    method: "get" | "post" | "patch" | "delete",
    path: string,
    data?: unknown
  ) => {
    const response = await request[method](`${API_URL}${path}`, {
      headers,
      ...(data === undefined ? {} : { data }),
    });
    let body: Record<string, unknown> | null = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status(), body: body as never };
  };

  return {
    get: (path: string) => call("get", path),
    post: (path: string, data?: unknown) => call("post", path, data),
    patch: (path: string, data?: unknown) => call("patch", path, data),
    delete: (path: string) => call("delete", path),
  };
}

export type ApiClient = ReturnType<typeof api>;

// ─── Test mass helpers ──────────────────────────────────────────────────

/**
 * A valid, unused CPF.
 *
 * Hardcoding one makes the second run fail with 409 — the duplicate rule from
 * AE-15 doing its job. The check digits are computed so the document passes the
 * same validator the API uses.
 */
export function makeCpf(seed: number = Date.now()): string {
  const base = String(seed).slice(-9).padStart(9, "0").split("").map(Number);
  const digit = (nums: number[]) => {
    const weightStart = nums.length + 1;
    const sum = nums.reduce((acc, n, i) => acc + n * (weightStart - i), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = digit(base);
  const d2 = digit([...base, d1]);
  return [...base, d1, d2].join("");
}

export function stamp(): string {
  return Date.now().toString().slice(-8);
}

// ─── Fixtures ───────────────────────────────────────────────────────────

interface Fixtures {
  /** A page already authenticated as `owner`. */
  appPage: Page;
  /** API client authenticated as `owner`, for side-effect assertions. */
  apiClient: ApiClient;
  session: ApiSession;
  /** Signs in as any role and returns a fresh page. */
  signInAs: (role: Role) => Promise<{ page: Page; session: ApiSession }>;
}

/**
 * Global instrumentation (step 4 of 10.3).
 *
 * Every journey fails on an uncaught page error, a console error or an HTTP
 * 5xx. On its own this would have caught AE-00 (the white screen) and AE-09
 * (the hooks violation in every confirmation dialog) with no assertion written
 * for either.
 */
const IGNORED_CONSOLE = [
  /favicon/i,
  /Download the React DevTools/i,
  /punycode/i,
  // Next dev overlay noise, not application errors.
  /Fast Refresh/i,
];

export function instrument(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
    // A página 404 responde 404 — é o comportamento correto, e o browser
    // registra isso como erro de console. Ignorado só quando a URL do erro é
    // o próprio documento: um 404 de chamada de API continua sendo falha.
    if (
      /status of 404/.test(text) &&
      message.location().url === page.url()
    ) {
      return;
    }
    consoleErrors.push(text);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  return {
    assertClean() {
      expect(pageErrors, "erro de JavaScript não tratado na página").toEqual([]);
      expect(serverErrors, "resposta 5xx durante a jornada").toEqual([]);
      expect(consoleErrors, "erro no console durante a jornada").toEqual([]);
    },
  };
}

export const test = base.extend<Fixtures>({
  session: async ({ request }, use) => {
    await use(await login(request, "owner"));
  },

  apiClient: async ({ request, session }, use) => {
    await use(api(request, session.accessToken));
  },

  appPage: async ({ page, session, baseURL }, use) => {
    const instrumentation = instrument(page);

    // Seed the tokens the same way the app does, then navigate: going through
    // the login form on every test would test the login form 40 times.
    await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ([access, refresh]) => {
        localStorage.setItem("erp_token", access);
        localStorage.setItem("erp_refresh_token", refresh);
      },
      [session.accessToken, session.refreshToken]
    );

    await use(page);

    instrumentation.assertClean();
  },

  signInAs: async ({ browser, request, baseURL }, use) => {
    const pages: Page[] = [];

    await use(async (role: Role) => {
      const context = await browser.newContext({
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      pages.push(page);
      const roleSession = await login(request, role);
      await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
      await page.evaluate(
        ([access, refresh]) => {
          localStorage.setItem("erp_token", access);
          localStorage.setItem("erp_refresh_token", refresh);
        },
        [roleSession.accessToken, roleSession.refreshToken]
      );
      return { page, session: roleSession };
    });

    await Promise.all(pages.map((page) => page.context().close()));
  },
});

export { expect };

// ─── Deterministic mass (step 5 of 10.3) ────────────────────────────────

export interface SellableProduct {
  id: string;
  name: string;
  sku: string;
  available: number;
}

/**
 * Available balance of a product row.
 *
 * Two names on purpose: `GET /products` answers `inventory` and
 * `GET /products/:id` answers `inventorySummary` — the same aggregate under two
 * keys. Reading only one of them silently returns 0 and an assertion on the
 * stock passes for the wrong reason. Registered as a contract finding; the
 * suite reads both until the API settles on one.
 */
function availableOf(product: Record<string, unknown>): number {
  const summary = (product.inventorySummary ?? product.inventory) as
    | { totalAvailable?: number }
    | undefined;
  return Number(summary?.totalAvailable ?? 0);
}

/**
 * A product with stock to sell, created if the base has none.
 *
 * Depending on whatever the previous run left behind is how a suite starts
 * failing for reasons unrelated to the code: the journeys here consume stock,
 * so the tenth run would find nothing to sell.
 */
export async function ensureSellableProduct(
  client: ApiClient,
  minimumStock = 5
): Promise<SellableProduct> {
  const listed = await client.get("/products?limit=50&status=ACTIVE");
  const products = (listed.body as { data?: Record<string, unknown>[] }).data ?? [];
  // Produto com variante não se vende sem dizer qual variante: o pedido sem
  // `variantId` não acha estoque e a reserva nunca acontece. As jornadas de
  // troca criam produtos assim, então eles aparecem nesta lista.
  const hasVariants = (p: Record<string, unknown>) =>
    Number((p._count as { variants?: number } | undefined)?.variants ?? 0) > 0;
  const existing = products.find((p) => !hasVariants(p) && availableOf(p) >= minimumStock);
  if (existing) {
    return {
      id: existing.id as string,
      name: existing.name as string,
      sku: existing.sku as string,
      available: availableOf(existing),
    };
  }

  const suffix = stamp();
  const created = await client.post("/products", {
    name: `E2E Produto ${suffix}`,
    sku: `E2E-${suffix}`,
    status: "ACTIVE",
    costPrice: 10,
    salePrice: 20,
  });
  expect(created.status, `criação do produto E2E: ${JSON.stringify(created.body)}`).toBe(201);
  const product = (created.body as { data: { id: string; name: string; sku: string } }).data;

  const warehouse = await ensureWarehouse(client);
  const entry = await client.post("/inventory/movement", {
    productId: product.id,
    type: "ENTRY",
    reason: "INITIAL",
    quantity: Math.max(minimumStock, 20),
    toWarehouseId: warehouse.id,
  });
  expect(entry.status, `estoque inicial: ${JSON.stringify(entry.body)}`).toBe(201);

  return { ...product, available: Math.max(minimumStock, 20) };
}

export async function ensureWarehouse(client: ApiClient): Promise<{ id: string; name: string }> {
  const listed = await client.get("/inventory/warehouses?limit=100");
  const warehouses =
    (listed.body as { data?: { id: string; name: string; isDefault: boolean; isActive?: boolean }[] })
      .data ?? [];
  const active = warehouses.filter((w) => w.isActive !== false);
  const chosen = active.find((w) => w.isDefault) ?? active[0];
  expect(chosen, "nenhum depósito ativo").toBeTruthy();
  return chosen!;
}

/** A customer created for this run, so no journey depends on seed data. */
export async function createCustomer(client: ApiClient): Promise<{ id: string; name: string }> {
  const suffix = stamp();
  const created = await client.post("/customers", {
    name: `E2E Cliente ${suffix}`,
    documentType: "CPF",
    document: makeCpf(),
    email: `e2e.${suffix}@exemplo.com`,
    phone: "(11) 98888-7777",
  });
  expect(created.status, `criação do cliente E2E: ${JSON.stringify(created.body)}`).toBe(201);
  return (created.body as { data: { id: string; name: string } }).data;
}

/** Current available balance of a product, for side-effect assertions. */
export async function productAvailable(client: ApiClient, productId: string): Promise<number> {
  const response = await client.get(`/products/${productId}`);
  const data = (response.body as { data?: Record<string, unknown> }).data ?? {};
  return availableOf(data);
}

/**
 * An open cash session, opened if there is none.
 *
 * `POST /orders` refuses a sale with no open register (SCRUM-30), so every
 * sales journey depends on this. Reusing an already-open session keeps the
 * suite re-runnable: opening a second one would trip FN-05's ambiguity rule.
 */
export async function ensureOpenCashSession(
  client: ApiClient
): Promise<{ sessionId: string; cashRegisterId: string }> {
  const open = await client.get("/cash-register-sessions?status=OPEN&limit=10");
  const sessions =
    (open.body as { data?: { id: string; cashRegisterId: string }[] }).data ?? [];
  if (sessions.length > 0) {
    return { sessionId: sessions[0].id, cashRegisterId: sessions[0].cashRegisterId };
  }

  // O caixa principal é o ativo mais antigo. A API lista do mais novo para o
  // mais antigo, então "o primeiro da lista" virava qualquer caixa criado por
  // outra jornada (o segundo caixa da troca) assim que um existisse.
  const registers = await client.get("/cash-registers?limit=50&isActive=true");
  const list = ((registers.body as { data?: { id: string; name: string; createdAt: string }[] }).data ?? [])
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  expect(list.length, "nenhum caixa cadastrado").toBeGreaterThan(0);

  const opened = await client.post(`/cash-registers/${list[0].id}/open`, {
    openingBalance: 200,
  });
  expect(opened.status, `abertura do caixa: ${JSON.stringify(opened.body)}`).toBe(201);
  const session = (opened.body as { data: { id: string } }).data;
  return { sessionId: session.id, cashRegisterId: list[0].id };
}

/**
 * Polls until `read()` satisfies `predicate`, or fails with the last value.
 *
 * Several side effects in this system are event-driven — the receivables of an
 * order are written by `order-events.handler` after the status change answers
 * 200. Reading once right after the mutation is a race that fails in CI and
 * passes locally, which is worse than no test at all.
 */
export async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  { timeout = 15_000, interval = 500, label = "condição" } = {}
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T = await read();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, interval));
    last = await read();
  }
  expect(predicate(last), `${label} não se estabilizou: ${JSON.stringify(last)}`).toBeTruthy();
  return last;
}
