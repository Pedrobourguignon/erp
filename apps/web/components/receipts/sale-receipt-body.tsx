import type { SaleReceipt } from "@erp/shared-types";
import React from "react";

import { installmentsLabel } from "@/lib/receipt-format";
import { formatCurrency, formatDateTime } from "@/lib/utils";

import { ReceiptDivider, ReceiptLine } from "./receipt-parts";

export function SaleReceiptBody({ receipt }: { receipt: SaleReceipt }) {
  return (
    <>
      <p>Data: {formatDateTime(receipt.soldAt)}</p>
      {receipt.seller ? <p className="break-words">Vendedor: {receipt.seller}</p> : null}
      {receipt.cashRegister ? <p className="break-words">Caixa: {receipt.cashRegister}</p> : null}

      {receipt.items.length > 0 ? (
        <>
          <ReceiptDivider />
          <ul className="space-y-1">
            {receipt.items.map((item, index) => (
              <li key={`${item.sku}-${index}`}>
                {/* An unbroken 255-char name must wrap, not run off the paper. */}
                <p className="break-all">{item.name}</p>
                <ReceiptLine
                  label={`${item.quantity} x ${formatCurrency(item.unitPrice)}`}
                  value={formatCurrency(item.total)}
                />
                {item.discount > 0 ? (
                  <ReceiptLine label="Desconto do item" value={`-${formatCurrency(item.discount)}`} />
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <ReceiptDivider />
      <ReceiptLine label="Subtotal" value={formatCurrency(receipt.subtotal)} />
      {receipt.discount > 0 ? (
        <ReceiptLine label="Desconto" value={`-${formatCurrency(receipt.discount)}`} />
      ) : null}
      {receipt.shippingCost > 0 ? (
        <ReceiptLine label="Frete" value={formatCurrency(receipt.shippingCost)} />
      ) : null}
      <ReceiptLine label="TOTAL" value={formatCurrency(receipt.total)} strong className="text-[1.15em]" />

      {receipt.payments.length > 0 ? (
        <>
          <ReceiptDivider />
          <p className="font-bold">Pagamento</p>
          {receipt.payments.map((payment, index) => {
            const installments = installmentsLabel(payment.installmentValues);
            return (
              <div key={`${payment.method}-${index}`}>
                <ReceiptLine label={payment.method} value={formatCurrency(payment.amount)} />
                {installments ? <p className="pl-2">{installments}</p> : null}
                {payment.tendered !== null ? (
                  <ReceiptLine className="pl-2" label="Recebido" value={formatCurrency(payment.tendered)} />
                ) : null}
                {payment.change !== null ? (
                  <ReceiptLine className="pl-2" label="Troco" value={formatCurrency(payment.change)} />
                ) : null}
              </div>
            );
          })}
        </>
      ) : null}
    </>
  );
}
