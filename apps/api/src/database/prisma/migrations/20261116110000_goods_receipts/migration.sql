-- Entrada de mercadoria por nota fiscal (ADR 0004).
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accessKey" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "issuedDate" TIMESTAMP(3) NOT NULL,
    "supplierId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "totalAmount" DECIMAL(15,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goods_receipt_items" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "line" INTEGER NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(15,4) NOT NULL,
    "totalCost" DECIMAL(15,2) NOT NULL,
    "createdProduct" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_product_codes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_product_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "goods_receipts_tenantId_accessKey_key" ON "goods_receipts"("tenantId", "accessKey");
CREATE INDEX "goods_receipts_tenantId_supplierId_idx" ON "goods_receipts"("tenantId", "supplierId");
CREATE INDEX "goods_receipt_items_receiptId_idx" ON "goods_receipt_items"("receiptId");
CREATE INDEX "goods_receipt_items_productId_idx" ON "goods_receipt_items"("productId");
CREATE UNIQUE INDEX "supplier_product_codes_tenantId_supplierId_supplierCode_key" ON "supplier_product_codes"("tenantId", "supplierId", "supplierCode");
CREATE INDEX "supplier_product_codes_productId_idx" ON "supplier_product_codes"("productId");

ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_product_codes" ADD CONSTRAINT "supplier_product_codes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_product_codes" ADD CONSTRAINT "supplier_product_codes_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_product_codes" ADD CONSTRAINT "supplier_product_codes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
