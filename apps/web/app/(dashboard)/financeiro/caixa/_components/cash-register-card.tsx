"use client";

import {
  DoorOpen,
  DoorClosed,
  ArrowUpCircle,
  ArrowDownCircle,
  Eye,
} from "lucide-react";
import React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import type { CashRegister } from "@/hooks/use-cash-registers";
import { formatCurrency, formatDateTime } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────

interface CashRegisterCardProps {
  register: CashRegister;
  onOpen: (register: CashRegister) => void;
  onClose: (register: CashRegister) => void;
  onSupply: (register: CashRegister) => void;
  onWithdraw: (register: CashRegister) => void;
  onViewSession: (register: CashRegister) => void;
}

function RegisterActions({
  register: reg,
  isOpen,
  onOpen,
  onClose,
  onSupply,
  onWithdraw,
  onViewSession,
}: Omit<CashRegisterCardProps, "register"> & {
  register: CashRegister;
  isOpen: boolean;
}) {
  return (
        <div className="flex flex-wrap gap-2">
          {!isOpen ? (
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onOpen(reg)}
            >
              <DoorOpen className="mr-1.5 h-3.5 w-3.5" />
              Abrir Caixa
            </Button>
          ) : (
            <>
              {/* Fechar o caixa é rotina de fim de turno, não destruição de
                  dado — e vinha em vermelho cheio enquanto "Abrir Caixa", o
                  ato simétrico, vinha em primário. Regra do sistema:
                  preenchimento vermelho destrói dado, contorno vermelho
                  reverte dado, primário avança o fluxo. */}
              <Button
                size="sm"
                className="flex-1"
                onClick={() => onClose(reg)}
              >
                <DoorClosed className="mr-1.5 h-3.5 w-3.5" />
                Fechar
              </Button>
              <Tooltip content="Suprimento">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSupply(reg)}
                >
                  <ArrowUpCircle className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="Sangria">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onWithdraw(reg)}
                >
                  <ArrowDownCircle className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
              <Tooltip content="Ver sessão">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onViewSession(reg)}
                >
                  <Eye className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
            </>
          )}
        </div>
  );
}

function SessionRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`flex justify-between${emphasis ? " border-t pt-2" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={emphasis ? "font-semibold" : "font-medium"}>{value}</span>
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────

export function CashRegisterCard({
  register: reg,
  onOpen,
  onClose,
  onSupply,
  onWithdraw,
  onViewSession,
}: CashRegisterCardProps) {
  const isOpen = reg.currentSession?.status === "OPEN";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">{reg.name}</CardTitle>
        <Badge variant={isOpen ? "success" : "secondary"}>
          {isOpen ? "Aberto" : "Fechado"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {isOpen && reg.currentSession ? <div className="space-y-2 text-sm">
            {reg.currentSession.operator ? (
              <SessionRow label="Operador" value={reg.currentSession.operator.name} />
            ) : null}
            <SessionRow
              label="Aberto em"
              value={formatDateTime(reg.currentSession.openedAt)}
            />
            <SessionRow
              label="Saldo abertura"
              value={formatCurrency(reg.currentSession.openingBalance)}
            />
            {/* Só a abertura ficava à vista: depois de uma venda em dinheiro o
                card dizia R$ 50,00 com R$ 399,90 na gaveta. Quem passa o olho
                na tela precisa do saldo de agora, não do de quando abriu — o
                detalhamento (vendas, suprimentos, sangrias) continua em
                "Ver sessão". */}
            <SessionRow
              label="Saldo atual"
              value={formatCurrency(
                reg.currentSession.totals?.currentBalance ??
                  reg.currentSession.openingBalance
              )}
              emphasis
            />
          </div> : null}

        {!isOpen && (
          <p className="py-2 text-center text-sm text-muted-foreground">
            Nenhuma sessão aberta
          </p>
        )}

        <RegisterActions
          register={reg}
          isOpen={isOpen}
          onOpen={onOpen}
          onClose={onClose}
          onSupply={onSupply}
          onWithdraw={onWithdraw}
          onViewSession={onViewSession}
        />
      </CardContent>
    </Card>
  );
}
