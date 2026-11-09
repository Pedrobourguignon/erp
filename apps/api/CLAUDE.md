# ERP Backend — Clean Code & Coding Standards

This document defines the rules and conventions for all code written in the NestJS API backend (`apps/api`). Every contributor — human or AI — must follow these standards without exception.

---

## Architecture & DDD

- Each module follows this structure: `module.ts`, `controller.ts`, `service.ts`, `dto/`, `entities/` (if needed).
- **Controller**: thin, only HTTP concerns. Parse the request, validate input, delegate to the service, format the response. No business logic.
- **Service**: business logic lives here. One public method per use case. Max 80 lines per method.
- **Repository pattern**: services talk to Prisma. Controllers never access Prisma directly.
- **Use Cases**: for complex operations (involving multiple aggregates, external calls, or transactions), create dedicated use-case classes in a `use-cases/` directory inside the module.
- **Events**: use domain events for cross-module communication. Never import one domain module into another directly. Emit events via NestJS `EventEmitter2` and subscribe in the target module.

---

## Multi-tenancy Rules (CRITICAL)

These rules are non-negotiable. Violating them causes data leaks between tenants.

- **EVERY** database query MUST be scoped by `tenantId`. No exceptions.
- Use the `@CurrentTenant()` decorator in controllers to extract the tenant from the request context.
- Pass `tenantId` as the **first parameter** in every public service method.
- **NEVER** use `PrismaService` directly without tenant scoping. Either use `prisma.forTenant(tenantId)` or explicitly add a `where` clause with `tenantId`.
- Write dedicated tests for tenant isolation: query with tenant A must never return tenant B data.

### Example

```typescript
// Controller
@Get()
async findAll(@CurrentTenant() tenantId: string, @Query() query: PaginationDto) {
  return this.productsService.findAll(tenantId, query);
}

// Service
async findAll(tenantId: string, query: PaginationDto) {
  return this.prisma.product.findMany({
    where: { tenantId },
    skip: (query.page - 1) * query.limit,
    take: query.limit,
  });
}
```

---

## Naming Conventions

| Element       | Convention   | Example                        |
|---------------|-------------|--------------------------------|
| Controllers   | PascalCase + `Controller` | `ProductsController`     |
| Services      | PascalCase + `Service`    | `ProductsService`        |
| DTOs          | PascalCase + `Dto`        | `CreateProductDto`       |
| Events        | PascalCase + `Event`      | `OrderCreatedEvent`      |
| Guards        | PascalCase + `Guard`      | `TenantGuard`            |
| Interceptors  | PascalCase + `Interceptor`| `LoggingInterceptor`     |
| Files         | kebab-case                | `products.controller.ts`, `create-product.dto.ts` |
| DB tables     | snake_case (via Prisma `@@map`) | `order_items`     |
| DB columns    | snake_case (via Prisma `@map`)  | `created_at`      |

---

## API Design

- Follow RESTful conventions: proper HTTP methods (`GET`, `POST`, `PATCH`, `DELETE`) and status codes (`200`, `201`, `204`, `400`, `401`, `403`, `404`, `409`, `422`, `500`).
- All routes are prefixed with `/api/v1/`.
- **Pagination**: accept `page` and `limit` query params; build the envelope with
  `buildPaginatedResponse` (`common/utils/pagination.ts`) — never hand-roll it.
- **Error responses**: the global exception filter owns the shape. Throw the typed exception and
  let it format.
- Use `class-validator` decorators on all DTOs.
- Use Zod for complex validations (shared schemas live in `packages/validators`).

---

## Error Handling

- Use NestJS built-in exceptions: `NotFoundException`, `BadRequestException`, `ConflictException`, `ForbiddenException`, `UnauthorizedException`, etc.
- **Never** throw a generic `Error`. Always use typed `HttpException` subclasses.
- The service layer throws business exceptions. Controllers do not catch them — the global exception filter handles all uncaught errors.
- Log every error with context: entity name, entity ID, `tenantId`, `userId`.
- **Every message a user can read is born in pt-BR.** English stays in logs and internal technical
  messages. The user literally saw "Cannot create inventory item with negative quantity" and
  "Insufficient stock. Current: 19, Change: -999" (AE-12a).
- **Make it actionable.** "Current: 19" forces the operator to guess *which* warehouse holds those
  19 — say the product, the warehouse and both numbers.
- Money inside a message goes through `formatBRL` from `common/utils/money.util.ts`. `toFixed(2)`
  produces "11730.00", with a decimal point and no thousands separator (VD-19).
- Sweep with:
  `grep -rn "throw new \\(Bad\\|Conflict\\|NotFound\\|Forbidden\\)" apps/api/src | grep -v "[À-ú]"`

---

## Dates and timezones (MANDATORY)

Two different things are stored in `DateTime` columns and they must never be
mixed:

| Nature | Examples | Rule |
|---|---|---|
| **Instant** | `createdAt`, `paidAt`, `shippedAt` | UTC in the database, converted for display |
| **Civil date** | `dueDate`, `competenceDate`, `De`/`Até` filters | midnight **in the tenant's timezone** |

- **A civil date never goes through `new Date(string)`** without an explicit
  timezone: `new Date('2026-01-15')` is midnight *UTC*, which is 21:00 of the
  14th in BRT — the user types 15/01 and the screen shows 14/01 (FN-02).
- **Never use `setHours` to build a range.** It applies the *process* timezone,
  not the tenant's: in UTC-3 the end of the period landed ~21h early and the
  filter dropped most of the last day (FN-01, VD-09).
- **Never bucket by `toISOString().slice(0, 10)`.** That is the UTC day; every
  record made after 21:00 in UTC-3 falls into the next one (TZ-01).
- Use `apps/api/src/common/utils/date-range.util.ts` for all of it:
  `toDateRange`, `startOfDayInTz`, `endOfDayInTz`, `parseUserDate`,
  `civilDaysFrom`, `civilInstallmentDueDates`, `toLocalDateKey`, `shiftDateKey`.
- Tests must state expectations as **absolute instants** (`'2026-07-31T03:00:00.000Z'`),
  never as `new Date(2026, 6, 31)` — the suite runs under three timezones.

---

## Brazilian data (MANDATORY)

- CPF/CNPJ, NCM, CEST, EAN/GTIN and CFOP are validated with `@erp/validators` through the decorators
  in `common/validators/` (`@IsBrDocument`, `@IsBrFiscal`). `@IsString() @MaxLength(18)` is not
  validation: it is how `111.111.111-11` and `ncm: 'ABCDEFG'` reached the database (AE-04, AE-08).
- **Store the digits, format on display.** A document kept with its mask made duplicate detection
  bypassable by changing the formatting (AE-15). The same goes for NCM, CEST and EAN.
- **Uniqueness belongs to the database.** A `findFirst` before the insert still loses under
  concurrency — pair it with a unique index (`(tenantId, document)`, `(tenantId) where isDefault`).
- Validate at **every** entry point: create, update, CSV import. The update path was a second open
  door for the fiscal codes.

---

## Money (MANDATORY)

- The database stores **cents**. Never add or subtract money as JavaScript floats:
  `299.8 + 409.1` is `708.9000000000001`, and that is exactly what the API leaked in
  `GET /financial-entries` (FN-28).
- Use `apps/api/src/common/utils/money.util.ts` — `toMoney`, `sumMoney`, `subtractMoney`,
  `toCents`, `fromCents`. Every one of them adds in integer cents and returns a two-decimal number.
- For order arithmetic (item totals, discounts, installment splits) use `@erp/validators`
  (`roundMoney`, `calculateOrderTotals`, `splitInstallments`) — the frontend shares those, and a
  second implementation is how VD-10 was born.
- **Read as `Prisma.Decimal`, add as cents, expose as a number with two decimals.** Never let a
  `Number(decimal)` result reach a response body without passing through `toMoney`.
- Tests must assert exact values (`toBe(708.9)`), never `toBeCloseTo` — the whole point is that the
  value is exact.

---

## Security

- Apply `@RequirePermissions()` on **every** mutation endpoint (`POST`, `PATCH`, `DELETE`).
- **Permissions live in `@erp/constants`** (`PERMISSIONS`, `ROLE_DEFINITIONS`), which the seed
  writes to the database and the guard reads back. A permission that is not in that list can never
  be granted to anyone — `role-permissions.spec.ts` fails the build if a controller requires one.
- Prefer a **granular** permission over widening an existing one. Selling needs to read payment
  methods; it does not need `financial:read`, and granting it was VD-07's tempting wrong fix.
- When one endpoint serves roles with different reach, narrow the **response**, do not just allow
  the call: use `@CurrentPermissions()` to scope it (the seller sees open cash sessions, not the
  whole history; the dashboard omits the financial KPIs instead of hiding them in the UI).
- Use `@Public()` only on authentication endpoints and webhook receivers.
- Validate **all** input through DTOs and Zod schemas. Trust nothing from the client.
- Sanitize output: never expose passwords, tokens, internal IDs, or fields that the caller does not need. Map Prisma models to response DTOs.
- Rate-limit sensitive endpoints (login, password reset, OTP verification).

---

## Validation must refuse, not clamp (MANDATORY)

- **An arithmetic helper that caps a value is not validation.** `calculateItemTotal` floors the line
  at zero and `calculateOrderTotals` caps the discount at the subtotal — both correct for *display*.
  The service called them and never checked the input, so a discount of R$ 80 on a R$ 50 line was
  accepted and stored as a completed sale of **R$ 0,00** (VD-10). The frontend refused it; the
  database did not.
- Every rule the UI enforces has to exist here too. A zod schema is a courtesy to the user, never a
  guarantee — any other client, or the same client with a tweaked payload, goes straight past it.
- `@erp/validators` exports the limits (`maxItemDiscount`); use them to **reject**, and let the
  clamping helpers do only the arithmetic.

---

## Permissions on open routes (`@ResolvePermissions`)

- `PermissionsGuard` resolves the caller's permissions **only** on routes that declare
  `@RequirePermissions`. On any other route `@CurrentPermissions()` answers `[]` — which reads as
  "this user has no permissions", not "not resolved".
- A route that is open to every authenticated user but narrows its **response** per permission must
  declare `@ResolvePermissions()`. Global search does exactly this: anyone may search, and each group
  of results is filtered by what the caller can open (AE-18).
- `@CurrentRole()` carries the role name, so `owner`/`admin` can be recognised without a second query.

---

## Filters

- **An id filter is an exact match.** `where.categoryId = categoryId` cannot be
  fed a name, so any UI that sends one gets zero rows forever (FT-01). If a
  filter should accept text, it belongs in `search`, not in an id field.
- A filter over a **hierarchy** has to decide, explicitly, whether it includes
  the descendants. `products.findAll` expands the category tree
  (`resolveCategoryTree`) because picking a parent and seeing fewer products
  than its own count promised reads as data loss (FT-08).
- When adding a list endpoint, expose the filters the screen will need in the
  `*QueryDto` **and** check that the screen offers them — sixteen accepted
  filters had no field in the UI at all.

---

## Testing (TDD — Test-Driven Development)

### TDD Workflow (MANDATORY for all new features)

Every new feature, bug fix, or refactor MUST follow the Red-Green-Refactor cycle:

1. **RED**: Write a failing test FIRST that describes the expected behavior.
2. **GREEN**: Write the minimum code to make the test pass.
3. **REFACTOR**: Clean up the code while keeping tests green.

Do NOT write implementation code before its corresponding test exists. The test defines the contract.

### Test Rules

- **Unit tests** for services: mock Prisma, Redis, and external dependencies.
- **Unit tests** for guards, pipes, interceptors, and filters.
- **Unit tests** for event handlers: verify side effects (stock reservation, receivable creation, notifications).
- **Integration tests** for controllers: use Supertest against the NestJS app.
- Test files live next to their source: `products.service.spec.ts` beside `products.service.ts`.
- **ALWAYS** test tenant isolation: confirm that querying with tenant A never returns tenant B data.
- **ALWAYS** test permission checks: confirm that users without the required permission receive `403`.
- **ALWAYS** test error paths: invalid input, not found, duplicate, insufficient stock, etc.
- **ALWAYS** test event emissions: verify the correct event is emitted with the correct payload.
- Use test factories (`test/factories/`) for generating test data — never hardcode entity data inline.
- Use `it.each` for parameterized tests (e.g., state machine transitions).
- Aim for >80% coverage on services and guards. 100% on security-critical paths (auth, permissions, tenant isolation).

---

## Performance

- Use Prisma `select` to fetch only the fields you need. Never fetch full rows when you only need a few columns.
- Use Prisma `include` sparingly. Never nest deeper than 2 levels.
- Cache frequently read, rarely changed data in Redis with a TTL of 5-15 minutes.
- Use BullMQ for any operation that takes longer than 500ms (report generation, bulk imports, email sending, PDF creation).
- Add database indexes on all foreign keys and columns used in frequent `WHERE` / `ORDER BY` clauses.

---

## Do NOT

- Use the `any` type. Ever. Use `unknown` and narrow with type guards if the type is truly dynamic.
- Use `console.log`. Use the NestJS `Logger` service instead (`this.logger.log()`, `this.logger.warn()`, `this.logger.error()`).
- Put business logic in controllers. Controllers are thin wrappers.
- Import between domain modules directly. Use events for cross-module communication.
- Skip validation on any input. All data from the outside world is untrusted.
- Return Prisma models directly from controllers. Map them to response DTOs.
- Use synchronous file I/O (`fs.readFileSync`, etc.). Use async alternatives.
- Hardcode configuration values (URLs, secrets, feature flags). Use `ConfigService` and environment variables.
- Skip error handling on external API calls. Wrap them in try/catch, log failures, and throw meaningful exceptions.
- Create god services exceeding 500 lines. Split into focused use-case classes.
