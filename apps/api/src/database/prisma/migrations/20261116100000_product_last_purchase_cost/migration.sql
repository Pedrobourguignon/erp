-- Último custo de compra do produto; o custo de cadastro passa a acompanhar a média.
ALTER TABLE "products"
  ADD COLUMN "lastPurchaseCost" DECIMAL(15,4),
  ADD COLUMN "lastPurchaseAt" TIMESTAMP(3);
