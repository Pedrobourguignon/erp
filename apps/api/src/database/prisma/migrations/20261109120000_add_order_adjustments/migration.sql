-- CreateEnum
CREATE TYPE "OrderAdjustmentType" AS ENUM ('EXCHANGE', 'RETURN');

-- CreateTable
CREATE TABLE "order_adjustments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderAdjustmentType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "returnedProductId" TEXT NOT NULL,
    "returnedVariantId" TEXT,
    "returnedSku" TEXT NOT NULL,
    "returnedName" TEXT NOT NULL,
    "returnedGross" DECIMAL(15,2) NOT NULL,
    "discountShare" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "returnedValue" DECIMAL(15,2) NOT NULL,
    "newOrderItemId" TEXT,
    "newProductId" TEXT,
    "newVariantId" TEXT,
    "newSku" TEXT,
    "newName" TEXT,
    "newUnitPrice" DECIMAL(15,2),
    "newValue" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "difference" DECIMAL(15,2) NOT NULL,
    "abatedAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "receivableId" TEXT,
    "payableId" TEXT,
    "reason" VARCHAR(500),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_adjustments_tenantId_orderId_idx" ON "order_adjustments"("tenantId", "orderId");

-- AddForeignKey
ALTER TABLE "order_adjustments" ADD CONSTRAINT "order_adjustments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_adjustments" ADD CONSTRAINT "order_adjustments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
