-- O vendedor passa a digitar o número de parcelas na venda; o método diz até
-- quantas aceita. A condição de pagamento sai da venda.
ALTER TABLE "payment_methods" ADD COLUMN "maxInstallments" INTEGER NOT NULL DEFAULT 1;

-- Preserva o que cada método já permitia: o maior parcelamento entre as
-- condições ativas que valiam para ele (as vinculadas a ele e as sem vínculo,
-- que apareciam para qualquer método). Métodos à vista continuam em 1.
UPDATE "payment_methods" pm
SET "maxInstallments" = sub.max_installments
FROM (
  SELECT pm2.id, MAX(pc.installments) AS max_installments
  FROM "payment_methods" pm2
  JOIN "payment_conditions" pc
    ON pc."tenantId" = pm2."tenantId"
   AND pc."isActive" = true
   AND (
     EXISTS (SELECT 1 FROM "_PaymentConditionToPaymentMethod" l
             WHERE l."A" = pc.id AND l."B" = pm2.id)
     OR NOT EXISTS (SELECT 1 FROM "_PaymentConditionToPaymentMethod" l
                    WHERE l."A" = pc.id)
   )
  WHERE pm2.type NOT IN ('CASH', 'PIX', 'DEBIT_CARD')
  GROUP BY pm2.id
) sub
WHERE pm.id = sub.id
  AND sub.max_installments > 1;
