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
  useOpenCashRegister,
  useCloseCashRegister,
  useCashSupply,
  useCashWithdraw,
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
});

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

  const { register, handleSubmit, control, reset, formState: { errors } } =
    useForm<CreateFormValues>({
      resolver: zodResolver(createSchema),
      defaultValues: { name: "", financialAccountId: "" },
    });

  React.useEffect(() => {
    if (open) {reset();}
  }, [open, reset]);

  const onSubmit = async (data: CreateFormValues) => {
    try {
      await mutation.mutateAsync(data);
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
            <label className="text-sm font-medium">Nome *</label>
            <Input {...register("name")} placeholder="Ex: Caixa 01" maxLength={100} />
            {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Conta Financeira *</label>
            <Controller
              name="financialAccountId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
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

// ─── Open Session Dialog ───────────────────────────────────────────────

const openSchema = z.object({
  openingBalance: z.preprocess(coerceNumber, z.number().min(0, "Valor inválido")),
});

type OpenFormValues = z.infer<typeof openSchema>;

export function OpenSessionDialog({
  register: reg,
  onClose,
}: {
  register: CashRegister | null;
  onClose: () => void;
}) {
  const mutation = useOpenCashRegister();
  const { data: accountsData } = useFinancialAccounts({ isActive: true });
  const { addToast } = useToast();

  // A conta do caixa é a gaveta, inclusive de um dia para o outro: o troco que
  // ficou de ontem já está nela. O saldo dela é o palpite certo de abertura, e
  // só o que passar disso é dinheiro novo entrando.
  const account = (accountsData?.data ?? []).find(
    (acc) => acc.id === reg?.financialAccountId
  );
  const balanceInDrawer = Number(account?.balance ?? 0);

  const { handleSubmit, control, reset, watch } = useForm<OpenFormValues>({
    resolver: zodResolver(openSchema),
    defaultValues: { openingBalance: 0 },
  });

  React.useEffect(() => {
    if (reg) {reset({ openingBalance: balanceInDrawer });}
  }, [reg, balanceInDrawer, reset]);

  const declared = watch("openingBalance") || 0;
  const externalSupply = declared - balanceInDrawer;

  const onSubmit = async (data: OpenFormValues) => {
    if (!reg) {
      return;
    }
    try {
      await mutation.mutateAsync({ id: reg.id, openingBalance: data.openingBalance });
      addToast("Caixa aberto com sucesso!", "success");
      onClose();
    } catch (err) {
      addToast(
        getMutationErrorMessage(
          err,
          "Erro ao abrir caixa. Tente novamente."
        ),
        "error"
      );
    }
  };

  return (
    <Dialog open={!!reg} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abrir Caixa - {reg?.name}</DialogTitle>
          <DialogDescription>Informe o saldo de abertura.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4"
          noValidate
        >
          {account ? (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              A conta <span className="font-medium text-foreground">{account.name}</span>{" "}
              acusa{" "}
              <span className="font-medium text-foreground">
                {formatCurrency(balanceInDrawer)}
              </span>{" "}
              na gaveta. Informe o total que está lá agora.
            </p>
          ) : null}

          <MoneyInput name="openingBalance" control={control} label="Saldo de Abertura" />

          {externalSupply > 0 ? (
            <p className="text-xs text-muted-foreground">
              {formatCurrency(externalSupply)} serão lançados como suprimento —
              dinheiro entrando de fora.
            </p>
          ) : null}
          {externalSupply < 0 ? (
            <p className="text-xs text-destructive">
              Faltam {formatCurrency(-externalSupply)} em relação ao que a conta
              acusa. Registre a sangria ou a transferência do que saiu antes de
              abrir.
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

// ─── Supply / Withdraw Dialog ──────────────────────────────────────────

const movementSchema = z.object({
  amount: z.preprocess(coerceNumber, z.number().min(0.01, "Valor obrigatório")),
  reason: z.string().min(1, "Motivo obrigatório").max(255),
});

type MovementFormValues = z.infer<typeof movementSchema>;

export function MovementDialog({
  register: reg,
  type,
  onClose,
}: {
  register: CashRegister | null;
  type: "supply" | "withdraw";
  onClose: () => void;
}) {
  const supplyMutation = useCashSupply();
  const withdrawMutation = useCashWithdraw();
  const { addToast } = useToast();

  const mutation = type === "supply" ? supplyMutation : withdrawMutation;
  const title = type === "supply" ? "Suprimento" : "Sangria";

  const { register: formRegister, handleSubmit, control, reset, formState: { errors } } =
    useForm<MovementFormValues>({
      resolver: zodResolver(movementSchema),
      defaultValues: { amount: 0, reason: "" },
    });

  React.useEffect(() => {
    if (reg) {reset({ amount: 0, reason: "" });}
  }, [reg, reset]);

  const onSubmit = async (data: MovementFormValues) => {
    if (!reg) {
      return;
    }
    try {
      await mutation.mutateAsync({ id: reg.id, ...data });
      addToast(`${title} realizado com sucesso!`, "success");
      onClose();
    } catch (err) {
      addToast(
        getMutationErrorMessage(
          err,
          `Erro ao realizar ${title.toLowerCase()}. Tente novamente.`
        ),
        "error"
      );
    }
  };

  return (
    <Dialog open={!!reg} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title} - {reg?.name}</DialogTitle>
          <DialogDescription>
            {type === "supply"
              ? "Adicione dinheiro ao caixa."
              : "Retire dinheiro do caixa."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4"
          noValidate
        >
          <MoneyInput name="amount" control={control} label="Valor" />
          <div className="space-y-1">
            <label className="text-sm font-medium">Motivo *</label>
            <Input {...formRegister("reason")} placeholder="Motivo da movimentação" maxLength={255} />
            {errors.reason ? <p className="text-xs text-destructive">{errors.reason.message}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="cancel" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
