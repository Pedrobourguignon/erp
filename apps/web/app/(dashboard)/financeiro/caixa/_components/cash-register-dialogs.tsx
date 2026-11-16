"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import React from "react";
import { useForm, Controller, type Control } from "react-hook-form";
import { z } from "zod";

import { MoneyInput } from "@/components/forms/money-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  useCreateCashRegister,
  useCloseCashRegister,
  type CashRegister,
} from "@/hooks/use-cash-registers";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";
import { getMutationErrorMessage } from "@/lib/mutation-error";
import { formatCurrency } from "@/lib/utils";

// ─── Coerce helper ─────────────────────────────────────────────────────

const coerceNumber = (val: unknown) => {
  if (val === "" || val === null || val === undefined) {
    return 0;
  }
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
};

// ─── Create Cash Register Dialog ───────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1, "Nome obrigatório").max(100),
  financialAccountId: z.string().min(1, "Conta financeira obrigatória"),
  /** Cofre do caixa: destino da sangria e origem do suprimento. Opcional: sem ele, cada um pede a conta. */
  vaultAccountId: z.string(),
});

const NO_VAULT_ACCOUNT = "__none";

type CreateFormValues = z.infer<typeof createSchema>;

export function CreateCashRegisterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mutation = useCreateCashRegister();
  const { data: accountsData } = useFinancialAccounts({ isActive: true });
  const { addToast } = useToast();

  const accounts = accountsData?.data ?? [];

  const { register, handleSubmit, control, reset, watch, formState: { errors } } =
    useForm<CreateFormValues>({
      resolver: zodResolver(createSchema),
      defaultValues: { name: "", financialAccountId: "", vaultAccountId: NO_VAULT_ACCOUNT },
    });
  const drawerAccountId = watch("financialAccountId");

  React.useEffect(() => {
    if (open) {reset();}
  }, [open, reset]);

  const onSubmit = async ({ vaultAccountId, ...data }: CreateFormValues) => {
    try {
      const hasVaultAccount =
        vaultAccountId !== NO_VAULT_ACCOUNT && vaultAccountId !== data.financialAccountId;
      await mutation.mutateAsync(hasVaultAccount ? { ...data, vaultAccountId } : data);
      addToast("Caixa criado com sucesso!", "success");
      onOpenChange(false);
    } catch (err) {
      addToast(
        getMutationErrorMessage(
          err,
          "Erro ao criar caixa. Tente novamente."
        ),
        "error"
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo Caixa</DialogTitle>
          <DialogDescription>Cadastre um novo caixa no sistema.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4"
          noValidate
        >
          <div className="space-y-1">
            <label htmlFor="register-name" className="text-sm font-medium">Nome *</label>
            <Input id="register-name" {...register("name")} placeholder="Ex: Caixa 01" maxLength={100} />
            {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
          </div>
          <div className="space-y-1">
            <label htmlFor="register-account" className="text-sm font-medium">Conta Financeira *</label>
            <Controller
              name="financialAccountId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="register-account">
                    <SelectValue placeholder="Selecione uma conta" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.financialAccountId ? <p className="text-xs text-destructive">{errors.financialAccountId.message}</p> : null}
          </div>
          <div className="space-y-1">
            <label htmlFor="register-vault-account" className="text-sm font-medium">Cofre do caixa</label>
            <Controller
              name="vaultAccountId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="register-vault-account">
                    <SelectValue placeholder="Escolher a cada operação" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_VAULT_ACCOUNT}>Escolher a cada operação</SelectItem>
                    {accounts
                      .filter((acc) => acc.id !== drawerAccountId)
                      .map((acc) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-xs text-muted-foreground">
              Para onde vai a sangria e de onde vem o suprimento. Dá para trocar na hora da operação.
            </p>
            {errors.vaultAccountId ? <p className="text-xs text-destructive">{errors.vaultAccountId.message}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="cancel" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Close Session Dialog ──────────────────────────────────────────────

/**
 * Sentinela do select de destino: fechar sem transferir nada, deixando todo o
 * dinheiro contado na gaveta. É o comportamento antigo, agora uma escolha
 * explícita em vez do padrão silencioso.
 */
const KEEP_IN_REGISTER = "KEEP";

const closeSchema = z
  .object({
    closingBalance: z.preprocess(coerceNumber, z.number().min(0, "Valor inválido")),
    notes: z.string().max(500).optional(),
    destinationAccountId: z.string().min(1, "Escolha o destino do dinheiro"),
    retainedAmount: z.preprocess(coerceNumber, z.number().min(0, "Valor inválido")),
  })
  .superRefine((data, ctx) => {
    if (
      data.destinationAccountId !== KEEP_IN_REGISTER &&
      data.retainedAmount > data.closingBalance
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["retainedAmount"],
        message: "O fundo de troco não pode passar do valor contado",
      });
    }
  });

type CloseFormValues = z.infer<typeof closeSchema>;

/**
 * Fechar o caixa é também decidir o que acontece com o dinheiro: quanto fica de
 * troco para amanhã e para onde vai o faturamento do dia. Sem essa etapa o
 * dinheiro dormia na conta da gaveta e a abertura seguinte recontava o fundo.
 */
function MoneyDestinationFields({
  control,
  accounts,
  showFloat,
  amountToTransfer,
  retained,
  counted,
  error,
}: {
  control: Control<CloseFormValues>;
  accounts: { id: string; name: string }[];
  showFloat: boolean;
  amountToTransfer: number;
  retained: number;
  counted: number;
  error?: string;
}) {
  return (
    <>
      <div className="space-y-1">
        <label className="text-sm font-medium">Destino do dinheiro</label>
        <Controller
          name="destinationAccountId"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o destino" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP_IN_REGISTER}>Deixar tudo no caixa</SelectItem>
                {accounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    Transferir para {acc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {showFloat ? (
        <div className="space-y-1">
          <MoneyInput
            name="retainedAmount"
            control={control}
            label="Fundo de troco que permanece no caixa"
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          {/* Sem esta guarda o preview afirmava "vai transferir R$ 0,00 e
              deixar R$ 250.000,00 na gaveta" para um fundo maior que a
              contagem — uma frase que o fechamento nunca executaria. */}
          {retained > counted ? (
            <p className="text-xs text-destructive">
              O fundo de troco não cabe no valor contado ({formatCurrency(counted)}).
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Vai transferir{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(amountToTransfer)}
              </span>{" "}
              e deixar {formatCurrency(retained)} na gaveta para a próxima abertura.
            </p>
          )}
        </div>
      ) : null}
    </>
  );
}

export function CloseSessionDialog({
  register: reg,
  onClose,
}: {
  register: CashRegister | null;
  onClose: () => void;
}) {
  const mutation = useCloseCashRegister();
  const { data: accountsData } = useFinancialAccounts({ isActive: true });
  const { addToast } = useToast();

  // O dinheiro não pode ir para a conta de onde está saindo.
  const accounts = (accountsData?.data ?? []).filter(
    (acc) => acc.id !== reg?.financialAccountId
  );
  const expectedBalance = reg?.currentSession?.totals?.currentBalance;
  const openingFloat = reg?.currentSession?.openingBalance ?? 0;

  const { register: formRegister, handleSubmit, control, reset, watch, formState: { errors } } =
    useForm<CloseFormValues>({
      resolver: zodResolver(closeSchema),
      defaultValues: {
        closingBalance: 0,
        notes: "",
        destinationAccountId: KEEP_IN_REGISTER,
        retainedAmount: 0,
      },
    });

  React.useEffect(() => {
    if (reg) {
      reset({
        closingBalance: 0,
        notes: "",
        destinationAccountId: KEEP_IN_REGISTER,
        // O fundo que abriu o caixa é o que faz sentido deixar para amanhã.
        retainedAmount: reg.currentSession?.openingBalance ?? 0,
      });
    }
  }, [reg, reset]);

  const destination = watch("destinationAccountId");
  const counted = watch("closingBalance");
  const retained = watch("retainedAmount");
  const willTransfer = destination !== KEEP_IN_REGISTER;
  const amountToTransfer = Math.max(0, (counted || 0) - (retained || 0));

  const onSubmit = async (data: CloseFormValues) => {
    if (!reg) {
      return;
    }
    try {
      const result = await mutation.mutateAsync({
        id: reg.id,
        closingBalance: data.closingBalance,
        notes: data.notes || undefined,
        ...(data.destinationAccountId === KEEP_IN_REGISTER
          ? {}
          : {
              retainedAmount: data.retainedAmount,
              destinationAccountId: data.destinationAccountId,
            }),
      });
      const transfer = result.data?.transfer;
      addToast(
        transfer
          ? `Caixa fechado. ${formatCurrency(transfer.amount)} transferidos para ${transfer.toAccountName}.`
          : "Caixa fechado com sucesso!",
        "success"
      );
      onClose();
    } catch (err) {
      addToast(
        getMutationErrorMessage(
          err,
          "Erro ao fechar caixa. Tente novamente."
        ),
        "error"
      );
    }
  };

  return (
    <Dialog open={!!reg} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fechar Caixa - {reg?.name}</DialogTitle>
          <DialogDescription>Informe o saldo contado e observações.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4"
          noValidate
        >
          {expectedBalance !== undefined ? (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              Saldo esperado na gaveta:{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(expectedBalance)}
              </span>{" "}
              (abertura {formatCurrency(openingFloat)} + vendas em dinheiro +
              suprimentos − sangrias)
            </p>
          ) : null}

          <MoneyInput name="closingBalance" control={control} label="Saldo Contado" />

          <MoneyDestinationFields
            control={control}
            accounts={accounts}
            showFloat={willTransfer}
            amountToTransfer={amountToTransfer}
            retained={retained || 0}
            counted={counted || 0}
            error={errors.retainedAmount?.message}
          />

          <div className="space-y-1">
            <label className="text-sm font-medium">Observações</label>
            <textarea
              {...formRegister("notes")}
              rows={3}
              maxLength={500}
              placeholder="Observações sobre o fechamento..."
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="cancel" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Fechar Caixa
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
