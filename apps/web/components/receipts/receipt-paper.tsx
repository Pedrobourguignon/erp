import type { ReceiptHeader } from "@erp/shared-types";
import React from "react";

import { copyLabel, RECEIPT_WIDTH_CLASS } from "@/lib/receipt-format";
import { cn, formatDateTime } from "@/lib/utils";

import { ReceiptDivider } from "./receipt-parts";

/**
 * The frame every receipt shares: store, title, customer, then the body, the
 * store footer and the notice that this is not a fiscal document. Black on
 * white only — thermal printers have no greys.
 */
export function ReceiptPaper({ receipt, title, children }: {
  receipt: ReceiptHeader;
  title: string;
  children: React.ReactNode;
}) {
  const copy = copyLabel(receipt.copy);
  const { store, customer } = receipt;

  return (
    <article className={cn("bg-white p-1 font-mono leading-snug text-black", RECEIPT_WIDTH_CLASS[receipt.format])}>
      <header className="text-center">
        <p className="break-words font-bold uppercase">{store.name}</p>
        <p>CNPJ {store.document}</p>
        {store.address ? <p className="break-words">{store.address}</p> : null}
        {store.phone ? <p>Tel. {store.phone}</p> : null}
      </header>

      <ReceiptDivider />
      <p className="text-center font-bold">{title}</p>
      {copy ? <p className="text-center font-bold">{copy}</p> : null}
      <p className="text-center">Pedido {receipt.orderNumber}</p>

      {customer ? (
        <>
          <ReceiptDivider />
          <p className="break-words">Cliente: {customer.name}</p>
          {customer.document ? <p>{customer.document}</p> : null}
        </>
      ) : null}

      <ReceiptDivider />
      {children}

      <ReceiptDivider />
      {receipt.footer ? <p className="whitespace-pre-line break-words text-center">{receipt.footer}</p> : null}
      <p className="mt-1 text-center font-bold">NÃO É DOCUMENTO FISCAL</p>
      <p className="text-center">Impresso em {formatDateTime(receipt.printedAt)}</p>
    </article>
  );
}
