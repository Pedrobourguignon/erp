// ─── Enums (union types) ───────────────────────────────────────────────

export type OrderStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'CONFIRMED'
  | 'PICKING'
  | 'PACKED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'RETURNED';

export type ProductStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'DRAFT';

export type OrderOrigin =
  | 'MANUAL'
  | 'BALCAO'
  | 'MERCADO_LIVRE'
  | 'SHOPEE'
  | 'AMAZON'
  | 'MAGALU'
  | 'SHOPIFY'
  | 'NUVEMSHOP'
  | 'WOOCOMMERCE'
  | 'API';

export type MarketplaceType =
  | 'MERCADO_LIVRE'
  | 'SHOPEE'
  | 'AMAZON'
  | 'MAGALU'
  | 'SHOPIFY'
  | 'NUVEMSHOP';

// ─── Core entities ─────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  role: string;
}

export type ProductType = 'SIMPLE' | 'VARIABLE' | 'KIT' | 'SERVICE';

export interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string;
  type?: ProductType;
  costPrice: number;
  salePrice: number;
  promoPrice?: number;
  markup?: number;
  status: ProductStatus;
  categoryId?: string;
  brandId?: string;
  brand?: string;
  ncm?: string;
  cest?: string;
  ean?: string;
  /** CFOP com 4 dígitos — sem ele não se emite NF-e de venda (AE-08). */
  cfop?: string;
  weight?: number;
  height?: number;
  width?: number;
  length?: number;
  /** Minimum that seeds each InventoryItem created for this product (SCRUM-37). */
  defaultMinStock?: number;
  minStock?: number;
  maxStock?: number;
  createdAt?: string;
  updatedAt?: string;
  /** Só no detalhe (`GET /products/:id`). */
  variants?: ProductVariant[];
}

/** Variante (tamanho/cor) como o detalhe do produto devolve. */
export interface ProductVariant {
  id: string;
  sku: string;
  /** Ex.: "Azul - M". */
  name: string;
  /** Ausente = vende pelo preço do produto. */
  salePrice: number | string | null;
  isActive?: boolean;
  inventoryItems?: { id: string; warehouseId: string; quantity: number; reserved: number; available: number }[];
}

/**
 * Shape returned by `GET /orders` and `GET /orders/:id`.
 *
 * VD-06 was caused by a hand-written copy of this interface in the web app that
 * nested shipping under `order.shipping` and the timeline under `order.history`,
 * while the API returns both flattened. Extend this type instead of retyping it.
 */
export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  origin: OrderOrigin;
  customerId?: string;

  // Amounts
  subtotal?: number;
  discount?: number;
  shippingCost?: number;
  totalAmount: number;

  // Shipping — flat on the order, not nested
  shippingMethod?: string | null;
  trackingCode?: string | null;
  trackingUrl?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  estimatedDelivery?: string | null;

  cancelledAt?: string | null;
  cancelReason?: string | null;
  notes?: string | null;

  /** Statuses this order may transition to, computed by the API. */
  allowedTransitions?: OrderStatus[];

  /** Detalhe: o pedido aceita troca/devolução de itens (entregue ou concluído). */
  canAdjustItems?: boolean;
  /** Detalhe: trocas e devoluções já feitas, da mais recente para a mais antiga. */
  adjustments?: OrderAdjustment[];

  /**
   * Nome do cliente, plano.
   *
   * AE-14: o dashboard lia `customerName` e a API só devolvia
   * `customer: { name }` aninhado — a coluna CLIENTE ficava vazia com o nome
   * ali do lado no banco. `undefined` renderiza como célula em branco, então
   * ninguém percebe que o contrato quebrou.
   */
  customerName?: string | null;
}

export type OrderAdjustmentType = 'EXCHANGE' | 'RETURN';

/** Troca ou devolução de um item, como `GET /orders/:id` devolve em `adjustments`. */
export interface OrderAdjustment {
  id: string;
  type: OrderAdjustmentType;
  quantity: number;
  returnedName: string;
  returnedSku: string;
  /** O que o cliente tinha pago pelas unidades devolvidas. */
  returnedValue: number;
  newName: string | null;
  newSku: string | null;
  newValue: number;
  /** > 0: cliente pagou. < 0: a loja devolveu. */
  difference: number;
  /** Parte da devolução abatida do que o cliente ainda devia no pedido. */
  abatedAmount: number;
  receivableId: string | null;
  payableId: string | null;
  reason: string | null;
  createdAt: string;
}

/** Resposta de `POST /orders/:id/exchange` e `POST /orders/:id/return-item`. */
export interface OrderItemAdjustmentResult {
  adjustmentId: string;
  type: OrderAdjustmentType;
  orderId: string;
  orderItemId: string;
  newOrderItemId: string | null;
  quantity: number;
  returnedValue: number;
  newValue: number;
  difference: number;
  differenceKind: 'RECEIVABLE' | 'PAYABLE' | 'NONE';
  abatedAmount: number;
  refundAmount: number;
  receivableId: string | null;
  payableId: string | null;
  /** A diferença foi recebida/devolvida no ato (senão o título ficou em aberto). */
  settled: boolean;
  subtotal: number;
  discount: number;
  totalAmount: number;
  status: OrderStatus;
}

/** One entry of `order.statusHistory` (not `order.history`). */
export interface OrderStatusHistoryEntry {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  notes?: string | null;
  changedBy?: string | null;
  /** Resolved by the API — `changedBy` alone is an opaque id. */
  changedByName?: string | null;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  document: string;

  /**
   * Totais agregados pela API (AE-13).
   *
   * A listagem lia `totalOrders`/`totalSpent` e a API devolvia `_count.orders`:
   * um cliente com três pedidos aparecia como se nunca tivesse comprado.
   * Contam apenas pedidos que viraram venda — cancelado, devolvido e rascunho
   * ficam de fora.
   */
  totalOrders?: number;
  totalSpent?: number;
}

/** Depósito, como a listagem de estoque o lê. */
export interface Warehouse {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  /**
   * AE-12b: cidade, UF e CEP são campos próprios. O serviço os concatenava
   * dentro de `address` e o card exibia ", -", lendo campos inexistentes.
   */
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  isDefault: boolean;
  /**
   * AE-12d: um depósito com histórico é **desativado**, nunca excluído — os
   * movimentos que apontam para ele são o rastro de auditoria de toda entrada
   * e saída que ele viu. A tela precisa distinguir os dois estados.
   */
  isActive?: boolean;
  /** Itens de estoque no depósito — o card mostra "12 produtos". */
  productCount?: number;
}

export interface InventoryItem {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  reserved: number;
  available: number;
}

// ─── API response types ────────────────────────────────────────────────

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: PaginationMeta;
}

// ─── Auth types ────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;
  tenantId: string;
  roleId: string;
  email: string;
}
