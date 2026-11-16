"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import React from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { MoneyInput } from "@/components/forms/money-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useCashSupply, useCashWithdraw, useUpdateCashRegister, type CashRegister } from "@/hooks/use-cash-registers";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";
import { usePermissions } from "@/hooks/use-permissions";
import { getMutationErrorMessage } from "@/lib/mutation-error";

export type DrawerTransferDirection = "withdraw" | "supply";

/**
 * Sangria e suprimento são a mesma operação em sentidos opostos: uma
 * transferência entre a gaveta e outra conta (o cofre, o banco). Nenhum dos
 * dois cria ou destrói dinheiro — quem faz isso é a venda e a despesa.
 */
const COPY = {
  withdraw: {
    title: "Sangria",
    description: "Retire dinheiro da gaveta e guarde numa conta, como o cofre ou o banco.",
    accountLabel: "Para onde vai o dinheiro *",
    missing: "Escolha para qual conta vai o dinheiro.",
    reasonPlaceholder: "Ex.: excesso de dinheiro na gaveta",
    confirm: "Confirmar sangria",
    done: (account: string) => `Sangria realizada: dinheiro transferido para ${account}.`,
    hint: { lead: "Pagou algo com o dinheiro do caixa? Isso não é sangria: lance a despesa em", tail: "e dê baixa pela conta do caixa." },
  },
  supply: {
    title: "Suprimento",
    description: "Traga dinheiro de uma conta, como o cofre ou o banco, para a gaveta.",
    accountLabel: "De onde vem o dinheiro *",
    missing: "Escolha de qual conta vem o dinheiro.",
    reasonPlaceholder: "Ex.: troco para o caixa",
    confirm: "Confirmar suprimento",
    done: (account: string) => `Suprimento realizado: dinheiro trazido de ${account}.`,
    hint: { lead: "Recebeu um pagamento em dinheiro? Isso não é suprimento: registre o recebimento em", tail: "pela conta do caixa." },
  },
} as const;

const buildSchema = (missing: string) =>
  z.object({
    amount: z.number().min(0.01, "Valor obrigatório"),
    reason: z.string().trim().min(1, "Motivo obrigatório").max(255),
    accountId: z.string().min(1, missing),
    saveAsVault: z.boolean(),
  });

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

export interface DrawerTransferDialogProps {
  direction: DrawerTransferDirection;
  register: CashRegister | null;
  onClose: () => void;
}

export function DrawerTransferDialog({ direction, register: reg, onClose }: DrawerTransferDialogProps) {
  const copy = COPY[direction];
  const withdrawMutation = useCashWithdraw();
  const supplyMutation = useCashSupply();
  const updateMutation = useUpdateCashRegister();
  const { data: accountsData } = useFinancialAccounts({ isActive: true });
  const { can } = usePermissions();
  const { addToast } = useToast();

  const accounts = (accountsData?.data ?? []).filter((acc) => acc.id !== reg?.financialAccountId);
  const canSetVault = can("financial:update");
  const schema = React.useMemo(() => buildSchema(copy.missing), [copy.missing]);

  const { register: field, handleSubmit, control, reset, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amount: 0, reason: "", accountId: "", saveAsVault: false },
  });

  React.useEffect(() => {
    if (reg) {
      reset({ amount: 0, reason: "", accountId: reg.vaultAccountId ?? "", saveAsVault: false });
    }
  }, [reg, reset]);

  const isAlreadyVault = !!watch("accountId") && watch("accountId") === reg?.vaultAccountId;

  const onSubmit = async ({ saveAsVault, accountId, ...data }: FormValues) => {
    if (!reg) {
      return;
    }
    try {
      if (direction === "withdraw") {
        await withdrawMutation.mutateAsync({ id: reg.id, ...data, destinationAccountId: accountId });
      } else {
        await supplyMutation.mutateAsync({ id: reg.id, ...data, sourceAccountId: accountId });
      }
      if (saveAsVault && canSetVault && !isAlreadyVault) {
        await updateMutation.mutateAsync({ id: reg.id, vaultAccountId: accountId });
      }
      addToast(copy.done(accounts.find((acc) => acc.id === accountId)?.name ?? "a conta escolhida"), "success");
      onClose();
    } catch (err) {
      addToast(getMutationErrorMessage(err, `Erro ao realizar ${copy.title.toLowerCase()}. Tente novamente.`), "error");
    }
  };

  const isPending = withdrawMutation.isPending || supplyMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={!!reg} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.title} - {reg?.name}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <MoneyInput name="amount" control={control} label="Valor" placeholder="0,00" />
          {errors.amount ? <p className="text-xs text-destructive">{errors.amount.message}</p> : null}

          <div className="space-y-1">
            <label htmlFor="drawer-transfer-account" className="text-sm font-medium">{copy.accountLabel}</label>
            <Controller
              name="accountId"
              control={control}
              render={({ field: select }) => (
                <Select value={select.value} onValueChange={select.onChange}>
                  <SelectTrigger id="drawer-transfer-account"><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((acc) => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.accountId ? <p className="text-xs text-destructive">{errors.accountId.message}</p> : null}
          </div>

          {canSetVault && !isAlreadyVault ? (
            <div className="flex items-center gap-2">
              <input id="drawer-transfer-save-vault" type="checkbox" className="h-4 w-4" {...field("saveAsVault")} />
              <label htmlFor="drawer-transfer-save-vault" className="text-sm">Usar sempre esta conta como cofre deste caixa</label>
            </div>
          ) : null}

          <div className="space-y-1">
            <label htmlFor="drawer-transfer-reason" className="text-sm font-medium">Motivo *</label>
            <Input id="drawer-transfer-reason" {...field("reason")} placeholder={copy.reasonPlaceholder} maxLength={255} />
            {errors.reason ? <p className="text-xs text-destructive">{errors.reason.message}</p> : null}
          </div>

          <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            {copy.hint.lead}{" "}
            <Link href="/financeiro/lancamentos" className="font-medium text-foreground underline">lançamentos</Link>{" "}
            {copy.hint.tail}
          </p>

          <DialogFooter>
            <Button type="button" variant="cancel" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {copy.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
