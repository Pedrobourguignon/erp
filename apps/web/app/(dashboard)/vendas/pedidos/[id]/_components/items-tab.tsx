"use client";

import { Package } from "lucide-react";
import React, { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TruncatedText } from "@/components/ui/truncated-text";
import type { OrderDetail, OrderItem } from "@/hooks/use-orders";
import type { AdjustMode } from "@/lib/order-adjustment";
import { formatCurrency } from "@/lib/utils";

import { AdjustItemDialog } from "./adjust-item-dialog";
import { AdjustmentsList } from "./adjustments-list";
import { ItemAdjustActions } from "./item-adjust-actions";

interface ItemsTabProps {
  order: OrderDetail;
  /** Order-level values, so the footer matches what the API charged. */
  discount: number;
  shippingCost: number;
  totalAmount: number;
}

export function ItemsTab({
  order,
  discount,
  shippingCost,
  totalAmount,
}: ItemsTabProps) {
  const items = order.items ?? [];
  const canAdjust = !!order.canAdjustItems;
  const [target, setTarget] = useState<{ item: OrderItem; mode: AdjustMode } | null>(null);
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.totalPrice ?? 0),
    0
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Itens do Pedido</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Produto
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  SKU
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Qtd
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Preço Unit.
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Desconto
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Total
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt={item.productName}
                          className="h-10 w-10 rounded-md object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                          <Package className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <TruncatedText
                        text={item.productName ?? item.product?.name}
                        className="max-w-[32ch] font-medium"
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    <TruncatedText
                      text={item.sku ?? item.product?.sku}
                      className="max-w-[18ch]"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">{item.quantity}</td>
                  <td className="px-4 py-3 text-right">
                    {formatCurrency(Number(item.unitPrice))}
                  </td>
                  <td className="px-4 py-3 text-right text-destructive">
                    {Number(item.discount) > 0
                      ? `-${formatCurrency(Number(item.discount))}`
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {formatCurrency(Number(item.totalPrice))}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canAdjust ? (
                      <ItemAdjustActions
                        hasVariant={!!item.variantId}
                        onPick={(mode) => setTarget({ item, mode })}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
            {/* VD-06: the footer used to stop at the subtotal, so a shipping
                cost of R$ 10,00 made the header total look wrong. */}
            <tfoot className="bg-muted/30">
              <tr>
                <td colSpan={5} className="px-4 py-2 text-right">
                  Subtotal dos itens
                </td>
                <td className="px-4 py-2 text-right">
                  {formatCurrency(subtotal)}
                </td>
                <td />
              </tr>
              {discount > 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-2 text-right">
                    Desconto do pedido
                  </td>
                  <td className="px-4 py-2 text-right text-destructive">
                    -{formatCurrency(discount)}
                  </td>
                  <td />
                </tr>
              )}
              <tr>
                <td colSpan={5} className="px-4 py-2 text-right">
                  Frete
                </td>
                <td className="px-4 py-2 text-right">
                  {formatCurrency(shippingCost)}
                </td>
                <td />
              </tr>
              <tr className="border-t">
                <td colSpan={5} className="px-4 py-3 text-right font-semibold">
                  Total
                </td>
                <td className="px-4 py-3 text-right font-semibold">
                  {formatCurrency(totalAmount)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>

      {order.adjustments?.length ? (
        <CardContent className="border-t pt-6">
          <AdjustmentsList adjustments={order.adjustments} />
        </CardContent>
      ) : null}

      <AdjustItemDialog
        open={!!target}
        onOpenChange={(open) => !open && setTarget(null)}
        order={order}
        item={target?.item ?? null}
        initialMode={target?.mode ?? "return"}
      />
    </Card>
  );
}
