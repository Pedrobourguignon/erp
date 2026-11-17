import type { ExchangeReceipt, SaleReceipt } from "@erp/shared-types";
import React from "react";

import { ExchangeReceiptBody } from "./exchange-receipt-body";
import { ReceiptPaper } from "./receipt-paper";
import { SaleReceiptBody } from "./sale-receipt-body";

export type PrintableReceipt = SaleReceipt | ExchangeReceipt;

const TITLES: Record<PrintableReceipt["kind"], string> = {
  SALE: "RECIBO DE VENDA",
  EXCHANGE: "COMPROVANTE DE TROCA",
  RETURN: "COMPROVANTE DE DEVOLUÇÃO",
};

/** The customer receipt as it goes on paper, in the store's format. */
export function ReceiptDocument({ receipt }: { receipt: PrintableReceipt }) {
  return (
    <ReceiptPaper receipt={receipt} title={TITLES[receipt.kind]}>
      {receipt.kind === "SALE" ? (
        <SaleReceiptBody receipt={receipt} />
      ) : (
        <ExchangeReceiptBody receipt={receipt} />
      )}
    </ReceiptPaper>
  );
}
