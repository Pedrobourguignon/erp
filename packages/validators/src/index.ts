import { z } from 'zod';

// ─── Auth schemas ──────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ─── Product schemas ───────────────────────────────────────────────────

export const createProductSchema = z.object({
  sku: z.string().min(1, 'SKU is required').max(50),
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(2000).optional(),
  costPrice: z.number().nonnegative('Cost price must be non-negative'),
  salePrice: z.number().positive('Sale price must be positive'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT']).default('DRAFT'),
  categoryId: z.string().uuid().optional(),
  weight: z.number().nonnegative().optional(),
  ean: z.string().max(50).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

// ─── Order schemas ─────────────────────────────────────────────────────

export const orderItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive('Quantity must be at least 1'),
  unitPrice: z.number().positive('Unit price must be positive'),
  discount: z.number().nonnegative().default(0),
});

export const createOrderSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID').optional(),
  items: z.array(orderItemSchema).min(1, 'Order must have at least one item'),
  notes: z.string().max(1000).optional(),
  origin: z.enum(['MANUAL', 'MERCADO_LIVRE', 'SHOPEE', 'AMAZON', 'MAGALU', 'SHOPIFY', 'NUVEMSHOP', 'WOOCOMMERCE', 'API']).default('MANUAL'),
  shippingAddressId: z.string().uuid().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// ─── Customer schemas ──────────────────────────────────────────────────

export const createCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  email: z.string().email('Invalid email address'),
  document: z.string().min(11, 'Document is required').max(18),
  phone: z.string().min(10).max(15).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().length(2).optional(),
  zipCode: z.string().max(10).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

// ─── Inventory schemas ─────────────────────────────────────────────────

export const updateStockSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  warehouseId: z.string().uuid('Invalid warehouse ID'),
  quantity: z.number().int('Quantity must be an integer'),
  reason: z.string().min(1, 'Reason is required').max(255),
  referenceType: z.enum(['purchase', 'sale', 'adjustment', 'return', 'transfer']).optional(),
  referenceId: z.string().uuid().optional(),
});

export type UpdateStockInput = z.infer<typeof updateStockSchema>;

// ─── Pagination schema ─────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().max(255).optional(),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

// ─── Order money math ──────────────────────────────────────────────────

export * from './order-money';
export * from './order-adjustment';
export * from './br-documents';
export * from './br-fiscal';
export * from './password';
