import type { ExchangeReceipt, ExchangeReceiptItem } from "@erp/shared-types";
import { roundMoney } from "@erp/validators";
import React from "react";

import { formatCurrency, formatDateTime } from "@/lib/utils";

import { ReceiptDivider, ReceiptLine } from "./receipt-parts";

function ItemBlock({ title, item }: { title: string; item: ExchangeReceiptItem }) {
  return (
    <div>
      <p className="font-bold">{title}</p>
      <p className="break-all">{item.name}</p>
      <ReceiptLine label={`${item.quantity} un. · ${item.sku}`} value={formatCurrency(item.value)} />
    </div>
  );
}

export function ExchangeReceiptBody({ receipt }: { receipt: ExchangeReceipt }) {
  const refund = receipt.difference < 0 ? roundMoney(-receipt.difference - receipt.abatedAmount) : 0;

  return (
    <>
      <p>Data: {formatDateTime(receipt.adjustedAt)}</p>
      <ReceiptDivider />
      <ItemBlock title="Devolveu" item={receipt.returned} />
      {receipt.received ? (
        <div className="mt-1">
          <ItemBlock title="Levou" item={receipt.received} />
        </div>
      ) : null}

      <ReceiptDivider />
      {receipt.difference > 0 ? (
        <ReceiptLine label="Diferença paga pelo cliente" value={formatCurrency(receipt.difference)} strong />
      ) : null}
      {receipt.abatedAmount > 0 ? (
        <ReceiptLine label="Abatido de parcelas em aberto" value={formatCurrency(receipt.abatedAmount)} />
      ) : null}
      {refund > 0 ? (
        <ReceiptLine label="Devolvido ao cliente" value={formatCurrency(refund)} strong />
      ) : null}
      {receipt.difference === 0 ? <p>Sem diferença de valor</p> : null}
      {receipt.reason ? <p className="mt-1 break-words">Motivo: {receipt.reason}</p> : null}
    </>
  );
}
