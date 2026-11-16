-- Data de nascimento do cliente (opcional). Data civil: meia-noite no fuso do lojista.
ALTER TABLE "customers" ADD COLUMN "birthDate" TIMESTAMP(3);
