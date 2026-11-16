-- Sangria e suprimento são transferências entre a gaveta e outra conta (ADR 0003).

-- Conta do cofre de cada caixa: destino padrão da sangria e origem padrão do suprimento.
ALTER TABLE "cash_registers" ADD COLUMN "vaultAccountId" TEXT;

-- Em cada sangria/suprimento: a conta do outro lado (destino ou origem) e a transferência financeira.
ALTER TABLE "cash_register_movements" ADD COLUMN "counterpartAccountId" TEXT,
ADD COLUMN "transferId" TEXT;

CREATE INDEX "cash_register_movements_counterpartAccountId_idx" ON "cash_register_movements"("counterpartAccountId");

ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_vaultAccountId_fkey" FOREIGN KEY ("vaultAccountId") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cash_register_movements" ADD CONSTRAINT "cash_register_movements_counterpartAccountId_fkey" FOREIGN KEY ("counterpartAccountId") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
