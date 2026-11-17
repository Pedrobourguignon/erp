-- Maquininhas: taxas e prazos do cartão saem do método de pagamento e passam a
-- morar na maquininha (o contrato com a operadora). O método de cartão aponta
-- para ela.

CREATE TYPE "CardReceiveMode" AS ENUM ('FLOW', 'ANTICIPATED');

CREATE TABLE "card_machines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "provider" VARCHAR(50),
    "debitFeePercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "debitSettlementDays" INTEGER NOT NULL DEFAULT 1,
    "creditReceiveMode" "CardReceiveMode" NOT NULL DEFAULT 'FLOW',
    "creditSettlementDays" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "card_machines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "card_machines_tenantId_idx" ON "card_machines"("tenantId");
ALTER TABLE "card_machines" ADD CONSTRAINT "card_machines_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "card_machine_rates" (
    "id" TEXT NOT NULL,
    "cardMachineId" TEXT NOT NULL,
    "installments" INTEGER NOT NULL,
    "feePercentage" DECIMAL(5,2) NOT NULL,
    CONSTRAINT "card_machine_rates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "card_machine_rates_cardMachineId_installments_key"
    ON "card_machine_rates"("cardMachineId", "installments");
ALTER TABLE "card_machine_rates" ADD CONSTRAINT "card_machine_rates_cardMachineId_fkey"
    FOREIGN KEY ("cardMachineId") REFERENCES "card_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_methods" ADD COLUMN "cardMachineId" TEXT;
CREATE INDEX "payment_methods_cardMachineId_idx" ON "payment_methods"("cardMachineId");
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_cardMachineId_fkey"
    FOREIGN KEY ("cardMachineId") REFERENCES "card_machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cada método de cartão existente ganha uma maquininha com o nome dele e as
-- mesmas taxas e prazos de hoje, para nada mudar no dia do deploy. O lojista
-- junta as que forem do mesmo contrato depois.
INSERT INTO "card_machines" (
    "id", "tenantId", "name",
    "debitFeePercentage", "debitSettlementDays",
    "creditReceiveMode", "creditSettlementDays",
    "isActive", "updatedAt"
)
SELECT
    'cm_' || pm.id,
    pm."tenantId",
    LEFT(pm.name, 100),
    CASE WHEN pm.type = 'DEBIT_CARD' THEN COALESCE(pm."feePercentage", 0) ELSE 0 END,
    CASE WHEN pm.type = 'DEBIT_CARD' THEN COALESCE(pm."settlementDays", 0) ELSE 1 END,
    'FLOW',
    CASE WHEN pm.type = 'CREDIT_CARD' THEN COALESCE(NULLIF(pm."settlementDays", 0), 30) ELSE 30 END,
    pm."isActive",
    CURRENT_TIMESTAMP
FROM "payment_methods" pm
WHERE pm.type IN ('CREDIT_CARD', 'DEBIT_CARD');

-- Crédito: a taxa única de hoje vale de 1x até o máximo de parcelas do método.
INSERT INTO "card_machine_rates" ("id", "cardMachineId", "installments", "feePercentage")
SELECT
    'cmr_' || pm.id || '_' || n,
    'cm_' || pm.id,
    n,
    COALESCE(pm."feePercentage", 0)
FROM "payment_methods" pm
CROSS JOIN LATERAL generate_series(1, GREATEST(pm."maxInstallments", 1)) AS n
WHERE pm.type = 'CREDIT_CARD';

UPDATE "payment_methods"
SET "cardMachineId" = 'cm_' || id
WHERE type IN ('CREDIT_CARD', 'DEBIT_CARD');
