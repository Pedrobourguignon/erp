/**
 * DS — auditoria transversal do design system.
 *
 * Escopo: o que é igual (ou deveria ser) em todas as telas — tokens, escala de
 * espaçamento, raio, altura de controle, tooltip em botão só-ícone, toast,
 * responsividade, dark mode, acessibilidade da shell e estados de carregamento.
 *
 * Read-only: nenhuma rota de escrita chega à API. As duas provas de toast usam
 * `page.route()` para responder à mutação **no navegador**, sem tocar no banco.
 */
import fs from "node:fs";
import path from "node:path";

import { test, expect, authenticate, captureNoise, visit, measure, apiLogin, API_URL } from "./qa-fixtures";
import type { Measurements } from "./qa-fixtures";
import type { Page } from "@playwright/test";

// ─── Saída ──────────────────────────────────────────────────────────────

const OUT = path.resolve(__dirname, "artifacts/ds");
fs.mkdirSync(OUT, { recursive: true });
const dump = (name: string, data: unknown) =>
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(data, null, 2));
const shot = (name: string) => path.join(OUT, `${name}.png`);

// ─── Rotas ──────────────────────────────────────────────────────────────

/** Todas as rotas do dashboard (lib/nav-items.ts + app/(dashboard)/**\/page.tsx). */
const STATIC_ROUTES = [
  "/",
  "/estoque",
  "/estoque/produtos",
  "/estoque/categorias",
  "/estoque/marcas",
  "/estoque/movimentacoes",
  "/estoque/depositos",
  "/estoque/alertas",
  "/estoque/produtos/novo",
  "/vendas",
  "/vendas/pedidos",
  "/vendas/pedidos/novo",
  "/vendas/balcao",
  "/clientes",
  "/clientes/novo",
  "/financeiro",
  "/financeiro/contas",
  "/financeiro/lancamentos",
  "/financeiro/caixa",
  "/configuracoes",
  "/configuracoes/condicoes-pagamento",
  "/configuracoes/metodos-pagamento",
  "/configuracoes/perfil",
];

/** Rotas de detalhe, resolvidas com ids reais da API (leitura pura). */
async function detailRoutes(): Promise<string[]> {
  const session = await apiLogin("owner");
  const h = { Authorization: `Bearer ${session.accessToken}` };
  const one = async (endpoint: string, prefix: string, suffix = "") => {
    try {
      const r = await fetch(`${API_URL}${endpoint}?page=1&limit=1`, { headers: h });
      if (!r.ok) return [];
      const b = (await r.json()) as { data?: unknown };
      const rows = (Array.isArray(b.data) ? b.data : (b.data as { data?: unknown[] })?.data) as
        | { id: string }[]
        | undefined;
      const id = rows?.[0]?.id;
      return id ? [`${prefix}/${id}${suffix}`] : [];
    } catch {
      return [];
    }
  };
  return [
    ...(await one("/products", "/estoque/produtos")),
    ...(await one("/products", "/estoque/produtos", "/edit")),
    ...(await one("/customers", "/clientes")),
    ...(await one("/customers", "/clientes", "/edit")),
    ...(await one("/orders", "/vendas/pedidos")),
  ];
}

let ALL_ROUTES: string[] = [];

test.beforeAll(async () => {
  ALL_ROUTES = [...STATIC_ROUTES, ...(await detailRoutes())];
  dump("routes", ALL_ROUTES);
});

// ─── Helpers próprios ───────────────────────────────────────────────────

export interface Geometry {
  h1: { text: string; fontSize: string; fontWeight: string; lineHeight: string; fontFamily: string } | null;
  /** Altura do bloco de cabeçalho da página — do topo do container até o fim do subtítulo. */
  headerBlockHeight: number | null;
  headerBottomMargin: string | null;
  /** `space-y-*` do container da página: margin-top do 2º filho direto. */
  contentRhythm: string | null;
  headingTags: string[];
  cards: { radius: string; borderWidth: string; borderColor: string; padding: string }[];
  buttons: { h: number; radius: string; label: string }[];
  inputs: { h: number; radius: string }[];
  selects: { h: number; radius: string }[];
  gridGaps: string[];
  loading: { skeleton: number; spinner: number };
}

async function geometry(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const vis = (el: Element) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
    };
    const uniq = <T,>(a: T[], k: (x: T) => string) => {
      const s = new Set<string>();
      return a.filter((x) => (s.has(k(x)) ? false : (s.add(k(x)), true)));
    };

    const main = document.querySelector("main") ?? document.body;
    const h1El = main.querySelector("h1");
    const h1 = h1El
      ? (() => {
          const cs = getComputedStyle(h1El);
          return {
            text: (h1El.textContent || "").trim().slice(0, 40),
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            fontFamily: cs.fontFamily.split(",")[0].replace(/"/g, ""),
          };
        })()
      : null;

    // O "cabeçalho de página" é o ancestral do h1 que é filho direto do wrapper
    // do conteúdo — é o bloco cuja altura o usuário percebe como topo da tela.
    let headerBlockHeight: number | null = null;
    let headerBottomMargin: string | null = null;
    if (h1El) {
      // Sobe até o filho direto do container da página (o irmão 0 do `space-y-*`).
      let n: HTMLElement = h1El;
      while (
        n.parentElement &&
        n.parentElement !== main &&
        !n.parentElement.classList.contains("max-w-[1600px]") &&
        !(n.parentElement.className || "").toString().includes("space-y-")
      ) {
        n = n.parentElement;
      }
      headerBlockHeight = +n.getBoundingClientRect().height.toFixed(1);
      headerBottomMargin = getComputedStyle(n).marginBottom;
    }

    // `space-y-*`: o Tailwind aplica margin-top no irmão seguinte.
    const pageRoot = main.querySelector(".max-w-\\[1600px\\]")?.lastElementChild as HTMLElement | null;
    const second = pageRoot?.children[1] as HTMLElement | null;
    const contentRhythm = second ? getComputedStyle(second).marginTop : null;

    const headingTags = Array.from(main.querySelectorAll("h1,h2,h3"))
      .slice(0, 6)
      .map((h) => `${h.tagName}:${(h.textContent || "").trim().slice(0, 22)}`);

    // Card = o primitivo `components/ui/card.tsx`: bg-card + borda + raio.
    const cards = uniq(
      Array.from(main.querySelectorAll<HTMLElement>("div")).filter((el) => {
        if (!vis(el)) return false;
        const cs = getComputedStyle(el);
        return (
          parseFloat(cs.borderTopWidth) > 0 &&
          parseFloat(cs.borderTopLeftRadius) >= 4 &&
          cs.backgroundColor !== "rgba(0, 0, 0, 0)" &&
          el.getBoundingClientRect().height > 40
        );
      }).map((el) => {
        const cs = getComputedStyle(el);
        // padding do próprio card, ou do primeiro filho com padding (CardHeader/Content)
        let padding = `${cs.paddingTop} ${cs.paddingLeft}`;
        if (parseFloat(cs.paddingTop) === 0) {
          const child = Array.from(el.children).find((c) => parseFloat(getComputedStyle(c).paddingTop) > 0);
          if (child) {
            const ccs = getComputedStyle(child);
            padding = `${ccs.paddingTop} ${ccs.paddingLeft}`;
          }
        }
        return {
          radius: cs.borderTopLeftRadius,
          borderWidth: cs.borderTopWidth,
          borderColor: cs.borderTopColor,
          padding,
        };
      }),
      (c) => `${c.radius}|${c.borderWidth}|${c.borderColor}|${c.padding}`
    );

    const btns = uniq(
      Array.from(main.querySelectorAll<HTMLElement>("button")).filter(vis).map((el) => {
        const cs = getComputedStyle(el);
        return {
          h: +el.getBoundingClientRect().height.toFixed(1),
          radius: cs.borderTopLeftRadius,
          label: (el.textContent || "").trim().slice(0, 24) || "(ícone)",
        };
      }),
      (b) => `${b.h}|${b.radius}`
    );

    const inputs = uniq(
      Array.from(main.querySelectorAll<HTMLElement>("input:not([type=checkbox]):not([type=radio]):not([type=hidden])"))
        .filter(vis)
        .map((el) => ({
          h: +el.getBoundingClientRect().height.toFixed(1),
          radius: getComputedStyle(el).borderTopLeftRadius,
        })),
      (i) => `${i.h}|${i.radius}`
    );

    const selects = uniq(
      Array.from(main.querySelectorAll<HTMLElement>("[role=combobox], select")).filter(vis).map((el) => ({
        h: +el.getBoundingClientRect().height.toFixed(1),
        radius: getComputedStyle(el).borderTopLeftRadius,
      })),
      (s) => `${s.h}|${s.radius}`
    );

    const gridGaps = Array.from(
      new Set(
        Array.from(main.querySelectorAll<HTMLElement>("*"))
          .filter((el) => vis(el) && getComputedStyle(el).display === "grid")
          .map((el) => getComputedStyle(el).gap)
          .filter((g) => g && g !== "normal" && !g.startsWith("0px"))
      )
    );

    return {
      h1,
      headerBlockHeight,
      headerBottomMargin,
      contentRhythm,
      headingTags,
      cards,
      buttons: btns,
      inputs,
      selects,
      gridGaps,
      loading: {
        skeleton: main.querySelectorAll(".animate-pulse").length,
        spinner: main.querySelectorAll(".animate-spin").length,
      },
    };
  });
}

/** Botões só-ícone: têm svg e nenhum texto visível (sr-only não conta como visível). */
async function iconOnlyButtons(page: Page) {
  return page.evaluate(() => {
    const out: {
      sig: string;
      selectorIndex: number;
      ariaLabel: string | null;
      title: string | null;
      srOnly: string | null;
      radixTooltipTrigger: boolean;
      w: number;
      h: number;
      area: string;
    }[] = [];
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("button, a[href]"));
    nodes.forEach((el, i) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === "none" || cs.visibility === "hidden" || r.width === 0) return;
      if (!el.querySelector("svg")) return;
      // texto visível = textContent menos o que está em .sr-only
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".sr-only").forEach((n) => n.remove());
      if ((clone.textContent || "").trim().length > 0) return;

      const srOnly = el.querySelector(".sr-only")?.textContent?.trim() ?? null;
      const iconSig =
        el.querySelector("svg")?.getAttribute("class")?.slice(0, 40) +
        "|" +
        (el.querySelector("svg path,svg line,svg circle,svg polyline,svg rect")?.getAttribute("d")?.slice(0, 24) ?? "");
      out.push({
        sig: `${el.tagName}|${(el.className || "").toString().slice(0, 60)}|${iconSig}`,
        selectorIndex: i,
        ariaLabel: el.getAttribute("aria-label"),
        title: el.getAttribute("title"),
        srOnly,
        // Radix Tooltip.Trigger sempre carrega data-state
        radixTooltipTrigger: el.hasAttribute("data-state") && !el.hasAttribute("aria-haspopup"),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1),
        area: el.closest("header")
          ? "header"
          : el.closest("aside")
            ? "sidebar"
            : el.closest("table")
              ? "tabela"
              : el.closest("[role=dialog]")
                ? "dialog"
                : "conteúdo",
      });
    });
    return out;
  });
}

/**
 * `visit()` espera um tempo fixo; em dev o Next compila a rota na primeira
 * visita e telas inteiras ainda estavam em branco aos 2 s — medir ali daria um
 * relatório inteiro de falsos negativos. Aqui a espera é pelo conteúdo.
 */
async function settle(page: Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page
    .waitForFunction(
      () => {
        const m = document.querySelector("main");
        if (!m) return false;
        if (m.querySelector(".animate-spin")) return false;
        const text = (m.textContent || "").trim();
        return text.length > 120 || !!m.querySelector("h1");
      },
      undefined,
      { timeout: 25_000 }
    )
    .catch(() => undefined);
  await page.waitForTimeout(900);
}

const summarize = (m: Measurements) => ({
  overflow: m.horizontalOverflow,
  docW: `${m.docScrollWidth}/${m.docClientWidth}`,
  clipped: m.clippedNoScroll.length,
  small: m.smallHitTargets.length,
  odd: m.oddSpacing.length,
  contrast: m.lowContrast.length,
  hardcoded: m.hardcodedColors.length,
  noFocus: m.missingFocusRing.length,
  radius: m.inconsistentRadius.length,
});

// ════════════════════════════════════════════════════════════════════════
// 1. Inventário de inconsistência — 1440, claro, owner
// ════════════════════════════════════════════════════════════════════════

test("DS-inv: inventário de tokens/espaçamento/contraste em todas as rotas", async ({ page }) => {
  test.setTimeout(600_000);
  const noise = captureNoise(page);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const table: Record<string, ReturnType<typeof summarize>> = {};
  const detail: Record<string, Measurements> = {};
  const geo: Record<string, Geometry> = {};

  for (const route of ALL_ROUTES) {
    await settle(page, route);
    const m = await measure(page);
    table[route] = summarize(m);
    detail[route] = m;
    geo[route] = await geometry(page);
  }

  dump("inventory-table", table);
  dump("inventory-detail", detail);
  dump("geometry-light-1440", geo);
  dump("inventory-noise", noise);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(table, null, 1));
});

// ════════════════════════════════════════════════════════════════════════
// 2. Deriva entre telas equivalentes
// ════════════════════════════════════════════════════════════════════════

test("DS-drift: cabeçalho, card, input, botão e h1 medidos rota a rota", async ({ page }) => {
  test.setTimeout(600_000);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const rows: Record<string, unknown> = {};
  for (const route of ALL_ROUTES) {
    await settle(page, route);
    const g = await geometry(page);
    rows[route] = {
      h1: g.h1 ? `${g.h1.fontSize}/${g.h1.fontWeight} ${g.h1.fontFamily}` : "— (sem h1)",
      header: g.headerBlockHeight,
      headerMb: g.headerBottomMargin,
      rhythm: g.contentRhythm,
      headings: g.headingTags.join(" › "),
      cardRadius: Array.from(new Set(g.cards.map((c) => c.radius))).join(","),
      cardBorder: Array.from(new Set(g.cards.map((c) => `${c.borderWidth} ${c.borderColor}`))).join(" | "),
      cardPad: Array.from(new Set(g.cards.map((c) => c.padding))).join(" | "),
      btnH: Array.from(new Set(g.buttons.map((b) => b.h))).sort((a, b) => a - b).join(","),
      btnRadius: Array.from(new Set(g.buttons.map((b) => b.radius))).join(","),
      inputH: Array.from(new Set(g.inputs.map((i) => i.h))).join(","),
      selectH: Array.from(new Set(g.selects.map((s) => s.h))).join(","),
      gridGap: g.gridGaps.join(","),
    };
  }
  dump("drift", rows);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(rows, null, 1));
});

// Screenshot lado a lado: mesmo primitivo em duas telas equivalentes.
test("DS-drift-shots: comparativos do mesmo componente em telas equivalentes", async ({ page }) => {
  test.setTimeout(300_000);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const pairs: [string, string][] = [
    ["/estoque/produtos", "header-produtos"],
    ["/clientes", "header-clientes"],
    ["/financeiro/contas", "header-contas"],
    ["/configuracoes/metodos-pagamento", "header-metodos"],
    ["/vendas/pedidos", "header-pedidos"],
  ];
  for (const [route, name] of pairs) {
    await settle(page, route);
    await page.screenshot({ path: shot(`cmp-${name}`), clip: { x: 264, y: 64, width: 1176, height: 320 } });
  }
});

// ════════════════════════════════════════════════════════════════════════
// 3. Tooltips e botões só-ícone
// ════════════════════════════════════════════════════════════════════════

test("DS-tip: todo botão só-ícone tem tooltip ou aria-label", async ({ page }) => {
  test.setTimeout(900_000);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const seen = new Set<string>();
  const offenders: Record<string, unknown[]> = {};
  const census: Record<string, number> = {};

  for (const route of ALL_ROUTES) {
    await settle(page, route);
    const buttons = await iconOnlyButtons(page);
    census[route] = buttons.length;

    for (const b of buttons) {
      if (seen.has(b.sig)) continue;
      seen.add(b.sig);
      if (b.ariaLabel || b.title || b.srOnly) continue;

      // hover de verdade: o tooltip do Radix só existe depois do delay.
      const loc = page.locator("button, a[href]").nth(b.selectorIndex);
      let tipText: string | null = null;
      // Duas tentativas: o Radix só monta o conteúdo depois de `delayDuration`,
      // e o portal usa `[data-radix-popper-content-wrapper]`, não só `role=tooltip`.
      for (let attempt = 0; attempt < 2 && !tipText; attempt++) {
        try {
          await page.mouse.move(0, 0);
          await page.waitForTimeout(200);
          await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
          await loc.hover({ timeout: 2000, force: true });
          await page.waitForTimeout(900);
          const tip = page.locator('[role="tooltip"], [data-radix-popper-content-wrapper]');
          const n = await tip.count();
          for (let i = 0; i < n; i++) {
            if (await tip.nth(i).isVisible().catch(() => false)) {
              const t = (await tip.nth(i).innerText().catch(() => "")).trim();
              if (t) {
                tipText = t;
                break;
              }
            }
          }
        } catch {
          /* elemento saiu da tela */
        }
      }
      if (!tipText) {
        (offenders[route] ??= []).push({ ...b, tipText });
      }
      await page.mouse.move(0, 0);
    }
  }
  dump("icon-buttons-census", census);
  dump("icon-buttons-offenders", offenders);
  // eslint-disable-next-line no-console
  console.log("SEM RÓTULO:", JSON.stringify(offenders, null, 1));
});

/**
 * O tooltip é visual; o nome acessível não vem dele. Radix liga o conteúdo por
 * `aria-describedby` (descrição), nunca por `aria-labelledby` (nome) — então um
 * botão só-ícone envolto em `<Tooltip>` continua se anunciando como "botão".
 */
test("DS-tip-name: botão só-ícone com tooltip tem nome acessível?", async ({ page }) => {
  test.setTimeout(300_000);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const out: Record<string, unknown> = {};
  for (const route of ["/estoque/produtos", "/clientes", "/estoque/categorias", "/estoque/marcas", "/vendas/pedidos"]) {
    await settle(page, route);
    out[route] = {
      // Nomes que o tooltip promete; a role query só acha se houver nome acessível.
      porNomeVerDetalhes: await page.getByRole("button", { name: /ver detalhes/i }).count(),
      porNomeEditar: await page.getByRole("button", { name: /^editar$/i }).count(),
      porNomeExcluir: await page.getByRole("button", { name: /^excluir$/i }).count(),
      // E quantos botões só-ícone existem de fato na tabela
      iconButtonsNaTabela: await page.evaluate(
        () =>
          Array.from(document.querySelectorAll("main table button")).filter((b) => {
            const c = b.cloneNode(true) as HTMLElement;
            c.querySelectorAll(".sr-only").forEach((n) => n.remove());
            return !!b.querySelector("svg") && (c.textContent || "").trim() === "";
          }).length
      ),
      semNomeAcessivel: await page.evaluate(
        () =>
          Array.from(document.querySelectorAll("main button")).filter((b) => {
            const c = b.cloneNode(true) as HTMLElement;
            c.querySelectorAll(".sr-only").forEach((n) => n.remove());
            return (
              !!b.querySelector("svg") &&
              (c.textContent || "").trim() === "" &&
              !b.getAttribute("aria-label") &&
              !b.getAttribute("title") &&
              !b.querySelector(".sr-only")
            );
          }).length
      ),
    };
  }
  dump("tooltip-accessible-name", out);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 1));
});

test("DS-tip-empty: Tooltip com content vazio some sem deixar rastro", async ({ page }) => {
  await authenticate(page);
  // Prova estática do contrato: o primitivo devolve os children crus.
  // O caso vivo é `<Can mode="disable">` — o tooltip explicando o 403.
  await visit(page, "/estoque/produtos", 2500);
  const disabled = await page.locator('[data-testid="permission-disabled"]').count();
  dump("tooltip-empty", { permissionDisabledWrappers: disabled });
  expect(typeof disabled).toBe("number");
});

test("DS-tip-perm: controle desabilitado por permissão explica o porquê (seller)", async ({ page, browser }) => {
  test.setTimeout(400_000);
  const routes = ["/estoque/produtos", "/clientes", "/vendas/pedidos", "/estoque/categorias", "/estoque/marcas"];

  // Referência: o mesmo cabeçalho como owner, para saber o que sumiu.
  const ownerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
  const op = await ownerCtx.newPage();
  await authenticate(op, "owner");
  const ownerButtons: Record<string, string[]> = {};
  for (const route of routes) {
    await settle(op, route);
    ownerButtons[route] = await op.evaluate(() =>
      Array.from(document.querySelectorAll("main > div > div:first-child button, main button"))
        .map((b) => (b.textContent || "").trim())
        .filter((t) => t.length > 1)
    );
  }
  await ownerCtx.close();

  await authenticate(page, "seller");
  await page.setViewportSize({ width: 1440, height: 900 });

  const report: Record<string, unknown> = {};
  for (const route of routes) {
    await settle(page, route);
    const sellerButtons = await page.evaluate(() =>
      Array.from(document.querySelectorAll("main button"))
        .map((b) => (b.textContent || "").trim())
        .filter((t) => t.length > 1)
    );
    const sumiram = ownerButtons[route].filter((t) => !sellerButtons.includes(t));
    const wrappers = page.locator('[data-testid="permission-disabled"]');
    const n = await wrappers.count();
    let tip: string | null = null;
    if (n > 0) {
      await wrappers.first().hover();
      await page.waitForTimeout(500);
      const t = page.locator('[role="tooltip"]');
      if ((await t.count()) > 0) tip = (await t.first().innerText()).trim();
    }
    // Botões desabilitados que NÃO passaram pelo <Can mode="disable">
    const orphanDisabled = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("main button[disabled]"))
        .filter((el) => !el.closest('[data-testid="permission-disabled"]'))
        .map((el) => ({
          text: (el.textContent || "").trim().slice(0, 30),
          ariaLabel: el.getAttribute("aria-label"),
          title: el.getAttribute("title"),
        }))
    );
    report[route] = {
      canDisableWrappers: n,
      tooltip: tip,
      orphanDisabled,
      // O que existia para o owner e simplesmente não existe para o seller —
      // sem tooltip, sem estado desabilitado, sem explicação.
      sumiramSemExplicacao: Array.from(new Set(sumiram)),
    };
    await page.screenshot({ path: shot(`seller-${route.replace(/\//g, "_")}`), fullPage: false });
  }
  dump("permission-disabled", report);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 1));
});

// ════════════════════════════════════════════════════════════════════════
// 4. Toasts
// ════════════════════════════════════════════════════════════════════════

/**
 * Prova do AE-10 sem escrever nada: a requisição da mutação é respondida pelo
 * próprio navegador com um 500. Uma tela que passa por `getMutationErrorMessage`
 * troca isso por um fallback legível; uma que usa só `getApiErrorMessage`
 * entrega o texto cru do servidor ao usuário.
 */
test("DS-toast-ae10: 500 na mutação — fallback legível vs. texto cru do backend", async ({ page }) => {
  test.setTimeout(300_000);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const stub = async (urlPart: string) => {
    await page.route((u) => u.pathname.includes(urlPart), async (route) => {
      if (route.request().method() === "POST" || route.request().method() === "PATCH") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ statusCode: 500, message: "Internal server error" }),
        });
        return;
      }
      await route.continue();
    });
  };

  const result: Record<string, unknown> = {};

  // (a) Marcas — usa getMutationErrorMessage (app/(dashboard)/estoque/marcas/page.tsx:141)
  await visit(page, "/estoque/marcas", 2500);
  await stub("/brands");
  await page.getByRole("button", { name: /nova marca|adicionar marca|nova/i }).first().click();
  await page.waitForTimeout(600);
  await page.locator('input[name="name"], #name').first().fill("QA DS teste (não salva)");
  await page.getByRole("button", { name: /^(salvar|criar|cadastrar)/i }).first().click();
  await page.waitForTimeout(1200);
  result.marcas = await page.evaluate(() =>
    Array.from(document.querySelectorAll("body > div > div"))
      .map((n) => (n.textContent || "").trim())
      .filter((t) => t.length > 0 && t.length < 200)
  );
  const toastA = page.locator("p.flex-1.text-sm").last();
  result.marcasToast = (await toastA.count()) ? (await toastA.innerText()).trim() : null;
  await page.screenshot({ path: shot("toast-ae10-a-marcas") });
  await page.unroute((u) => u.pathname.includes("/brands"));

  // (b) Perfil — usa só getApiErrorMessage
  //     (app/(dashboard)/configuracoes/perfil/_components/profile-form.tsx:62)
  //     O formulário já vem preenchido e válido: um clique em Salvar basta.
  await settle(page, "/configuracoes/perfil");
  await stub("/users/me");
  await page.getByRole("button", { name: /^salvar/i }).first().click();
  await page.waitForTimeout(1500);
  const toastB = page.locator("p.flex-1.text-sm").last();
  result.perfilToast = (await toastB.count()) ? (await toastB.innerText()).trim() : null;
  await page.screenshot({ path: shot("toast-ae10-b-perfil") });
  await page.unroute((u) => u.pathname.includes("/users/me"));

  dump("toast-ae10", result);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 1));
});

test("DS-toast-anatomy: duração, empilhamento, contraste, aria-live e fechar", async ({ page }) => {
  test.setTimeout(300_000);
  await authenticate(page);
  await visit(page, "/", 2000);

  // Dispara toasts pelo React não é possível de fora; usamos a mesma prova do
  // AE-10 (stub 500) três vezes para ver o empilhamento.
  await visit(page, "/estoque/marcas", 2500);
  await page.route((u) => u.pathname.includes("/brands"), async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ statusCode: 409, message: "Já existe uma marca com este nome" }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: /nova marca|adicionar|nova/i }).first().click();
  await page.waitForTimeout(600);
  await page.locator('input[name="name"], #name').first().fill("QA DS teste");

  const submit = page.getByRole("button", { name: /^(salvar|criar|cadastrar)/i }).first();
  for (let i = 0; i < 3; i++) {
    await submit.click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(300);

  const anatomy = await page.evaluate(() => {
    const container = document.querySelector("body > div.fixed.bottom-4.right-4") as HTMLElement | null;
    const items = container ? Array.from(container.children) as HTMLElement[] : [];
    const contrast = (fg: string, bg: string) => {
      const lum = (c: string) => {
        const m = c.match(/[\d.]+/g);
        if (!m) return 0;
        const [r, g, b] = m.map(Number);
        const f = (v: number) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const [a, b2] = [lum(fg), lum(bg)];
      return +((Math.max(a, b2) + 0.05) / (Math.min(a, b2) + 0.05)).toFixed(2);
    };
    return {
      containerRole: container?.getAttribute("role") ?? null,
      containerAriaLive: container?.getAttribute("aria-live") ?? null,
      stacked: items.length,
      items: items.map((el) => {
        const cs = getComputedStyle(el);
        const p = el.querySelector("p");
        const btn = el.querySelector("button");
        const br = btn?.getBoundingClientRect();
        return {
          text: (p?.textContent || "").trim(),
          bg: cs.backgroundColor,
          fg: p ? getComputedStyle(p).color : null,
          ratio: p ? contrast(getComputedStyle(p).color, cs.backgroundColor) : null,
          radius: cs.borderTopLeftRadius,
          closeBtn: btn
            ? { w: +(br?.width ?? 0).toFixed(1), h: +(br?.height ?? 0).toFixed(1), ariaLabel: btn.getAttribute("aria-label") }
            : null,
          icon: el.querySelector("svg")?.getAttribute("class")?.slice(0, 60) ?? null,
        };
      }),
    };
  });
  await page.screenshot({ path: shot("toast-stack") });

  // duração: o toast se apaga sozinho?
  const before = anatomy.stacked;
  await page.waitForTimeout(4600);
  const after = await page.evaluate(
    () => (document.querySelector("body > div.fixed.bottom-4.right-4")?.children.length ?? 0)
  );
  dump("toast-anatomy", { ...anatomy, before, afterAutoDismiss: after });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ...anatomy, before, afterAutoDismiss: after }, null, 1));
});

test("DS-toast-dark: toast no tema escuro", async ({ page }) => {
  test.setTimeout(200_000);
  await authenticate(page, "owner", "dark");
  await visit(page, "/estoque/marcas", 2500);
  await page.route((u) => u.pathname.includes("/brands"), async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ statusCode: 409, message: "Já existe uma marca com este nome" }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: /nova marca|adicionar|nova/i }).first().click();
  await page.waitForTimeout(600);
  await page.locator('input[name="name"], #name').first().fill("QA DS teste");
  await page.getByRole("button", { name: /^(salvar|criar|cadastrar)/i }).first().click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: shot("toast-dark") });
  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  dump("toast-dark", { isDark });
});

// ════════════════════════════════════════════════════════════════════════
// 5. Responsividade
// ════════════════════════════════════════════════════════════════════════

for (const width of [390, 768, 1024]) {
  test(`DS-rwd-${width}: varredura de overflow e corte em ${width}px`, async ({ page }) => {
    test.setTimeout(900_000);
    await authenticate(page);
    await page.setViewportSize({ width, height: 900 });

    const table: Record<string, unknown> = {};
    for (const route of ALL_ROUTES) {
      await settle(page, route);
      const m = await measure(page);
      const extra = await page.evaluate(() => {
        const main = document.querySelector("main");
        const tables = Array.from(document.querySelectorAll("table")).map((t) => {
          const wrap = t.closest("div");
          const wcs = wrap ? getComputedStyle(wrap) : null;
          return {
            scrolls: !!wrap && wrap.scrollWidth > wrap.clientWidth,
            overflowX: wcs?.overflowX ?? null,
            tableW: t.scrollWidth,
            wrapW: wrap?.clientWidth ?? null,
          };
        });
        return {
          mainScroll: main ? { sw: main.scrollWidth, cw: main.clientWidth } : null,
          tables,
          menuButton: !!document.querySelector('header button[aria-label="Abrir menu"]'),
          menuButtonVisible: (() => {
            const b = document.querySelector('header button[aria-label="Abrir menu"]');
            return b ? getComputedStyle(b).display !== "none" : false;
          })(),
          sidebarVisible: (() => {
            const a = document.querySelector("aside");
            if (!a) return false;
            const r = a.getBoundingClientRect();
            return r.left > -10 && r.width > 0;
          })(),
        };
      });
      table[route] = { ...summarize(m), ...extra, clippedEls: m.clippedNoScroll.slice(0, 5) };
    }
    dump(`responsive-${width}`, table);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(table, null, 1));
  });
}

/**
 * 390×667 é o iPhone SE — o menor aparelho que ainda importa. Em 390×844 os
 * diálogos sem `max-h` ainda cabem por sorte; a régua tem que ser o pior caso
 * real, não o melhor.
 */
test("DS-rwd-dialog: dialog cabe na tela em 390px (max-h/rodapé alcançável)", async ({ page }) => {
  test.setTimeout(300_000);
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 667 });

  const cases: { route: string; open: RegExp }[] = [
    { route: "/estoque/marcas", open: /marca/i },
    { route: "/estoque/categorias", open: /categoria/i },
    { route: "/estoque/depositos", open: /dep[óo]sito/i },
    { route: "/financeiro/contas", open: /conta/i },
    { route: "/financeiro/lancamentos", open: /lan[çc]amento/i },
    { route: "/configuracoes/metodos-pagamento", open: /m[ée]todo/i },
    { route: "/configuracoes/condicoes-pagamento", open: /condi[çc]/i },
  ];
  const out: Record<string, unknown> = {};
  for (const c of cases) {
    await settle(page, c.route);
    const btn = page.getByRole("button", { name: c.open }).first();
    if (!(await btn.count())) {
      out[c.route] = "botão não encontrado";
      continue;
    }
    await btn.click().catch(() => undefined);
    await page.waitForTimeout(800);
    out[c.route] = await page.evaluate(() => {
      const d =
        (document.querySelector('[role="dialog"]') as HTMLElement | null) ??
        (document.querySelector(".fixed.inset-0.z-50 > .relative") as HTMLElement | null);
      if (!d) return "sem dialog";
      const cs = getComputedStyle(d);
      const r = d.getBoundingClientRect();
      const footer = d.querySelector("form > div:last-child, div:last-child") as HTMLElement | null;
      return {
        maxHeight: cs.maxHeight,
        overflowY: cs.overflowY,
        height: +r.height.toFixed(1),
        viewport: window.innerHeight,
        overflowsViewport: r.height > window.innerHeight,
        bottomOffscreen: +(r.bottom - window.innerHeight).toFixed(1),
        footerBottom: footer ? +footer.getBoundingClientRect().bottom.toFixed(1) : null,
        radius: cs.borderTopLeftRadius,
      };
    });
    await page.screenshot({ path: shot(`dialog390-${c.route.replace(/\//g, "_")}`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  dump("dialog-390", out);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 1));
});

// ════════════════════════════════════════════════════════════════════════
// 6. Dark mode
// ════════════════════════════════════════════════════════════════════════

test("DS-dark: varredura completa no tema escuro", async ({ page }) => {
  test.setTimeout(900_000);
  const noise = captureNoise(page);
  await authenticate(page, "owner", "dark");
  await page.setViewportSize({ width: 1440, height: 900 });

  const table: Record<string, unknown> = {};
  const detail: Record<string, Measurements> = {};
  for (const route of ALL_ROUTES) {
    await settle(page, route);
    const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    const m = await measure(page);
    // bordas que somem: contraste borda × fundo do card
    const borders = await page.evaluate(() => {
      const lum = (c: string) => {
        const m2 = c.match(/[\d.]+/g);
        if (!m2) return null;
        const [r, g, b, a = 1] = m2.map(Number);
        if (a < 0.2) return null;
        const f = (v: number) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const seen = new Set<string>();
      const out: { border: string; bg: string; ratio: number }[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("main *"))) {
        const cs = getComputedStyle(el);
        if (parseFloat(cs.borderTopWidth) === 0) continue;
        const parentBg = getComputedStyle(el.parentElement ?? document.body).backgroundColor;
        const l1 = lum(cs.borderTopColor);
        const l2 = lum(cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? cs.backgroundColor : parentBg);
        if (l1 === null || l2 === null) continue;
        const ratio = +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05))).toFixed(2);
        const k = `${cs.borderTopColor}|${cs.backgroundColor}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (ratio < 1.25) out.push({ border: cs.borderTopColor, bg: cs.backgroundColor, ratio });
      }
      return out.slice(0, 10);
    });
    table[route] = { dark, ...summarize(m), invisibleBorders: borders.length };
    detail[route] = m;
    (table[route] as Record<string, unknown>).borderSamples = borders.slice(0, 3);
    (table[route] as Record<string, unknown>).contrastSamples = m.lowContrast.slice(0, 4);
  }
  dump("dark-table", table);
  dump("dark-detail", detail);
  dump("dark-noise", noise);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(table, null, 1));
});

test("DS-dark-shots: pares claro/escuro das telas de referência", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const routes = ["/", "/estoque/produtos", "/financeiro/contas", "/vendas/balcao"];
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const r of routes) {
    await visit(page, r, 2500);
    await page.screenshot({ path: shot(`light-${r.replace(/\//g, "_") || "root"}`) });
  }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
  const dp = await ctx.newPage();
  await authenticate(dp, "owner", "dark");
  for (const r of routes) {
    await visit(dp, r, 2500);
    await dp.screenshot({ path: shot(`dark-${r.replace(/\//g, "_") || "root"}`) });
  }
  await ctx.close();
});

// ════════════════════════════════════════════════════════════════════════
// 7. Acessibilidade transversal
// ════════════════════════════════════════════════════════════════════════

test("DS-a11y-shell: skip link, ordem de tabulação, aria-current, landmarks", async ({ page }) => {
  test.setTimeout(300_000);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page, "/estoque/produtos", 2800);

  const landmarks = await page.evaluate(() => ({
    skipLink: !!document.querySelector('a[href^="#"][class*="sr-only"], a[href="#main"], a[href="#conteudo"]'),
    mainId: document.querySelector("main")?.id || null,
    navAriaLabel: document.querySelector("aside nav")?.getAttribute("aria-label") ?? null,
    headerTag: !!document.querySelector("header"),
    ariaCurrentCount: document.querySelectorAll("aside [aria-current]").length,
    activeNavItems: Array.from(document.querySelectorAll("aside a, aside button"))
      .filter((el) => (el.className || "").toString().includes("bg-white/[0.08]"))
      .map((el) => ({
        text: (el.textContent || "").trim().slice(0, 24),
        ariaCurrent: el.getAttribute("aria-current"),
      })),
  }));

  // Ordem de tabulação a partir do topo
  const order: string[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    order.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return "—";
        const area = el.closest("aside") ? "sidebar" : el.closest("header") ? "header" : el.closest("main") ? "main" : "?";
        return `${area}:${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}`;
      })
    );
  }

  const tableSemantics = await page.evaluate(() => {
    const t = document.querySelector("main table");
    if (!t) return null;
    return {
      role: t.getAttribute("role"),
      ariaLabel: t.getAttribute("aria-label"),
      caption: !!t.querySelector("caption"),
      thScope: Array.from(t.querySelectorAll("th")).filter((th) => th.hasAttribute("scope")).length,
      thTotal: t.querySelectorAll("th").length,
      sortableThRole: Array.from(t.querySelectorAll("th")).filter((th) => th.getAttribute("role") === "button" || th.hasAttribute("tabindex")).length,
      ariaSort: t.querySelectorAll("[aria-sort]").length,
      checkboxNoLabel: Array.from(t.querySelectorAll('input[type="checkbox"]')).filter(
        (c) => !c.getAttribute("aria-label") && !c.closest("label")
      ).length,
    };
  });

  dump("a11y-shell", { landmarks, tabOrder: order, tableSemantics });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ landmarks, tabOrder: order, tableSemantics }, null, 1));
});

/**
 * `measure()` marca `missingFocusRing` pela ausência da classe `focus-visible:`.
 * Isto aqui confirma no navegador: foca de verdade e lê o outline/box-shadow
 * computados — sem isso o achado seria heurística, não medição.
 */
test("DS-a11y-focus: anel de foco real (outline computado) nos controles da shell", async ({ page }) => {
  test.setTimeout(200_000);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await visit(page, "/estoque/produtos", 2800);

  const probes: { name: string; selector: string }[] = [
    { name: "sidebar/link Dashboard", selector: 'aside a[href="/"]' },
    { name: "sidebar/grupo Estoque", selector: "aside button:has-text('Estoque')" },
    { name: "sidebar/filho Produtos", selector: 'aside a[href="/estoque/produtos"]' },
    { name: "header/tema", selector: "header button:nth-of-type(1)" },
    { name: "breadcrumb", selector: "nav[aria-label='Trilha de navegação'] a" },
    { name: "ui/Button primário", selector: "main button.bg-primary" },
    { name: "ui/Input busca", selector: "main input[type=text], main input:not([type])" },
    { name: "ui/SelectTrigger", selector: "main [role=combobox]" },
    { name: "tabela/paginação", selector: "main button[aria-label='Próxima página']" },
  ];

  const out: Record<string, unknown> = {};
  for (const p of probes) {
    const loc = page.locator(p.selector).first();
    if (!(await loc.count())) {
      out[p.name] = "não encontrado";
      continue;
    }
    await loc.focus().catch(() => undefined);
    await page.waitForTimeout(120);
    out[p.name] = await loc.evaluate((el) => {
      const cs = getComputedStyle(el);
      const focused = document.activeElement === el;
      const outlineW = parseFloat(cs.outlineWidth) || 0;
      const hasOutline = cs.outlineStyle !== "none" && outlineW > 0;
      const hasShadowRing = cs.boxShadow !== "none" && /rgb/.test(cs.boxShadow);
      return {
        focused,
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
        boxShadow: cs.boxShadow.slice(0, 90),
        visibleRing: hasOutline || hasShadowRing,
      };
    });
  }
  dump("a11y-focus", out);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 1));
});

/** Confere a razão de contraste dos tokens do design system, direto do CSS. */
test("DS-token-contrast: razão AA de cada par de tokens, claro e escuro", async ({ page }) => {
  test.setTimeout(200_000);
  const read = async (theme: "light" | "dark") => {
    const ctx = await page.context();
    void ctx;
    await authenticate(page, "owner", theme);
    await visit(page, "/", 2000);
    return page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const v = (n: string) => cs.getPropertyValue(n).trim();
      const hsl2rgb = (s: string) => {
        const [h, sat, l] = s.split(/\s+/).map((x) => parseFloat(x));
        const S = sat / 100;
        const L = l / 100;
        const k = (n: number) => (n + h / 30) % 12;
        const a = S * Math.min(L, 1 - L);
        const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        return [f(0), f(8), f(4)].map((x) => Math.round(x * 255));
      };
      const lum = ([r, g, b]: number[]) => {
        const f = (v2: number) => {
          v2 /= 255;
          return v2 <= 0.03928 ? v2 / 12.92 : Math.pow((v2 + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a: string, b: string) => {
        const [l1, l2] = [lum(hsl2rgb(v(a))), lum(hsl2rgb(v(b)))];
        return +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(3);
      };
      const pairs: [string, string][] = [
        ["--muted-foreground", "--background"],
        ["--muted-foreground", "--card"],
        ["--foreground", "--background"],
        ["--accent", "--background"],
        ["--accent", "--card"],
        ["--accent-foreground", "--accent"],
        ["--success", "--background"],
        ["--warning", "--background"],
        ["--warning-foreground", "--warning"],
        ["--destructive", "--background"],
        ["--destructive-foreground", "--destructive"],
        ["--primary-foreground", "--primary"],
        ["--border", "--card"],
        ["--border", "--background"],
        ["--sidebar-fg", "--sidebar-bg"],
        ["--sidebar-active", "--sidebar-bg"],
      ];
      return Object.fromEntries(
        pairs.map(([a, b]) => [`${a} / ${b}`, { ratio: ratio(a, b), fg: v(a), bg: v(b) }])
      );
    });
  };
  const light = await read("light");
  const dark = await read("dark");
  dump("token-contrast", { light, dark });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ light, dark }, null, 1));
});

test("DS-a11y-dialog: foco preso no dialog e devolvido ao fechar", async ({ page }) => {
  test.setTimeout(300_000);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const results: Record<string, unknown> = {};

  // (a) ConfirmDialog — implementação própria, sem Radix.
  //     Sem aria-label em lugar nenhum (DS-01), o alvo é posicional: o último
  //     botão de ícone da primeira linha da tabela.
  await settle(page, "/estoque/marcas");
  const del = page.locator("main table tbody tr").first().locator("button").last();
  if (await del.count()) {
    await del.click();
    await page.waitForTimeout(700);
    const trap: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      trap.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return "—";
          const inDialog = !!el.closest(".fixed.inset-0.z-50");
          return `${inDialog ? "DENTRO" : "FORA"}:${el.tagName.toLowerCase()}:${(el.textContent || "").trim().slice(0, 20)}`;
        })
      );
    }
    const dialogAria = await page.evaluate(() => {
      const d = document.querySelector(".fixed.inset-0.z-50 > .relative") as HTMLElement | null;
      return d
        ? {
            role: d.getAttribute("role"),
            ariaModal: d.getAttribute("aria-modal"),
            ariaLabelledby: d.getAttribute("aria-labelledby"),
            maxHeight: getComputedStyle(d).maxHeight,
          }
        : null;
    });
    await page.screenshot({ path: shot("confirm-dialog-focus") });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const returned = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? `${el.tagName.toLowerCase()}:${el.getAttribute("aria-label") ?? (el.textContent || "").trim().slice(0, 20)}` : "—";
    });
    results.confirmDialog = { tabTrap: trap, dialogAria, focusAfterClose: returned };
  } else {
    results.confirmDialog = "sem botão de excluir na primeira linha";
  }

  // (b) Dialog do Radix (ui/dialog.tsx) — onde ele é usado
  await settle(page, "/estoque/depositos");
  const novo = page.getByRole("button", { name: /dep[óo]sito|adicionar|novo/i }).first();
  if (await novo.count()) {
    await novo.click();
    await page.waitForTimeout(800);
    results.radixDialog = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]') as HTMLElement | null;
      if (!d) return "sem [role=dialog]";
      const cs = getComputedStyle(d);
      return {
        ariaModal: d.getAttribute("aria-modal"),
        ariaLabelledby: d.getAttribute("aria-labelledby"),
        ariaDescribedby: d.getAttribute("aria-describedby"),
        maxHeight: cs.maxHeight,
        overflowY: cs.overflowY,
        height: +d.getBoundingClientRect().height.toFixed(1),
        radius: cs.borderTopLeftRadius,
      };
    });
    await page.keyboard.press("Escape");
  }

  dump("a11y-dialog", results);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(results, null, 1));
});

// ════════════════════════════════════════════════════════════════════════
// 8. Estados de carregamento
// ════════════════════════════════════════════════════════════════════════

test("DS-load: skeleton × spinner × nada, rota a rota", async ({ page }) => {
  test.setTimeout(900_000);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const out: Record<string, unknown> = {};
  for (const route of ALL_ROUTES) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    // A shell tem o próprio spinner de hidratação (`layout.tsx:35`) e ele não
    // vive dentro de `<main>`. O que interessa é o primeiro quadro em que a
    // tela já existe mas os dados ainda não — daí a amostragem, em vez de
    // segurar a API (o que só media o spinner de sessão).
    const frames: { t: number; skeleton: number; spinner: number; len: number }[] = [];
    let firstShot = false;
    for (let t = 0; t < 100; t++) {
      const f = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (!main) return null;
        return {
          skeleton: main.querySelectorAll(".animate-pulse").length,
          spinner: main.querySelectorAll(".animate-spin").length,
          len: (main.textContent || "").trim().length,
          settled: !main.querySelector(".animate-pulse,.animate-spin") && (main.textContent || "").trim().length > 120,
        };
      });
      if (f) {
        frames.push({ t: t * 120, skeleton: f.skeleton, spinner: f.spinner, len: f.len });
        if (!firstShot) {
          firstShot = true;
          await page.screenshot({ path: shot(`loading-${route.replace(/\//g, "_") || "root"}`) });
        }
        if (f.settled) break;
      }
      await page.waitForTimeout(120);
    }
    const loadingFrames = frames.filter((f) => f.skeleton > 0 || f.spinner > 0);
    const blankFrames = frames.filter((f) => f.skeleton === 0 && f.spinner === 0 && f.len < 120);
    out[route] = {
      kind:
        loadingFrames.some((f) => f.skeleton > 0) && loadingFrames.some((f) => f.spinner > 0)
          ? "ambos"
          : loadingFrames.some((f) => f.skeleton > 0)
            ? "skeleton"
            : loadingFrames.some((f) => f.spinner > 0)
              ? "spinner"
              : "nada",
      msComLoading: loadingFrames.length * 120,
      msEmBranco: blankFrames.length * 120,
      msAteEstabilizar: frames.length ? frames[frames.length - 1].t : null,
      maxSkeleton: Math.max(0, ...frames.map((f) => f.skeleton)),
      maxSpinner: Math.max(0, ...frames.map((f) => f.spinner)),
    };
  }
  dump("loading-states", out);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 1));
});
