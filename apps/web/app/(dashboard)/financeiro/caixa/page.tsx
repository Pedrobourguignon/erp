"use client";

import { Plus, Loader2, Landmark, ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import React, { useState } from "react";

import { RequirePermission } from "@/components/auth/require-permission";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  useCashRegisters,
  useCashRegisterSession,
  type CashMovement,
  type CashRegister,
} from "@/hooks/use-cash-registers";
import { formatCurrency, formatDateTime } from "@/lib/utils";

import { CashRegisterCard } from "./_components/cash-register-card";
import {
  CreateCashRegisterDialog,
  CloseSessionDialog,
} from "./_components/cash-register-dialogs";
import { DrawerTransferDialog } from "./_components/drawer-transfer-dialog";
import { OpenSessionDialog } from "./_components/open-session-dialog";
import { SessionHistory } from "./_components/session-history";


// ─── Movimentos da gaveta ─────────────────────────────────────────────

/**
 * Sangria e suprimento são transferências: têm a conta do outro lado (o cofre,
 * o banco). Um movimento sem ela é a gaveta espelhando uma baixa — pagamento
 * ou recebimento feito pelo caixa — ou um registro anterior à transferência.
 * Chamar esses de "Sangria"/"Suprimento" esconderia que o dinheiro não veio
 * de conta nenhuma nem foi guardado em lugar algum.
 */
function movementLabel(mov: CashMovement): string {
  if (mov.type === "SUPPLY") {
    return mov.counterpartAccount ? "Suprimento" : "Entrada";
  }
  return mov.counterpartAccount ? "Sangria" : "Saída";
}

function movementDetail(mov: CashMovement): string {
  if (!mov.counterpartAccount) {
    return mov.reason;
  }
  const arrow = mov.type === "SUPPLY" ? "←" : "→";
  return `${arrow} ${mov.counterpartAccount.name} · ${mov.reason}`;
}

// ─── Page ─────────────────────────────────────────────────────────────

function CashRegistersPageContent() {
  const { data, isLoading } = useCashRegisters();

  const [createOpen, setCreateOpen] = useState(false);
  const [openTarget, setOpenTarget] = useState<CashRegister | null>(null);
  const [closeTarget, setCloseTarget] = useState<CashRegister | null>(null);
  const [supplyTarget, setSupplyTarget] = useState<CashRegister | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<CashRegister | null>(null);
  const [viewTarget, setViewTarget] = useState<CashRegister | null>(null);

  const registers = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">Caixas</h1>
          <p className="text-muted-foreground">
            Gerencie os caixas registradores e suas sessões
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Caixa
        </Button>
      </div>

      {/* Summary cards */}
      <SummaryBar registers={registers} />

      {/* Cash register grid */}
      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : registers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Landmark className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p>Nenhum caixa cadastrado</p>
            <p className="mt-1 text-xs">
              Crie um caixa para começar a registrar operações.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {registers.map((reg) => (
            <CashRegisterCard
              key={reg.id}
              register={reg}
              onOpen={setOpenTarget}
              onClose={setCloseTarget}
              onSupply={setSupplyTarget}
              onWithdraw={setWithdrawTarget}
              onViewSession={setViewTarget}
            />
          ))}
        </div>
      )}

      {/* Session history */}
      <SessionHistory />

      {/* Dialogs */}
      <CreateCashRegisterDialog open={createOpen} onOpenChange={setCreateOpen} />
      <OpenSessionDialog register={openTarget} onClose={() => setOpenTarget(null)} />
      <CloseSessionDialog register={closeTarget} onClose={() => setCloseTarget(null)} />
      <DrawerTransferDialog direction="supply" register={supplyTarget} onClose={() => setSupplyTarget(null)} />
      <DrawerTransferDialog direction="withdraw" register={withdrawTarget} onClose={() => setWithdrawTarget(null)} />
      <SessionDetailDialog register={viewTarget} onClose={() => setViewTarget(null)} />
    </div>
  );
}

// ─── Summary bar ──────────────────────────────────────────────────────

function SummaryBar({ registers }: { registers: CashRegister[] }) {
  const openCount = registers.filter(
    (r) => r.currentSession?.status === "OPEN"
  ).length;
  const closedCount = registers.length - openCount;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Landmark className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total de Caixas</p>
            <p className="text-2xl font-bold">{registers.length}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
            <ArrowUpCircle className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Abertos</p>
            <p className="text-2xl font-bold text-green-600">{openCount}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <ArrowDownCircle className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Fechados</p>
            <p className="text-2xl font-bold">{closedCount}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Session detail dialog ────────────────────────────────────────────

function SessionDetailDialog({
  register: reg,
  onClose,
}: {
  register: CashRegister | null;
  onClose: () => void;
}) {
  // getCurrentSession is keyed by the cash-register id, not the session id
  const { data, isLoading } = useCashRegisterSession(reg?.id ?? "");
  const session = data?.data;

  return (
    <Dialog open={!!reg} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sessão - {reg?.name}</DialogTitle>
          <DialogDescription>
            Detalhes da sessão aberta atualmente.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !session ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma sessão aberta para este caixa.
          </p>
        ) : (
          <div className="space-y-4">
            {/* Session info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge variant={session.status === "OPEN" ? "success" : "secondary"}>
                  {session.status === "OPEN" ? "Aberto" : "Fechado"}
                </Badge>
              </div>
              {session.operator ? <div>
                  <p className="text-muted-foreground">Operador</p>
                  <p className="font-medium">{session.operator.name}</p>
                </div> : null}
              <div>
                <p className="text-muted-foreground">Aberto em</p>
                <p className="font-medium">{formatDateTime(session.openedAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Saldo abertura</p>
                <p className="font-medium">{formatCurrency(session.openingBalance)}</p>
              </div>
            </div>

            {/* Summary (vendas / entradas / saídas / saldo atual)

                As vendas em dinheiro entram na gaveta e no saldo esperado do
                fechamento, mas não são `CashMovement`: sem esta coluna o
                resumo não fechava na conta — abertura R$ 200 + entradas
                R$ 0,00 - saídas R$ 0,00 exibindo "Saldo atual R$ 500,00". O
                operador não tinha como conferir a gaveta antes de fechar. */}
            <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-muted-foreground">Vendas em dinheiro</p>
                <p className="font-medium text-green-600">
                  + {formatCurrency(session.totals?.cashSales ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Suprimentos</p>
                <p className="font-medium text-green-600">
                  + {formatCurrency(session.totals?.supplies ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Sangrias</p>
                <p className="font-medium text-red-600">
                  - {formatCurrency(session.totals?.withdrawals ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Saldo atual</p>
                <p className="font-bold">
                  {formatCurrency(session.totals?.currentBalance ?? session.openingBalance)}
                </p>
              </div>
            </div>

            {/* Movements */}
            {session.movements && session.movements.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium">Movimentações</p>
                <div className="max-h-60 space-y-2 overflow-y-auto rounded-lg border p-2">
                  {session.movements.map((mov) => (
                    <div
                      key={mov.id}
                      className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2 text-sm"
                    >
                      <div className="flex min-w-0 items-center">
                        <Badge
                          variant={mov.type === "SUPPLY" ? "success" : "destructive"}
                          className="mr-2 shrink-0"
                        >
                          {movementLabel(mov)}
                        </Badge>
                        <span
                          className="truncate text-muted-foreground"
                          title={movementDetail(mov)}
                        >
                          {movementDetail(mov)}
                        </span>
                      </div>
                      <span className="shrink-0 font-medium">
                        {mov.type === "WITHDRAW" ? "- " : "+ "}
                        {formatCurrency(mov.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nenhuma movimentação registrada nesta sessão.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// AE-27/FN-09: the menu hides this route, but a URL still reaches it — the
// page guard is the real one.
export default function CashRegistersPage() {
  return (
    <RequirePermission permission="financial:read" subject="os caixas">
      <CashRegistersPageContent />
    </RequirePermission>
  );
}
