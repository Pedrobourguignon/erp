-- Recibo do cliente: conta as vias impressas (da 2ª em diante sai "2ª VIA").
ALTER TABLE "orders" ADD COLUMN "receiptPrintCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "order_adjustments" ADD COLUMN "receiptPrintCount" INTEGER NOT NULL DEFAULT 0;
