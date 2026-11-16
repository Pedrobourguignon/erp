"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useOpenCashRegister, type CashRegister } from "@/hooks/use-cash-registers";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";
import { getMutationErrorMessage } from "@/lib/mutation-error";
import { formatCurrency } from "@/lib/utils";

/**
 * A origem só é exigida quando o fundo declarado passa do que a gaveta já tem:
 * esse excedente entrou agora e saiu de alguma conta (ADR 0003).
 */
const buildSchema = (balanceInDrawer: number) =>
  z
    .object({
      openingBalance: z.number().min(0, "Valor inválido"),
      sourceAccountId: z.string(),
    })
    .superRefine((data, ctx) => {
      if (data.openingBalance > balanceInDrawer && !data.sourceAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceAccountId"],
          message: "Escolha de qual conta vem o dinheiro.",
        });
      }
    });

type OpenFormValues = z.infer<ReturnType<typeof buildSchema>>;

export interface OpenSessionDialogProps {
  register: CashRegister | null;
  onClose: () => void;
}

export function OpenSessionDialog({ register: reg, onClose }: OpenSessionDialogProps) {
  const mutation = useOpenCashRegister();
  const { data: accountsData } = useFinancialAccounts({ isActive: true });
  const { addToast } = useToast();

  // A conta do caixa é a gaveta, inclusive de um dia para o outro: o troco que
  // ficou de ontem já está nela. O saldo dela é o palpite certo de abertura, e
  // só o que passar disso é dinheiro novo entrando — vindo do cofre.
  const allAccounts = accountsData?.data ?? [];
  const account = allAccounts.find((acc) => acc.id === reg?.financialAccountId);
  const sources = allAccounts.filter((acc) => acc.id !== reg?.financialAccountId);
  const balanceInDrawer = Number(account?.balance ?? 0);
  const schema = React.useMemo(() => buildSchema(balanceInDrawer), [balanceInDrawer]);

  const { handleSubmit, control, reset, watch, formState: { errors } } = useForm<OpenFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { openingBalance: 0, sourceAccountId: "" },
  });

  React.useEffect(() => {
    if (reg) {
      reset({ openingBalance: balanceInDrawer, sourceAccountId: reg.vaultAccountId ?? "" });
    }
  }, [reg, balanceInDrawer, reset]);

  const declared = watch("openingBalance") || 0;
  const missing = declared - balanceInDrawer;

  const onSubmit = async ({ openingBalance, sourceAccountId }: OpenFormValues) => {
    if (!reg) {
      return;
    }
    try {
      await mutation.mutateAsync(
        missing > 0 ? { id: reg.id, openingBalance, sourceAccountId } : { id: reg.id, openingBalance },
      );
      addToast("Caixa aberto com sucesso!", "success");
      onClose();
    } catch (err) {
      addToast(getMutationErrorMessage(err, "Erro ao abrir caixa. Tente novamente."), "error");
    }
  };

  return (
    <Dialog open={!!reg} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Abrir Caixa - {reg?.name}</DialogTitle>
          <DialogDescription>Informe o saldo de abertura.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {account ? (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              A conta <span className="font-medium text-foreground">{account.name}</span> acusa{" "}
              <span className="font-medium text-foreground">{formatCurrency(balanceInDrawer)}</span> na gaveta.
              Informe o total que está lá agora.
            </p>
          ) : null}

          <MoneyInput name="openingBalance" control={control} label="Saldo de abertura" />

          {missing > 0 ? (
            <div className="space-y-1">
              <label htmlFor="open-session-source" className="text-sm font-medium">De onde vem o dinheiro *</label>
              <Controller
                name="sourceAccountId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="open-session-source"><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
                    <SelectContent>
                      {sources.map((acc) => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-xs text-muted-foreground">
                {formatCurrency(missing)} entram na gaveta agora e saem desta conta.
              </p>
              {errors.sourceAccountId ? <p className="text-xs text-destructive">{errors.sourceAccountId.message}</p> : null}
            </div>
          ) : null}
          {missing < 0 ? (
            <p className="text-xs text-destructive">
              Faltam {formatCurrency(-missing)} em relação ao que a conta acusa. Registre a sangria ou a
              transferência do que saiu antes de abrir.
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="cancel" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Abrir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
