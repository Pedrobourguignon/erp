-- Baixa automática dos títulos de uma forma de pagamento, no dia do vencimento.
ALTER TABLE "payment_methods"
  ADD COLUMN "autoSettle" BOOLEAN NOT NULL DEFAULT false;
