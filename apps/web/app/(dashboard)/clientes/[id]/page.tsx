"use client";

import {
  ArrowLeft,
  Mail,
  Phone,
  ShoppingCart,
  DollarSign,
  Loader2,
  Pencil,
  Trash2,
  User,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import React, { useState } from "react";

import { Can } from "@/components/auth/can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { TruncatedText } from "@/components/ui/truncated-text";
import { useCustomer, useDeleteCustomer } from "@/hooks/use-customers";
import { useOrders, type OrderListItem } from "@/hooks/use-orders";
import { maskDocument, maskPhone } from "@/lib/masks";
import { getMutationErrorMessage } from "@/lib/mutation-error";
import {
  formatCurrency,
  formatDateTime,
  cn,
} from "@/lib/utils";

import { AddressesTab } from "./_components/addresses-tab";



// ─── Tabs ───────────────────────────────────────────────────────────────

const tabs = [
  { id: "info", label: "Informações" },
  { id: "addresses", label: "Endereços" },
  { id: "orders", label: "Pedidos" },
] as const;

type TabId = (typeof tabs)[number]["id"];

// ─── Page ───────────────────────────────────────────────────────────────

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = params.id as string;

  const { data: customerResp, isLoading } = useCustomer(customerId);
  const deleteCustomer = useDeleteCustomer();
  const [activeTab, setActiveTab] = useState<TabId>("info");
  const [showDelete, setShowDelete] = useState(false);
  // AE-09: este `useToast()` ficava depois dos dois returns abaixo. Enquanto
  // carregava, ele não rodava; quando o cliente chegava, rodava — e o React
  // acusava "change in the order of Hooks called by CustomerDetailPage".
  const { addToast } = useToast();

  const customer = customerResp?.data;

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Cliente não encontrado</p>
        <Button variant="outline" onClick={() => router.back()}>Voltar</Button>
      </div>
    );
  }

  const handleDelete = async () => {
    try {
      await deleteCustomer.mutateAsync(customerId);
      addToast("Cliente excluído com sucesso!", "success");
      router.push("/clientes");
    } catch (err) {
      addToast(
        getMutationErrorMessage(
          err,
          "Erro ao excluir cliente. Tente novamente."
        ),
        "error"
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Tooltip content="Voltar">
            <Button variant="ghost" size="icon" className="shrink-0" onClick={() => router.back()}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Tooltip>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-3">
              <TruncatedText
                as="h1"
                text={customer.name}
                className="text-3xl font-bold tracking-tight"
              />
              <Badge variant="outline" className="shrink-0">{customer.documentType === "CPF" ? "Pessoa Física" : "Pessoa Jurídica"}</Badge>
            </div>
            <p className="text-muted-foreground font-mono">
              {customer.documentType ? maskDocument(customer.document, customer.documentType) : customer.document}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* AE-06: o ícone `Edit` estava importado e nunca usado, e
              `/clientes/[id]/edit` era 404 — o CRUD não tinha o "U". */}
          <Can permission="customers:update" mode="disable">
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/clientes/${customerId}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Link>
            </Button>
          </Can>
          <Can permission="customers:delete">
            <Button variant="destructive" size="sm" onClick={() => setShowDelete(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Excluir
            </Button>
          </Can>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard icon={<User className="h-5 w-5" />} label="Segmento" value={customer.segment ?? "Regular"} />
        <SummaryCard icon={<ShoppingCart className="h-5 w-5" />} label="Total de Pedidos" value={String(customer.totalOrders ?? 0)} />
        <SummaryCard icon={<DollarSign className="h-5 w-5" />} label="Total Gasto" value={formatCurrency(customer.totalSpent ?? 0)} />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "info" && <InfoTab customer={customer} />}
      {activeTab === "addresses" && (
        <AddressesTab customerId={customerId} addresses={customer.addresses ?? []} />
      )}
      {activeTab === "orders" && <OrdersTab customerId={customerId} />}

      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title="Excluir Cliente"
        message={`Deseja excluir o cliente "${customer.name}"? Esta ação não pode ser desfeita.`}
        destructive
        confirmLabel="Excluir"
        loading={deleteCustomer.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ─── Summary card ───────────────────────────────────────────────────────

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Info tab ───────────────────────────────────────────────────────────

function InfoTab({ customer }: { customer: { email: string; phone: string | null; createdAt: string } }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Informações de Contato</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex min-w-0 items-center gap-3">
          <Mail className="h-5 w-5 shrink-0 text-muted-foreground" />
          {/* Um e-mail é uma palavra só: não quebra em 390px e sai do cartão. */}
          <TruncatedText text={customer.email} />
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <Phone className="h-5 w-5 shrink-0 text-muted-foreground" />
          <TruncatedText text={maskPhone(customer.phone)} fallback="Telefone não informado" />
        </div>
        <div className="text-sm text-muted-foreground">
          Cliente desde {formatDateTime(customer.createdAt)}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Orders tab ─────────────────────────────────────────────────────────

function OrdersTab({ customerId }: { customerId: string }) {
  const { data, isLoading } = useOrders({ page: 1, limit: 10, customerId });
  const orders: OrderListItem[] = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Nenhum pedido encontrado para este cliente
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Pedido</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Data</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/vendas/pedidos/${order.id}`} className="font-medium text-primary hover:underline">
                      #{order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(order.createdAt)}</td>
                  <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(order.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
