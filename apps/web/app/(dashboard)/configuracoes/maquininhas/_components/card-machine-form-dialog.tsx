"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import React from "react";
import { useForm, type UseFormReturn } from "react-hook-form";

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
import { useToast } from "@/components/ui/toast";
import {
  useCreateCardMachine,
  useUpdateCardMachine,
  type CardMachine,
} from "@/hooks/use-card-machines";
import { useInvalidSubmit } from "@/hooks/use-invalid-submit";
import { cardMachineSchema, type CardMachineFormValues } from "@/lib/card-machine-form";
import { getMutationErrorMessage } from "@/lib/mutation-error";

import { CreditSection } from "./credit-section";

interface CardMachineFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CardMachine | null;
}

const EMPTY: CardMachineFormValues = {
  name: "",
  provider: "",
  debitFeePercentage: 0,
  debitSettlementDays: 1,
  acceptsCredit: true,
  creditReceiveMode: "FLOW",
  creditSettlementDays: 30,
  maxInstallments: 1,
  rates: [{ installments: 1, feePercentage: 0 }],
  isActive: true,
};

function toFormValues(machine: CardMachine): CardMachineFormValues {
  const rates = machine.rates.map((r) => ({
    installments: r.installments,
    feePercentage: Number(r.feePercentage),
  }));
  return {
    name: machine.name,
    provider: machine.provider ?? "",
    debitFeePercentage: Number(machine.debitFeePercentage),
    debitSettlementDays: machine.debitSettlementDays,
    acceptsCredit: rates.length > 0,
    creditReceiveMode: machine.creditReceiveMode,
    creditSettlementDays: machine.creditSettlementDays,
    maxInstallments: Math.max(rates.length, 1),
    rates: rates.length > 0 ? rates : EMPTY.rates,
    isActive: machine.isActive,
  };
}

export function CardMachineFormDialog({ open, onOpenChange, editing }: CardMachineFormDialogProps) {
  const { addToast } = useToast();
  const createMutation = useCreateCardMachine();
  const updateMutation = useUpdateCardMachine();
  const onInvalid = useInvalidSubmit();
  const form = useForm<CardMachineFormValues>({
    resolver: zodResolver(cardMachineSchema),
    defaultValues: EMPTY,
  });

  React.useEffect(() => {
    if (open) {form.reset(editing ? toFormValues(editing) : EMPTY);}
  }, [open, editing, form]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = async ({ acceptsCredit, maxInstallments: _max, ...data }: CardMachineFormValues) => {
    const payload = { ...data, provider: data.provider || undefined, rates: acceptsCredit ? data.rates : [] };
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, ...payload });
        addToast("Maquininha atualizada com sucesso!", "success");
      } else {
        await createMutation.mutateAsync(payload);
        addToast("Maquininha cadastrada com sucesso!", "success");
      }
      onOpenChange(false);
    } catch (err) {
      addToast(getMutationErrorMessage(err, "Erro ao salvar a maquininha. Tente novamente."), "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar maquininha" : "Nova maquininha"}</DialogTitle>
          <DialogDescription>
            As taxas e os prazos do contrato com a operadora. As vendas no cartão calculam
            os títulos a receber e as taxas a partir daqui.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-6">
          <IdentitySection form={form} />
          <DebitSection form={form} />
          <CreditSection form={form} />
          {editing ? <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" {...form.register("isActive")} />
              Ativa
            </label> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editing ? "Salvar" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type SectionProps = { form: UseFormReturn<CardMachineFormValues> };

function IdentitySection({ form }: SectionProps) {
  const { register, formState: { errors } } = form;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1">
        <label htmlFor="machine-name" className="text-sm font-medium">Nome *</label>
        <Input id="machine-name" maxLength={100} placeholder="Ex: Stone Loja Centro" {...register("name")} />
        {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
      </div>
      <div className="space-y-1">
        <label htmlFor="machine-provider" className="text-sm font-medium">Operadora</label>
        <Input id="machine-provider" maxLength={50} placeholder="Ex: Stone, Cielo, InfinitePay" {...register("provider")} />
        {errors.provider ? <p className="text-xs text-destructive">{errors.provider.message}</p> : null}
      </div>
    </div>
  );
}

function DebitSection({ form }: SectionProps) {
  const { register, formState: { errors } } = form;
  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <legend className="px-1 text-sm font-semibold">Débito</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="debit-fee" className="text-sm font-medium">Taxa (%)</label>
          <Input id="debit-fee" type="number" step={0.01} min={0} max={100}
            {...register("debitFeePercentage", { valueAsNumber: true })} />
          {errors.debitFeePercentage ? <p className="text-xs text-destructive">{errors.debitFeePercentage.message}</p> : null}
        </div>
        <div className="space-y-1">
          <label htmlFor="debit-days" className="text-sm font-medium">Cai em (dias)</label>
          <Input id="debit-days" type="number" min={0} max={365}
            {...register("debitSettlementDays", { valueAsNumber: true })} />
          <p className="text-xs text-muted-foreground">0 = o dinheiro cai na hora da venda.</p>
          {errors.debitSettlementDays ? <p className="text-xs text-destructive">{errors.debitSettlementDays.message}</p> : null}
        </div>
      </div>
    </fieldset>
  );
}
