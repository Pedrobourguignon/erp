# Frontend Clean Code Rules

## Architecture
- Use App Router (app/) exclusively. No pages/ directory.
- Hooks in hooks/ — prefix with `use`. One hook per file.
- Stores in stores/ — Zustand only. One store per domain. Suffix with `.store.ts`.
- Types in types/ — shared frontend types. Use `type` over `interface` unless extending.

## Component Rules
- Max 150 lines per component. Extract sub-components if larger.
- Always use named exports (no default exports except pages).
- Props interface defined above component, named `{ComponentName}Props`.
- Use `"use client"` only when truly needed (hooks, events, browser APIs).
- Server Components by default. Client Components are the exception.
- Colocate loading.tsx, error.tsx, not-found.tsx with page.tsx.

## State Management
- Server state: React Query (TanStack Query) exclusively
- Client state: Zustand for global, useState for local
- Never mix: no Redux, no Context for state (Context OK for providers)
- React Query keys: `[entity, action, params]` (e.g., `['products', 'list', { page: 1 }]`)

## Forms
- react-hook-form + zod for ALL forms
- Schemas in packages/validators for shared, local for page-specific
- Never use uncontrolled inputs without react-hook-form

### Form validation (MANDATORY)

- **Every `<form>` using react-hook-form needs `noValidate`.** Without it the browser validates
  first, in English, and the zod messages never appear — that is FN-26, and it is not an e-mail
  problem: any `max`, `min`, `required` or `type="email"` attribute triggers it.
- **Every registered field renders its own error.** A field whose error has nowhere to go makes the
  submit button look broken: the schema refuses, the form does nothing, and the user has no idea why
  (FN-13). Sweep for it with `grep '{...register(' | grep -v 'errors\.'`.
- Pass `onInvalid` to `handleSubmit` as a safety net — `useInvalidSubmit()` toasts how many fields
  are pending, so a submit is never silent even if someone forgets an error block.
- **In a tabbed form, the error may be on a hidden tab.** Use `lib/form-tabs.ts` to badge the tab
  with a count and focus the first tab with an error (AE-11). `onInvalid` receives the errors as its
  **argument** — reading `errors` from the closure gets the state from before the submit, and the
  tab does not switch on the first attempt, which is exactly when it matters.
- Brazilian documents and fiscal codes are validated by `@erp/validators` (`isValidCPF`,
  `isValidCNPJ`, `isValidNCM`, `isValidGTIN`, `isValidCFOP`), never by counting digits — counting is
  what let `111.111.111-11` and `ean: '123'` into the database (AE-04, AE-08).

### Labels (MANDATORY)
- A `<label>` needs `htmlFor` pointing at the control's `id`. Text sitting next to a field is not a
  label as far as the browser is concerned: a screen reader announces an unnamed "edit text",
  clicking the text does not focus the field, and `getByLabel` finds nothing.
- `LabelLinker` (`components/a11y/label-linker.tsx`, via `lib/link-orphan-labels.ts`) links the
  orphans it finds at runtime. It is a net under what slips, not a license to skip `htmlFor`.

### Input Masks (MANDATORY for Brazilian fields)
- **CPF**: `000.000.000-00` — use `maskCPF` from `@/lib/masks`
- **CNPJ**: `00.000.000/0000-00` — use `maskCNPJ` from `@/lib/masks`
- **Phone**: `(00) 00000-0000` or `(00) 0000-0000` — use `maskPhone` from `@/lib/masks`
- **CEP**: `00000-000` — use `maskCEP` from `@/lib/masks`
- Apply masks via `onChange` + `setValue` pattern with `{ shouldValidate: true }`
- Validate masked fields using `.refine()` on unmasked digit count, not `.min()` on string length
- Display stored values with masks in tables and detail pages (never show raw digits to users)
- Always set `maxLength` on masked inputs to prevent overshoot

### Field Character Limits
- All text inputs MUST have a `maxLength` prop matching the database column limit
- All zod schemas MUST have `.max()` matching the same database limit
- Common limits (from Prisma schema): name=255, description=2000, SKU=50, NCM=10 (8 digits + mask), CEST=9 (7 digits + mask), EAN=18 (up to 14 digits + mask), email=255, phone=20, document=18, address=500, city=100, state=2, zipCode=10

## Dates and timezones (MANDATORY)

- `formatDate(value)` renders a **civil date** — a due date, a competence date,
  anything picked in `<input type="date">`. It reads the day as written and
  never converts it.
- `formatDateTime(value)` renders an **instant** — `createdAt`, `paidAt`, a
  status change — in the reader's timezone.
- Picking the wrong one is FN-02: civil dates rendered in local time showed one
  day less than the user typed in every screen of the financial module.
- **Never** use `new Date(civilDateString)` to display a date, and never use
  `new Date().toISOString().slice(0, 10)` for "today" — that is today in UTC and
  after 21:00 in BRT it is already tomorrow. Use `todayDateKey()`.
- `<input type="date">` sends and receives `YYYY-MM-DD`. Keep it as a string all
  the way to the API.
- Period filters must flag an inverted range with `isInvertedRange` (FN-23).

---

## Permissions and error states (MANDATORY)

- Gate UI with `usePermissions()` / `<Can>` / `<RequirePermission>`. Permission
  names come from `@erp/constants` — the same list the seed writes and the API
  guards require. Never retype a permission string.
- **The menu filter is cosmetic.** `lib/nav-items.ts` hides what the user cannot
  reach, but the page guard is the real one: an unlisted route is still
  reachable by URL (AE-27).
- `permissions === null` means **not loaded yet**, not "has none". Render a
  loading state — a false "Acesso negado" is worse than a spinner.
- For buttons, prefer `<Can mode="disable">` (disabled + tooltip) over hiding: a
  control that vanishes with no explanation confuses as much as the 403 did.
- **`isError` must never be rendered as an empty state.** A list shows "nenhum
  registro" only for a request that *succeeded* with zero rows. Pass the query's
  `error` to `<DataTable error={error}>`; use `isPermissionError()` from
  `@/lib/api-errors` elsewhere. `/financeiro/contas` reported "Nenhuma conta
  cadastrada" on top of a 403 with six accounts in the bank (AE-28).
- The same rule applies to derived warnings: "Nenhum caixa aberto" must mean the
  query answered zero, not that it failed (VD-07).
- `getApiErrorMessage()` already turns a 403 into "Você não tem permissão…"
  (FN-71) — always run mutation errors through it before falling back to a
  generic message.

---

## Responsive and tables (MANDATORY)

- **A flex child that must shrink needs `min-w-0`.** Without it the child keeps its intrinsic width
  and the content is *cut off with no scroll* — that is AE-07, and the QA measured it as
  `scrollWidth === clientWidth` at 390 px.
- Wide content scrolls **inside its own container** (`overflow-x-auto`), never by stretching the
  page.
- **Every table cell truncates by default** (`max-w-[42ch]` on an inner wrapper, `title` on the
  `<td>`). A 255-character product name — which the schema allows — pushed Categoria, Preço,
  Estoque, Status and Ações off screen and broke *every* row (AE-20). Action columns opt out with
  `noTruncate`; monetary columns use `nowrap` so "R$ 89,90" never becomes "R$ 89" (VD-13).
- `max-w-0 truncate` on a `<td>` only works under `table-fixed` — use the wrapper.
- Dialogs: `max-h-[85vh]`, scrollable body, fixed footer. A dialog that grows without limit puts its
  own buttons out of reach (FN-14, AE-26).
- **Hooks run before any conditional return.** `if (!open) return null` above a `useEffect` made
  every confirmation dialog in the system throw "Internal React error: Expected static flag was
  missing" (AE-09). `rules-of-hooks` is an error in the lint config — keep it that way.

---

## Text that comes from the database (MANDATORY)

Every string the user typed is unbounded up to its schema limit — a product name
may legally be 255 characters and a description 2000. The layout that shows it is
not. **Text that does not fit is clipped with an ellipsis and handed back in
full through a tooltip. Never both cut and lost.**

- **Use `<TruncatedText>`** (`@/components/ui/truncated-text`) for any value that
  comes from the API: names, descriptions, e-mails, addresses, SKUs, notes. It
  clips, and it only mounts a tooltip **while the text is really clipped** —
  measured with a `ResizeObserver`, not guessed from `text.length`, so a short
  name in a narrow column gets the tooltip and a long one in a wide card does
  not. A tooltip on text the user can already read is noise that teaches people
  to ignore tooltips.
  ```tsx
  <TruncatedText as="h1" text={product.name} className="text-3xl font-bold" />
  <TruncatedText text={item.warehouse.name} className="max-w-[28ch]" />  // em tabela
  <TruncatedText text={customer.notes} lines={3} />                      // multilinha
  ```
- **`min-w-0` on every flex/grid ancestor**, otherwise there is no width to clip
  against and `truncate` does nothing. Siblings that must not shrink (icons,
  badges, action buttons) get `shrink-0`.
- **In a table, give the column a budget in `ch`.** `truncate` alone does not
  clip in an auto-layout table: the cell grows to fit. `DataTable` already
  budgets 32ch; a hand-rolled table needs `max-w-[NNch]` — 24ch on a crowded row
  such as the counter-sale search, or the price and the action button leave the
  screen.
- **`truncate` on a wrapper does not ellipsize a nested block.** It clips it, with
  no dots and no explanation. The ellipsis only reaches the wrapper's own inline
  content, so a cell that renders `<div class="flex">…<span>{name}</span></div>`
  needs the `truncate` **on the span**. This is what painted a category name over
  the Slug column and a product name over Estoque Atual.
- **`DataTable` puts `title` on the `<td>` from the column's `accessor`**, even
  when the cell renders custom JSX. A column with no `accessor` (actions) gets no
  title — there is nothing textual to show. Tables keep the native `title`
  instead of `<TruncatedText>`: fifty rows would mean fifty React tooltip
  instances for the same affordance.
- **Clipped text enters the tab order** (`TruncatedText` does it for you). A
  tooltip only reachable by mouse means keyboard users simply lose the data
  (WCAG 1.4.13).
- **A block that is allowed to grow does not need clipping — it needs
  `break-words`.** A description with the full width of a card wraps by itself;
  what escapes it is a single unbroken 2000-character string.
- **Text with spaces wraps and never overflows: it is the unbroken word that
  breaks the layout** — a SKU, a barcode, a URL, an e-mail, a name typed with no
  spaces. Any fixture written to test this has to be a single word, or it proves
  nothing (AE-31).
- The regression net is `e2e/texto-longo.spec.ts`. It fails on three distinct
  defects: text painted outside its box, clipped with no ellipsis, and clipped
  with no way to read the rest.

---

## Filters (MANDATORY)

- **A filter over something registered in the system is always a select fed by
  the API — never free text.** Categoria and Marca in Produtos were `<input>`s
  whose value was sent as `categoryId`/`brandId`, an exact match against a cuid:
  no text a user could type would ever work, and the table answered "nenhum
  registro" exactly like a legitimate empty result (FT-01/FT-02).
- Use `<EntityFilterSelect>` for low-cardinality entities (category, brand,
  warehouse, account, cash register, payment method) and `<SearchableSelectBase>`
  with a server-side loader for the unbounded ones (customer, product). Loading
  every customer into a dropdown is the mistake the product picker already
  avoided in lote 2.
- **Before adding a screen, diff its `*QueryDto` against the panel.** Sixteen
  filters the API already accepted had no field anywhere in the UI — the gap is
  invisible unless someone compares the two on purpose.
- Filter state goes through `useFilters`, which resets the page as a side effect
  of `set`. Calling `setPage(1)` by hand in each `onChange` is how a user ends up
  on page 7 of a two-page result (FT-11).
- The "no filter" option uses the `__all` sentinel, never `""` — Radix reads the
  empty string as "no value" and wipes the placeholder.
- A filter the user cannot read (403) hides; a filter that failed to load shows
  the reason. An empty filter is the same lie as an empty table (AE-28).

---

## End-to-end tests (lote 10)

- The suite lives in `apps/web/e2e/` and runs with `npm run e2e`. It expects the API and the web
  already up — it does not start them locally (the CI does).
- **Every journey asserts a side effect on another screen.** The success toast is the part that lies;
  the product balance and the financial entry are not. That is how the QA cycle found the criticals.
- Name each test with the report ID (`VD-02: …`) so the traceability survives reading the output.
- The fixtures fail a test on any `pageerror`, console error or HTTP 5xx. On its own that catches
  AE-00 (white screen) and AE-09 (the hooks violation in every confirmation dialog).
- **Never `waitForTimeout` for a side effect.** The receivables of an order are written by an event
  handler *after* the status change answers 200 — use `waitFor(read, predicate)`. Reading once is a
  race that passes locally and fails in CI, which is worse than no test.
- Build the mass, don't inherit it: `ensureSellableProduct`, `createCustomer`,
  `ensureOpenCashSession`. The journeys consume stock, so the tenth run would find nothing to sell.

---

## Styling
- Tailwind CSS only. No CSS modules, styled-components, or inline styles.
- Use `cn()` utility for conditional classes
- Follow shadcn/ui patterns for all UI primitives
- Responsive: mobile-first (sm: md: lg:)
- Dark mode: always support via `dark:` variants

## Performance
- Use `next/image` for all images
- Use `next/link` for all internal links
- Lazy load below-fold components with `dynamic()`
- Memoize expensive computations with `useMemo`
- Debounce search inputs (300ms)

## Error Handling
- **EVERY** mutation call (`mutateAsync`) MUST be wrapped in try/catch
- On success: show a toast with a clear message describing what was done (e.g., "Produto criado com sucesso!")
- **On error, always go through `getMutationErrorMessage(error, fallback)`** from
  `@/lib/mutation-error`. A toast that only shows the generic fallback throws away what the backend
  said: the API answered "Já existe um cliente com o documento 529.982.247-25" and the user read
  "Erro ao criar cliente. Tente novamente.", tried again, and got the same thing (AE-10).
  **A error toast without it does not pass code review.**
- The helper already handles 403 (permission message) and 5xx (generic fallback — a stack trace
  helps nobody). Everything else shows the backend's specific reason.
- **Anticipate the error when the screen already knows.** The delete dialog for a category in use
  says "4 produtos usam esta categoria" *before* confirming — the count is right there in the same
  row; making the user discover it through a 409 is a choice, not a limitation.
- Use `useToast()` from `@/components/ui/toast` — the `Toaster` is already mounted in `providers.tsx`
- Never let a mutation's Promise rejection go unhandled — silent failures are forbidden
- Use error.tsx boundaries for page-level errors
- Never swallow errors silently

## API contracts
- **Response types come from `packages/shared-types`.** Retyping a response inside `app/` is how
  three columns ended up permanently empty: the local type said `totalOrders` existed, the API sent
  `_count.orders`, and `undefined` renders as a blank cell or `R$ 0,00` — nobody notices the
  contract broke, they just think the customer never bought anything (AE-13, AE-14, AE-12b).
- A field may legitimately be `null`; what it may not be is **absent** from the response.
- When a column renders empty, check the response body before the component.

## Testing (TDD — Test-Driven Development)

### TDD Workflow (MANDATORY for all new features)

Every new feature, bug fix, or refactor MUST follow the Red-Green-Refactor cycle:

1. **RED**: Write a failing test FIRST that describes the expected behavior.
2. **GREEN**: Write the minimum code to make the test pass.
3. **REFACTOR**: Clean up the code while keeping tests green.

Do NOT write implementation code before its corresponding test exists.

### What to Test
- **Hooks**: Every custom hook must have a `.test.ts` file. Test data fetching, mutations, error states, cache invalidation.
- **Stores**: Test state transitions, persistence (localStorage), and hydration.
- **Utils/Lib**: Test every exported function with happy path + edge cases.
- **Components**: Test rendering, user interactions, loading/error/empty states, form validation.
- **Pages (E2E-style)**: Test full user flows with mocked API responses.

### Test File Location
- Test files live next to their source: `use-products.test.ts` beside `use-products.ts`.
- Component tests: `data-table.test.tsx` beside `data-table.tsx`.

## Do NOT
- Use `any` type — ever
- Use `console.log` in committed code (use `console.warn`/`console.error` only)
- Create files > 300 lines
- Put business logic in components (extract to hooks/services)
- Use index.ts barrel exports (causes bundle bloat)
- Hardcode strings that should be constants
- Concatenate a number with a fixed noun — use `pluralize()`; the KPI card said "1 itens" (AE-21)
- Keep a second copy of status labels — they come from `@erp/constants` (AE-23)
- Ship user-facing text without accents: "Metodos", "Condicoes", "obrigatorio" (FN-27)
- Skip loading/error states in data fetching
- Write implementation code without a corresponding test (TDD is mandatory)
