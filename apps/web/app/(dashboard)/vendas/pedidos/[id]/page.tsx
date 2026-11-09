"use client";

import {
  ArrowLeft,
  Clock,
  CreditCard,
  Loader2,
  Package,
  Truck,
  User,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import React, { useState } from "react";

import { StatusActions } from "@/components/orders/status-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import { useOrder } from "@/hooks/use-orders";
import { formatCurrency, formatDateTime, cn } from "@/lib/utils";



import { CustomerTab } from "./_components/customer-tab";
import { FinanceTab } from "./_components/finance-tab";
import { HistoryTab } from "./_components/history-tab";
import { ItemsTab } from "./_components/items-tab";
import { ShippingTab } from "./_components/shipping-tab";

const tabs = [
  { id: "itens", label: "Itens", icon: Package },
  { id: "cliente", label: "Cliente", icon: User },
  { id: "envio", label: "Envio", icon: Truck },
  { id: "financeiro", label: "Financeiro", icon: CreditCard },
  { id: "historico", label: "Histórico", icon: Clock },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;

  const { data: orderResp, isLoading } = useOrder(orderId);
  const [activeTab, setActiveTab] = useState<TabId>("itens");

  const order = orderResp?.data;

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Pedido não encontrado</p>
        <Button variant="outline" onClick={() => router.back()}>
          Voltar
        </Button>
      </div>
    );
  }

  const shippingCost = Number(order.shippingCost ?? 0);
  const orderDiscount = Number(order.discount ?? 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Tooltip content="Voltar">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Tooltip>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">
                Pedido #{order.orderNumber}
              </h1>
              <StatusBadge status={order.status} size="md" />
            </div>
            <p className="text-muted-foreground">
              {order.customerName ?? order.customer?.name} &mdash;{" "}
              {formatDateTime(order.createdAt)}
            </p>
          </div>
        </div>

        <StatusActions
          orderId={orderId}
          orderNumber={order.orderNumber}
          allowedTransitions={order.allowedTransitions}
          origin={order.origin}
          status={order.status}
        />
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total do Pedido</p>
            <p className="text-xl font-bold">
              {formatCurrency(Number(order.totalAmount))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Itens</p>
            <p className="text-xl font-bold">{order.items?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Origem</p>
            <p className="text-xl font-bold capitalize">{order.origin}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            {/* VD-06: this card read `order.shipping.cost`, a field the API
                never returned, so every order showed "Frete R$ 0,00". */}
            <p className="text-xs text-muted-foreground">Frete</p>
            <p className="text-xl font-bold">{formatCurrency(shippingCost)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground"
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "itens" && (
        <ItemsTab
          order={order}
          discount={orderDiscount}
          shippingCost={shippingCost}
          totalAmount={Number(order.totalAmount)}
        />
      )}
      {activeTab === "cliente" && <CustomerTab order={order} />}
      {activeTab === "envio" && <ShippingTab order={order} />}
      {activeTab === "financeiro" && <FinanceTab order={order} />}
      {activeTab === "historico" && (
        <HistoryTab history={order.statusHistory ?? []} />
      )}
    </div>
  );
}
