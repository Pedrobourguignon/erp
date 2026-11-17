"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import React, { useMemo, useState } from "react";

import { Can } from "@/components/auth/can";
import { RequirePermission } from "@/components/auth/require-permission";
import { DataTable, type ColumnDef } from "@/components/tables/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { useCardMachines, useDeleteCardMachine, type CardMachine } from "@/hooks/use-card-machines";
import {
  describeCreditReceipt,
  describeDebitReceipt,
  summarizeRates,
} from "@/lib/card-machine-format";
import { getMutationErrorMessage } from "@/lib/mutation-error";

import { CardMachineFormDialog } from "./_components/card-machine-form-dialog";

const percent = (value: number) =>
  `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

function useColumns(onEdit: (m: CardMachine) => void, onDelete: (m: CardMachine) => void) {
  return useMemo<ColumnDef<CardMachine>[]>(() => [
    {
      id: "name",
      header: "Maquininha",
      accessor: "name",
      cell: (m) => (
        <div className="min-w-0">
          <span className="block truncate font-medium">{m.name}</span>
          {m.provider ? <span className="block truncate text-xs text-muted-foreground">{m.provider}</span> : null}
        </div>
      ),
    },
    {
      id: "debit",
      header: "Débito",
      accessor: (m) => `${percent(m.debitFeePercentage)} · ${describeDebitReceipt(m.debitSettlementDays)}`,
      cell: (m) => (
        <div>
          <span className="block">{percent(m.debitFeePercentage)}</span>
          <span className="block text-xs text-muted-foreground">{describeDebitReceipt(m.debitSettlementDays)}</span>
        </div>
      ),
    },
    {
      id: "credit",
      header: "Crédito",
      maxCh: 48,
      accessor: (m) => summarizeRates(m.rates),
      cell: (m) => (
        <div className="min-w-0">
          <span className="block truncate">{summarizeRates(m.rates)}</span>
          {m.rates.length > 0 && (
            <span className="block truncate text-xs text-muted-foreground">
              {describeCreditReceipt(m.creditReceiveMode, m.creditSettlementDays)}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessor: (m) => (m.isActive ? "Ativa" : "Inativa"),
      cell: (m) => (
        <Badge variant={m.isActive ? "success" : "secondary"}>{m.isActive ? "Ativa" : "Inativa"}</Badge>
      ),
    },
    {
      id: "actions",
      header: "Ações",
      noTruncate: true,
      headerClassName: "text-right",
      cell: (m) => (
        <div className="flex justify-end gap-1">
          <Can permission="financial:update" mode="disable">
            <Tooltip content="Editar">
              <Button variant="ghost" size="icon" aria-label={`Editar ${m.name}`} onClick={() => onEdit(m)}>
                <Pencil className="h-4 w-4" />
              </Button>
            </Tooltip>
          </Can>
          <Can permission="financial:delete" mode="disable">
            <Tooltip content="Excluir">
              <Button variant="ghost" size="icon" action="delete" aria-label={`Excluir ${m.name}`} onClick={() => onDelete(m)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </Tooltip>
          </Can>
        </div>
      ),
    },
  ], [onEdit, onDelete]);
}

function CardMachinesPageContent() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CardMachine | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CardMachine | null>(null);
  const { addToast } = useToast();
  const { data, isLoading, error, refetch } = useCardMachines();
  const deleteMutation = useDeleteCardMachine();
  const machines = data?.data ?? [];

  const openForm = (machine: CardMachine | null) => {
    setEditing(machine);
    setFormOpen(true);
  };
  const columns = useColumns(openForm, setDeleteTarget);

  const handleDelete = async () => {
    if (!deleteTarget) {return;}
    try {
      const result = await deleteMutation.mutateAsync(deleteTarget.id);
      addToast(result.data.message, "success");
      setDeleteTarget(null);
    } catch (err) {
      addToast(getMutationErrorMessage(err, "Erro ao excluir a maquininha. Tente novamente."), "error");
    }
  };

  const linked = deleteTarget?._count?.paymentMethods ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">Maquininhas</h1>
          <p className="text-muted-foreground">
            Taxas e prazos de cada maquininha. Vincule-as às formas de pagamento de cartão.
          </p>
        </div>
        <Can permission="financial:create" mode="disable">
          <Button onClick={() => openForm(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Nova maquininha
          </Button>
        </Can>
      </div>

      <DataTable
        columns={columns}
        data={machines}
        pagination={{ page: 1, limit: 100, total: machines.length }}
        onPageChange={() => {}}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        emptyMessage="Nenhuma maquininha cadastrada"
        emptyDescription="Cadastre a maquininha com as taxas do débito e do crédito para as vendas no cartão calcularem a taxa sozinhas."
      />

      <CardMachineFormDialog open={formOpen} onOpenChange={setFormOpen} editing={editing} />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) {setDeleteTarget(null);} }}
        title="Excluir maquininha"
        message={linked > 0
          ? `"${deleteTarget?.name}" está vinculada a ${linked === 1 ? "1 forma de pagamento" : `${linked} formas de pagamento`} e será inativada em vez de excluída.`
          : `Deseja excluir "${deleteTarget?.name}"?`}
        destructive
        confirmLabel={linked > 0 ? "Inativar" : "Excluir"}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

export default function CardMachinesPage() {
  return (
    <RequirePermission permission="financial:read" subject="as maquininhas">
      <CardMachinesPageContent />
    </RequirePermission>
  );
}
