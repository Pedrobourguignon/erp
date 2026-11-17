-- Leitor de código de barras: um EAN, um produto por empresa.
--
-- O serviço já recusa o código repetido em todo caminho que grava EAN
-- (cadastro, planilha, nota de compra), incluindo as variações. O banco garante
-- a parte que um índice alcança: o EAN do produto. A variação não tem tenantId,
-- então a unicidade entre produto e variação fica no serviço.
--
-- Nenhum dado é alterado: se já houver EAN repetido, o índice não é criado e o
-- deploy segue. O lojista vê os repetidos em Produtos ("códigos de barras
-- repetidos") e, resolvidos, uma migration seguinte cria o índice.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "products"
     WHERE "ean" IS NOT NULL AND "ean" <> '' AND "deletedAt" IS NULL
     GROUP BY "tenantId", "ean"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'products_tenantId_ean_key não criado: há EAN repetido no mesmo tenant';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "products_tenantId_ean_key"
      ON "products"("tenantId", "ean")
      WHERE "ean" IS NOT NULL AND "ean" <> '' AND "deletedAt" IS NULL;
  END IF;
END $$;
