-- Recibo do cliente: o lojista escolhe o papel da impressora e o rodapé.
CREATE TYPE "ReceiptFormat" AS ENUM ('THERMAL_80', 'THERMAL_58', 'A4');

ALTER TABLE "tenants"
    ADD COLUMN "receiptFormat" "ReceiptFormat" NOT NULL DEFAULT 'THERMAL_80',
    ADD COLUMN "receiptFooter" VARCHAR(300);
