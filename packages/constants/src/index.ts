import type { OrderStatus } from '@erp/shared-types';

// ─── Order status transitions ──────────────────────────────────────────

/**
 * Single source of truth for the order state machine.
 *
 * It used to be written in three places (this file, `orders.service.ts` and the
 * order detail page) with three different contents, which is how VD-02 was born:
 * the UI offered `PICKING → SHIPPED` while the API only accepted
 * `PICKING → PACKED`, so orders never reached `SHIPPED` and their stock stayed
 * reserved forever. Import it — never retype it.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['PENDING', 'CANCELLED'],
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PICKING', 'CANCELLED'],
  PICKING: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['COMPLETED', 'RETURNED'],
  COMPLETED: [],
  CANCELLED: [],
  RETURNED: [],
};

/** Every order status, in lifecycle order. Use it for enum validation and filters. */
export const ORDER_STATUSES: OrderStatus[] = [
  'DRAFT',
  'PENDING',
  'CONFIRMED',
  'PICKING',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'RETURNED',
];

/** Statuses from which no further transition is possible. */
export const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'RETURNED',
];

/**
 * Statuses in which items can be exchanged or returned: the goods are already
 * with the customer. Shared by the API guard and the order detail screen.
 */
export const ADJUSTABLE_ORDER_STATUSES: OrderStatus[] = ['DELIVERED', 'COMPLETED'];

export function canAdjustOrderItems(status: OrderStatus): boolean {
  return ADJUSTABLE_ORDER_STATUSES.includes(status);
}

export function getAllowedTransitions(status: OrderStatus): OrderStatus[] {
  return ORDER_STATUS_TRANSITIONS[status] ?? [];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return getAllowedTransitions(from).includes(to);
}

/** Portuguese labels for every order status, shared by API messages and UI. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Rascunho',
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  PICKING: 'Separando',
  PACKED: 'Embalado',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
  RETURNED: 'Devolvido',
};

// ─── Marketplace rate limits ───────────────────────────────────────────

export const MARKETPLACE_RATE_LIMITS = {
  MERCADO_LIVRE: {
    requestsPerMinute: 60,
    requestsPerHour: 3000,
    burstLimit: 10,
  },
  AMAZON: {
    requestsPerMinute: 30,
    requestsPerHour: 1800,
    burstLimit: 5,
  },
  SHOPEE: {
    requestsPerMinute: 40,
    requestsPerHour: 2000,
    burstLimit: 8,
  },
  MAGALU: {
    requestsPerMinute: 30,
    requestsPerHour: 1500,
    burstLimit: 5,
  },
  SHOPIFY: {
    requestsPerMinute: 40,
    requestsPerHour: 2000,
    burstLimit: 8,
  },
  NUVEMSHOP: {
    requestsPerMinute: 30,
    requestsPerHour: 1500,
    burstLimit: 5,
  },
} as const;

// ─── Permissions and roles ─────────────────────────────────────────────

export * from './permissions';

// ─── Tenant plan and tax regime ────────────────────────────────────────

export * from './tenant';

// ─── Brazilian tax rates ───────────────────────────────────────────────

export const TAX_RATES = {
  ICMS: {
    default: 0.18,
    interstate: {
      south_southeast_to_other: 0.07,
      other_to_south_southeast: 0.12,
      same_region: 0.12,
    },
  },
  IPI: {
    default: 0.05,
  },
  PIS: {
    cumulative: 0.0065,
    nonCumulative: 0.0165,
  },
  COFINS: {
    cumulative: 0.03,
    nonCumulative: 0.076,
  },
  CSLL: {
    default: 0.09,
  },
  IRPJ: {
    default: 0.15,
    surcharge: 0.10,
    surchargeThreshold: 20000,
  },
  SIMPLES_NACIONAL: {
    tier1: { maxRevenue: 180000, rate: 0.06 },
    tier2: { maxRevenue: 360000, rate: 0.112 },
    tier3: { maxRevenue: 720000, rate: 0.135 },
    tier4: { maxRevenue: 1800000, rate: 0.16 },
    tier5: { maxRevenue: 3600000, rate: 0.21 },
    tier6: { maxRevenue: 4800000, rate: 0.33 },
  },
} as const;

// ─── Brazilian states ──────────────────────────────────────────────────

export const BRAZILIAN_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export type BrazilianState = (typeof BRAZILIAN_STATES)[number];
