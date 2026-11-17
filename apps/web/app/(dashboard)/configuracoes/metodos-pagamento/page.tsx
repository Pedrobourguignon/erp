"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import React, { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";

import { Can } from "@/components/auth/can";
import { RequirePermission } from "@/components/auth/require-permission";
import { FilterField, FilterPanel } from "@/components/tables/filter-panel";
import { ListSearch } from "@/components/tables/list-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { Tooltip } from "@/components/ui/tooltip";
import { TruncatedText } from "@/components/ui/truncated-text";
import { useFilters } from "@/hooks/use-filters";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";
import { useInvalidSubmit } from "@/hooks/use-invalid-submit";
import {
  usePaymentMethods,
  useCreatePaymentMethod,
  useUpdatePaymentMethod,
  useDeletePaymentMethod,
  type PaymentMethod,
  type PaymentMethodType,
} from "@/hooks/use-payment-methods";
import { getApiErrorMessage } from "@/lib/api";
import { getMutationErrorMessage } from "@/lib/mutation-error";

import { CardMachineSelect } from "./_components/card-machine-select";

// ─── Constants ────────────────────────────────────────────────────────

const TYPE_OPTIONS: { value: PaymentMethodType; label: string }[] = [
  { value: "CASH", label: "Dinheiro" },
  { value: "CREDIT_CARD", label: "Cartão de Crédito" },
  { value: "DEBIT_CARD", label: "Cartão de Débito" },
  { value: "PIX", label: "PIX" },
  { value: "BOLETO", label: "Boleto" },
  { value: "BANK_TRANSFER", label: "Transferência" },
  { value: "CHECK", label: "Cheque" },
  { value: "STORE_CREDIT", label: "Crédito na Loja" },
  { value: "OTHER", label: "Outro" },
];

const TYPE_LABELS: Record<PaymentMethodType, string> = {
  CASH: "Dinheiro",
  CREDIT_CARD: "Cartão Crédito",
  DEBIT_CARD: "Cartão Débito",
  PIX: "PIX",
  BOLETO: "Boleto",
  BANK_TRANSFER: "Transferência",
  CHECK: "Cheque",
  STORE_CREDIT: "Crédito Loja",
  OTHER: "Outro",
};

const TYPE_BADGE: Record<PaymentMethodType, "success" | "default" | "warning" | "secondary"> = {
  CASH: "success",
  CREDIT_CARD: "default",
  DEBIT_CARD: "default",
  PIX: "success",
  BOLETO: "warning",
  BANK_TRANSFER: "secondary",
  CHECK: "warning",
  STORE_CREDIT: "secondary",
  OTHER: "secondary",
};

// ─── Schema ───────────────────────────────────────────────────────────

const methodSchema = z.object({
  name: z.string().min(1, "Nome obrigatório").max(100),
  type: z.enum([
    "CASH",
    "CREDIT_CARD",
    "DEBIT_CARD",
    "PIX",
    "BOLETO",
    "BANK_TRANSFER",
    "CHECK",
    "STORE_CREDIT",
    "OTHER",
  ]),
  feePercentage: z
    .number()
    .min(0, "A taxa não pode ser negativa")
    .max(100, "A taxa não pode passar de 100%")
    .default(0),
  settlementDays: z
    .number()
    .int("Informe um número inteiro de dias")
    .min(0, "O prazo de liquidação não pode ser negativo")
    .max(365, "O prazo máximo é 365 dias")
    .default(0),
  maxInstallments: z
    .number({ invalid_type_error: "Informe o máximo de parcelas" })
    .int("Informe um número inteiro de parcelas")
    .min(1, "O mínimo é 1 (não parcela)")
    .max(24, "O máximo é 24 parcelas")
    .default(1),
  autoSettle: z.boolean().default(false),
  fiscalCode: z.string().max(5).optional(),
  defaultAccountId: z.string().optional(),
  cardMachineId: z.string().optional(),
  isActive: z.boolean().default(true),
});

const methodSchemaWithAccount = methodSchema.superRefine((data, ctx) => {
  // VD-11 / SCRUM-30: a forma à vista credita uma conta na hora da venda, e a
  // API recusa a criação sem ela. Sem esta regra o usuário só descobre no 409.
  if (IMMEDIATE_TYPES.includes(data.type) && !data.defaultAccountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultAccountId"],
      message: "Formas à vista precisam de uma conta financeira vinculada",
    });
  }
  // Espelha a API: no cartão, taxa, prazo e parcelas vêm da maquininha.
  if (CARD_TYPES.includes(data.type) && !data.cardMachineId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cardMachineId"],
      message: "Escolha a maquininha desta forma de pagamento",
    });
  }
  // Espelha a API: dinheiro, PIX e débito entram inteiros na hora.
  if (IMMEDIATE_TYPES.includes(data.type) && data.maxInstallments > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxInstallments"],
      message: "Dinheiro, PIX e débito não podem ser parcelados",
    });
  }
  // Espelha a API: baixa automática sem conta falharia em silêncio todo dia.
  if (data.autoSettle && !data.defaultAccountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["defaultAccountId"],
      message: "A baixa automática precisa de uma conta financeira vinculada",
    });
  }
});

type MethodFormValues = z.infer<typeof methodSchema>;

/** Tipos liquidados na hora — a venda credita a conta imediatamente. */
const IMMEDIATE_TYPES: PaymentMethodType[] = ["CASH", "PIX", "DEBIT_CARD"];

/** Cartão: taxa, prazo e parcelas vêm da maquininha vinculada. */
const CARD_TYPES: PaymentMethodType[] = ["CREDIT_CARD", "DEBIT_CARD"];
const isCard = (type: PaymentMethodType) => CARD_TYPES.includes(type);

/**
 * VD-11: mostra a conta vinculada e denuncia a ausência dela num método à
 * vista — que é exatamente o estado que trava a venda no PDV.
 */
function LinkedAccountCell({ method }: { method: PaymentMethod }) {
  if (method.defaultAccount?.name) {
    return <TruncatedText text={method.defaultAccount.name} className="max-w-[28ch]" />;
  }
  if (IMMEDIATE_TYPES.includes(method.type)) {
    return (
      <span className="text-xs text-destructive">
        Sem conta — bloqueia a venda
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

// ─── Page ─────────────────────────────────────────────────────────────

function PaymentMethodsPageContent() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PaymentMethod | null>(null);
  const { addToast } = useToast();
  const deleteMutation = useDeletePaymentMethod();

  // FT-05: a tela não tinha nem busca, apesar de a API aceitar `search`,
  // `type` e `isActive` desde sempre. O filtro de ativo/inativo tem peso
  // próprio: o lote 4 **desativou** as duplicatas em vez de apagá-las, e sem
  // ele essa decisão fica invisível.
  const filters = useFilters({ search: "", type: "", isActive: "" }, () => {});

  const { data, isLoading } = usePaymentMethods({
    search: filters.values.search || undefined,
    type: (filters.values.type || undefined) as PaymentMethodType | undefined,
    isActive: filters.values.isActive
      ? filters.values.isActive === "true"
      : undefined,
  });

  const methods = data?.data ?? [];

  const handleEdit = (method: PaymentMethod) => {
    setEditing(method);
    setFormOpen(true);
  };

  const handleCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    try {
      const result = await deleteMutation.mutateAsync(deleteTarget.id);
      addToast(result.data.message, "success");
      setDeleteTarget(null);
    } catch (err) {
      addToast(
        getMutationErrorMessage(err, "Erro ao excluir método. Tente novamente."),
        "error"
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* `flex-wrap` + `items-start`: o painel de filtros pede a linha inteira
          (`basis-full`) e só consegue tomá-la se a linha puder quebrar. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">
            Métodos de Pagamento
          </h1>
          <p className="text-muted-foreground">
            Configure os métodos de pagamento aceitos
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Método
        </Button>
      </div>

      <FilterPanel
        values={filters.values}
        onClear={filters.clear}
        search={
          <ListSearch
            value={filters.values.search}
            onChange={(value) => filters.set("search", value)}
            placeholder="Buscar por nome..."
          />
        }
      >
        <FilterField label="Tipo">
          <Select
            value={filters.values.type || "__all"}
            onValueChange={(v) => filters.set("type", v === "__all" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Todos os tipos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Todos os tipos</SelectItem>
              {TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField label="Situação">
          <Select
            value={filters.values.isActive || "__all"}
            onValueChange={(v) => filters.set("isActive", v === "__all" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Ativos e inativos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Ativos e inativos</SelectItem>
              <SelectItem value="true">Somente ativos</SelectItem>
              <SelectItem value="false">Somente inativos</SelectItem>
            </SelectContent>
          </Select>
        </FilterField>
      </FilterPanel>

      <MethodsTable
        methods={methods}
        isLoading={isLoading}
        onEdit={handleEdit}
        onDelete={setDeleteTarget}
      />

      <MethodFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {setDeleteTarget(null);}
        }}
        title="Excluir Método"
        message={`Deseja excluir "${deleteTarget?.name}"? Se já tiver sido usado em algum pedido ou título, será inativado em vez de excluído.`}
        destructive
        confirmLabel="Excluir"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────

function MethodsTable({
  methods,
  isLoading,
  onEdit,
  onDelete,
}: {
  methods: PaymentMethod[];
  isLoading: boolean;
  onEdit: (m: PaymentMethod) => void;
  onDelete: (m: PaymentMethod) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (methods.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Nenhum método de pagamento cadastrado
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
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nome</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Conta vinculada</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Taxa %</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Liquidação (dias)</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Parcelas</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody>
              {methods.map((m) => (
                <tr key={m.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">
                    <TruncatedText text={m.name} className="max-w-[36ch]" />
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={TYPE_BADGE[m.type]}>
                      {TYPE_LABELS[m.type]}
                    </Badge>
                  </td>
                  {/* VD-11: é este campo que as telas de venda mandam
                      configurar quando bloqueiam a venda — e ele não aparecia
                      em lugar nenhum. */}
                  <td className="px-4 py-3">
                    <LinkedAccountCell method={m} />
                  </td>
                  {isCard(m.type) ? (
                    <td colSpan={2} className="px-4 py-3 text-center">
                      {m.cardMachine ? (
                        <TruncatedText text={`Maquininha ${m.cardMachine.name}`} className="max-w-[28ch]" />
                      ) : (
                        <span className="text-xs text-destructive">Sem maquininha</span>
                      )}
                    </td>
                  ) : (<>
                  <td className="px-4 py-3 text-center">
                    {m.feePercentage > 0 ? `${m.feePercentage}%` : "-"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {m.settlementDays > 0 ? `${m.settlementDays}d` : "Imediato"}
                  </td>
                  </>)}
                  <td className="px-4 py-3 text-center">
                    {(m.maxInstallments ?? 1) > 1 ? (
                      `até ${m.maxInstallments}x`
                    ) : (
                      <span className="text-muted-foreground">À vista</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={m.isActive ? "success" : "secondary"}>
                      {m.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 md:h-8 md:w-8"
                        aria-label={`Editar ${m.name}`}
                        onClick={() => onEdit(m)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Can permission="financial:delete" mode="disable">
                        <Tooltip content={`Excluir ${m.name}`}>
                          <Button
                            variant="ghost"
                            action="delete"
                            size="icon"
                            className="h-10 w-10 md:h-8 md:w-8"
                            aria-label={`Excluir ${m.name}`}
                            onClick={() => onDelete(m)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                      </Can>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Form dialog ──────────────────────────────────────────────────────

function MethodFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: PaymentMethod | null;
}) {
  const createMutation = useCreatePaymentMethod();
  const updateMutation = useUpdatePaymentMethod();
  const { data: accountsResp } = useFinancialAccounts({ isActive: true, limit: 100 });
  const accounts = accountsResp?.data ?? [];
  const { addToast } = useToast();

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors },
  } = useForm<MethodFormValues>({
    resolver: zodResolver(methodSchemaWithAccount),
    defaultValues: {
      name: "",
      type: "CASH",
      feePercentage: 0,
      settlementDays: 0,
      maxInstallments: 1,
      autoSettle: false,
      fiscalCode: "",
      defaultAccountId: "",
      cardMachineId: "",
      isActive: true,
    },
  });

  // FN-13: nenhum submit pode morrer em silêncio.
  const onInvalid = useInvalidSubmit();

  // VD-11: o rótulo e a obrigatoriedade da conta dependem do tipo escolhido.
  const type = watch("type");

  React.useEffect(() => {
    if (open) {
      reset(
        editing
          ? {
              name: editing.name,
              type: editing.type,
              feePercentage: editing.feePercentage,
              settlementDays: editing.settlementDays,
              maxInstallments: editing.maxInstallments ?? 1,
              autoSettle: editing.autoSettle ?? false,
              fiscalCode: editing.fiscalCode ?? "",
              defaultAccountId: editing.defaultAccountId ?? "",
              cardMachineId: editing.cardMachineId ?? "",
              isActive: editing.isActive,
            }
          : {
              name: "",
              type: "CASH",
              feePercentage: 0,
              settlementDays: 0,
              maxInstallments: 1,
              autoSettle: false,
                      fiscalCode: "",
              defaultAccountId: "",
              cardMachineId: "",
              isActive: true,
            }
      );
    }
  }, [open, editing, reset]);

  const isPending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = async (data: MethodFormValues) => {
    // Empty selection means "no linked account"
    const card = isCard(data.type);
    const payload = {
      ...data,
      // No cartão, taxa, prazo e parcelas são da maquininha — nem vão.
      feePercentage: card ? undefined : data.feePercentage,
      settlementDays: card ? undefined : data.settlementDays,
      // À vista não parcela; o campo nem aparece para esses tipos.
      maxInstallments: card || IMMEDIATE_TYPES.includes(data.type) ? undefined : data.maxInstallments,
      cardMachineId: card ? data.cardMachineId : undefined,
      defaultAccountId: data.defaultAccountId || undefined,
    };
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, ...payload });
        addToast("Método atualizado com sucesso!", "success");
      } else {
        await createMutation.mutateAsync(payload);
        addToast("Método criado com sucesso!", "success");
      }
      onOpenChange(false);
    } catch (err) {
      // FN-71: a 403 here used to read as a system failure. The helper turns
      // it into "você não tem permissão…"; other errors keep their message.
      addToast(
        getApiErrorMessage(err) ??
          (editing
            ? "Erro ao atualizar método. Tente novamente."
            : "Erro ao criar método. Tente novamente."),
        "error"
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar Método" : "Novo Método"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Atualize os dados do método de pagamento."
              : "Preencha os dados para criar um novo método de pagamento."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-4"
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Nome *</label>
              <Input
                {...register("name")}
                placeholder="Ex: Cartao Visa"
                maxLength={100}
              />
              {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Tipo *</label>
              <Controller
                name="type"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          {isCard(type) ? (
            <Controller
              name="cardMachineId"
              control={control}
              render={({ field }) => (
                <CardMachineSelect
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  kind={type as "CREDIT_CARD" | "DEBIT_CARD"}
                  error={errors.cardMachineId?.message}
                />
              )}
            />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            {!isCard(type) && (<>
            <div className="space-y-1">
              <label className="text-sm font-medium">Taxa (%)</label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.01}
                {...register("feePercentage", { valueAsNumber: true })}
              />
              {errors.feePercentage ? <p className="text-xs text-destructive">
                  {errors.feePercentage.message}
                </p> : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Liquidação (dias)</label>
              <Input
                type="number"
                min={0}
                {...register("settlementDays", { valueAsNumber: true })}
              />
              {errors.settlementDays ? <p className="text-xs text-destructive">
                  {errors.settlementDays.message}
                </p> : null}
            </div>
            </>)}
            <div className="space-y-1">
              <label className="text-sm font-medium">Cód. Fiscal</label>
              <Input
                {...register("fiscalCode")}
                placeholder="Ex: 01"
                maxLength={5}
              />
              {errors.fiscalCode ? <p className="text-xs text-destructive">
                  {errors.fiscalCode.message}
                </p> : null}
            </div>
          </div>

          {!IMMEDIATE_TYPES.includes(type) && !isCard(type) && (
            <div className="space-y-1">
              <label htmlFor="method-max-installments" className="text-sm font-medium">
                Máximo de parcelas
              </label>
              <Input
                id="method-max-installments"
                type="number"
                min={1}
                max={24}
                className="sm:w-40"
                {...register("maxInstallments", { valueAsNumber: true })}
              />
              <p className="text-xs text-muted-foreground">
                Na venda, o vendedor escolhe de 1x até este número. Deixe 1 se esta
                forma não parcela.
              </p>
              {errors.maxInstallments ? <p className="text-xs text-destructive">
                  {errors.maxInstallments.message}
                </p> : null}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium">Conta vinculada{IMMEDIATE_TYPES.includes(type) ? " *" : ""}</label>
            <Controller
              name="defaultAccountId"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value || "__none"}
                  onValueChange={(v) => field.onChange(v === "__none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Nenhuma" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Nenhuma</SelectItem>
                    {accounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.defaultAccountId ? (
              <p className="text-xs text-destructive">
                {errors.defaultAccountId.message}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Vendas com este método serão direcionadas a esta conta.
            </p>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                {...register("autoSettle")}
                className="h-4 w-4 rounded border-input"
              />
              Dar baixa automática no dia da liquidação
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                {...register("isActive")}
                className="h-4 w-4 rounded border-input"
              />
              Ativo
            </label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// AE-27/FN-09: the menu hides this route, but a URL still reaches it — the
// page guard is the real one.
export default function PaymentMethodsPage() {
  return (
    <RequirePermission permission="financial:create" subject="os métodos de pagamento">
      <PaymentMethodsPageContent />
    </RequirePermission>
  );
}
