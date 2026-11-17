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
  /** Opcional: a API devolve `null` quando não foi informado. */
  email: string | null;
  /** Opcional: a API devolve `null` quando não foi informado. */
  document: string | null;

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
  /** Linha de um tamanho/cor; null no produto sem variações. */
  variantId: string | null;
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

// ─── Recibo do cliente (não fiscal) ─────────────────────────────────────
// Prontos para o papel: a API já devolve os textos e o documento mascarado,
// e nada além do que vai impresso (sem custo, sem IDs internos).

export type ReceiptFormat = 'THERMAL_80' | 'THERMAL_58' | 'A4';

export interface ReceiptStore {
  name: string;
  /** CNPJ formatado. */
  document: string;
  phone: string | null;
  /** Uma linha: "Rua X, 123 - Centro - São Paulo/SP - CEP 01000-000". */
  address: string | null;
}

export interface ReceiptCustomer {
  name: string;
  /** "CPF ***.456.789-**" ou "CNPJ 12.345.678/0001-90"; null sem documento. */
  document: string | null;
}

/** O que vale para todo recibo: cabeçalho, via e rodapé. */
export interface ReceiptHeader {
  format: ReceiptFormat;
  footer: string | null;
  /** 1 = original; 2 em diante = reimpressão ("2ª VIA"). */
  copy: number;
  printedAt: string;
  store: ReceiptStore;
  orderNumber: string;
  customer: ReceiptCustomer | null;
}

export interface SaleReceiptItem {
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}

export interface SaleReceiptPayment {
  method: string;
  amount: number;
  installments: number;
  /** Valor de cada parcela, como a venda dividiu (ex.: [33.34, 33.33, 33.33]). */
  installmentValues: number[];
  /** Só no dinheiro com troco. */
  tendered: number | null;
  change: number | null;
}

export interface SaleReceipt extends ReceiptHeader {
  kind: 'SALE';
  soldAt: string;
  seller: string | null;
  cashRegister: string | null;
  items: SaleReceiptItem[];
  subtotal: number;
  discount: number;
  shippingCost: number;
  total: number;
  payments: SaleReceiptPayment[];
}

export interface ExchangeReceiptItem {
  name: string;
  sku: string;
  quantity: number;
  value: number;
}

export interface ExchangeReceipt extends ReceiptHeader {
  kind: 'EXCHANGE' | 'RETURN';
  adjustedAt: string;
  returned: ExchangeReceiptItem;
  /** Só na troca. */
  received: ExchangeReceiptItem | null;
  /** > 0: o cliente pagou a diferença. < 0: a loja devolveu. */
  difference: number;
  /** Parte da devolução abatida de parcelas em aberto do pedido. */
  abatedAmount: number;
  reason: string | null;
}

// ─── Leitura de código de barras (busca exata) ─────────────────────────

/** O que entra no carrinho: um produto simples ou uma variação. */
export interface SaleCandidate {
  productId: string;
  variantId: string | null;
  /** "Camiseta Básica — M" na variação. */
  name: string;
  sku: string;
  ean: string | null;
  /** Preço da variação quando ela tem, senão o do produto. */
  salePrice: number;
  /** Disponível somando os depósitos (da variação, quando houver). */
  available: number;
}

/**
 * Resposta de `GET /products/lookup`. Um produto com variações lido pelo
 * código do pai não decide sozinho o tamanho/cor: a tela pergunta.
 */
export type ProductLookupResult =
  | { kind: 'MATCH'; item: SaleCandidate }
  | { kind: 'CHOOSE_VARIANT'; productId: string; productName: string; variants: SaleCandidate[] }
  /** Etiqueta desconhecida: resultado normal da leitura, não um erro HTTP. */
  | { kind: 'NOT_FOUND'; code: string; message: string };

/** `GET /products/barcode-duplicates`: um código cadastrado em mais de um lugar. */
export interface BarcodeDuplicate {
  ean: string;
  owners: { productId: string; variantId: string | null; name: string; sku: string }[];
}
