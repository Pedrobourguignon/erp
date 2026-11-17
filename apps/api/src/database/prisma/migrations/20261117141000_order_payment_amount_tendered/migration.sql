-- Recibo: quanto o cliente entregou em dinheiro (o troco é a diferença).
ALTER TABLE "order_payments" ADD COLUMN "amountTendered" DECIMAL(15,2);
