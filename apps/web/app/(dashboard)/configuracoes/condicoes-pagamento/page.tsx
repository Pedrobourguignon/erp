"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import React, { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";

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
import { TruncatedText } from "@/components/ui/truncated-text";
import { useFilters } from "@/hooks/use-filters";
import { useInvalidSubmit } from "@/hooks/use-invalid-submit";
import {
  usePaymentConditions,
  useCreatePaymentCondition,
  useUpdatePaymentCondition,
  useDeletePaymentCondition,
  type PaymentCondition,
  type PaymentConditionType,
} from "@/hooks/use-payment-conditions";
import { usePaymentMethods } from "@/hooks/use-payment-methods";
import { getApiErrorMessage } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";



// ─── Constants ─────────────────────────────────────────────────────────

const TYPE_OPTIONS: { value: PaymentConditionType; label: string }[] = [
  { value: "CASH", label: "A Vista" },
  { value: "INSTALLMENT", label: "Parcelado" },
  { value: "ENTRY_PLUS_INSTALLMENT", label: "Entrada + Parcelas" },
];

const TYPE_BADGE: Record<PaymentConditionType, "success" | "default" | "warning"> = {
  CASH: "success",
  INSTALLMENT: "default",
  ENTRY_PLUS_INSTALLMENT: "warning",
};

const TYPE_LABELS: Record<PaymentConditionType, string> = {
  CASH: "A Vista",
  INSTALLMENT: "Parcelado",
  ENTRY_PLUS_INSTALLMENT: "Entrada + Parcelas",
};

// ─── Schema ────────────────────────────────────────────────────────────

const conditionSchema = z.object({
  name: z.string().min(1, "Nome obrigatório").max(100),
  code: z.string().min(1, "Código obrigatório").max(20),
  type: z.enum(["CASH", "INSTALLMENT", "ENTRY_PLUS_INSTALLMENT"]),
  // FN-14: `max={48}` no HTML é contornável — a regra tem que estar aqui.
  installments: z
    .number()
    .int("Informe um número inteiro de parcelas")
    .min(1, "A condição precisa de pelo menos 1 parcela")
    .max(48, "O máximo é 48 parcelas")
    .default(1),
  daysBetweenInstallments: z
    .number()
    .int("Informe um número inteiro de dias")
    .min(0, "O intervalo não pode ser negativo")
    .max(365, "O intervalo máximo é 365 dias")
    .default(30),
  // A API devolve `entryPercentage` de um campo Decimal; `coerce` garante que
  // um valor numérico em string nunca derrube o submit por um campo que só
  // aparece no tipo "Entrada + Parcelas" — erro invisível, toast sem causa.
  entryPercentage: z.coerce
    .number()
    .min(0, "A entrada não pode ser negativa")
    .max(100, "A entrada não pode passar de 100% do valor")
    .default(0),
  paymentMethodIds: z.array(z.string()).default([]),
});

type ConditionFormValues = z.infer<typeof conditionSchema>;

// ─── Page ──────────────────────────────────────────────────────────────

function PaymentConditionsPageContent() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentCondition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PaymentCondition | null>(null);

  // FT-05: nem busca a tela tinha.
  const filters = useFilters({ search: "", type: "", isActive: "" }, () => {});

  const { data, isLoading } = usePaymentConditions({
    search: filters.values.search || undefined,
    type: (filters.values.type || undefined) as PaymentConditionType | undefined,
    isActive: filters.values.isActive
      ? filters.values.isActive === "true"
      : undefined,
  });

  const conditions = data?.data ?? [];

  const handleEdit = (condition: PaymentCondition) => {
    setEditing(condition);
    setFormOpen(true);
  };

  const handleCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* `flex-wrap` + `items-start`: o painel de filtros pede a linha inteira
          (`basis-full`) e só consegue tomá-la se a linha puder quebrar. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight">
            Condições de Pagamento
          </h1>
          <p className="text-muted-foreground">
            Configure as condições de pagamento disponíveis
          </p>
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
              <SelectValue placeholder="Ativas e inativas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Ativas e inativas</SelectItem>
              <SelectItem value="true">Somente ativas</SelectItem>
              <SelectItem value="false">Somente inativas</SelectItem>
            </SelectContent>
          </Select>
        </FilterField>
      </FilterPanel>
        <Button onClick={handleCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Condição
        </Button>
      </div>

      <ConditionsTable
        conditions={conditions}
        isLoading={isLoading}
        onEdit={handleEdit}
        onDelete={setDeleteTarget}
      />

      <ConditionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
      />

      <DeleteConditionDialog
        condition={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── Table ─────────────────────────────────────────────────────────────

function ConditionsTable({
  conditions,
  isLoading,
  onEdit,
  onDelete,
}: {
  conditions: PaymentCondition[];
  isLoading: boolean;
  onEdit: (c: PaymentCondition) => void;
  onDelete: (c: PaymentCondition) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (conditions.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Nenhuma condição de pagamento cadastrada
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
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Código</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Métodos vinculados</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Parcelas</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Dias</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Entrada %</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody>
              {conditions.map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">
                    <TruncatedText text={c.name} className="max-w-[36ch]" />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    <TruncatedText text={c.code} className="max-w-[24ch]" />
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={TYPE_BADGE[c.type]}>
                      {TYPE_LABELS[c.type]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.paymentMethods && c.paymentMethods.length > 0 ? (
                      <TruncatedText
                        text={c.paymentMethods.map((m) => m.name).join(", ")}
                        className="max-w-[28ch]"
                      />
                    ) : (
                      <span className="text-xs">Todos os métodos</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">{c.installments}</td>
                  <td className="px-4 py-3 text-center">
                    {/* Com uma só parcela não há intervalo: o "30" era o
                        default do formulário, não uma regra da condição. */}
                    {c.installments > 1 ? c.daysBetweenInstallments : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">{c.entryPercentage}%</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-10 w-10 md:h-8 md:w-8" onClick={() => onEdit(c)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" action="delete" size="icon" className="h-10 w-10 text-destructive md:h-8 md:w-8" onClick={() => onDelete(c)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
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

// ─── Form dialog ───────────────────────────────────────────────────────

function ConditionFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: PaymentCondition | null;
}) {
  const createMutation = useCreatePaymentCondition();
  const updateMutation = useUpdatePaymentCondition();
  const { data: methodsResp } = usePaymentMethods({ isActive: true, limit: 100 });
  const methods = methodsResp?.data ?? [];
  const { addToast } = useToast();

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors },
  } = useForm<ConditionFormValues>({
    resolver: zodResolver(conditionSchema),
    defaultValues: editing
      ? {
          name: editing.name,
          code: editing.code,
          type: editing.type,
          installments: editing.installments,
          daysBetweenInstallments: editing.daysBetweenInstallments,
          entryPercentage: editing.entryPercentage,
          paymentMethodIds: editing.paymentMethodIds,
        }
      : {
          name: "",
          code: "",
          type: "CASH",
          installments: 1,
          daysBetweenInstallments: 30,
          entryPercentage: 0,
          paymentMethodIds: [],
        },
  });

  // FN-13: nenhum submit pode morrer em silêncio.
  const onInvalid = useInvalidSubmit();

  // Reset form when editing changes
  React.useEffect(() => {
    if (open) {
      reset(
        editing
          ? {
              name: editing.name,
              code: editing.code,
              type: editing.type,
              installments: editing.installments,
              daysBetweenInstallments: editing.daysBetweenInstallments,
              entryPercentage: editing.entryPercentage,
              paymentMethodIds: editing.paymentMethodIds,
            }
          : {
              name: "",
              code: "",
              type: "CASH",
              installments: 1,
              daysBetweenInstallments: 30,
              entryPercentage: 0,
              paymentMethodIds: [],
            }
      );
    }
  }, [open, editing, reset]);

  const selectedType = watch("type");
  const installments = watch("installments");
  const daysBetween = watch("daysBetweenInstallments");
  const entryPct = watch("entryPercentage");
  const showInstallments = selectedType !== "CASH";
  const showEntry = selectedType === "ENTRY_PLUS_INSTALLMENT";
  const isPending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = async (data: ConditionFormValues) => {
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, ...data });
        addToast("Condicao atualizada com sucesso!", "success");
      } else {
        await createMutation.mutateAsync(data);
        addToast("Condicao criada com sucesso!", "success");
      }
      onOpenChange(false);
    } catch (err) {
      addToast(
        getApiErrorMessage(err) ??
          (editing
            ? "Erro ao atualizar condição. Tente novamente."
            : "Erro ao criar condição. Tente novamente."),
        "error"
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* FN-14: com 999 parcelas o preview crescia sem limite e os botões
          Cancelar/Criar ficavam permanentemente fora da viewport — só o ESC
          resolvia. Corpo rolável, rodapé sempre visível. */}
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar Condição" : "Nova Condição"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Atualize os dados da condição de pagamento."
              : "Preencha os dados para criar uma nova condição de pagamento."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit, onInvalid)}
          className="flex min-h-0 flex-1 flex-col"
          noValidate
        >
          {/* FN-14: só o corpo rola; o rodapé com Cancelar/Criar fica fixo. */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Nome *</label>
              <Input {...register("name")} placeholder="Ex: 3x sem juros" maxLength={100} />
              {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Codigo *</label>
              <Input {...register("code")} placeholder="Ex: 3X_SJ" maxLength={20} />
              {errors.code ? <p className="text-xs text-destructive">{errors.code.message}</p> : null}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Tipo *</label>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {showInstallments ? <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">Parcelas</label>
                <Input
                  type="number"
                  min={1}
                  max={48}
                  {...register("installments", { valueAsNumber: true })}
                />
                {errors.installments ? <p className="text-xs text-destructive">{errors.installments.message}</p> : null}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Dias entre parcelas</label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  {...register("daysBetweenInstallments", { valueAsNumber: true })}
                />
                {errors.daysBetweenInstallments ? <p className="text-xs text-destructive">{errors.daysBetweenInstallments.message}</p> : null}
              </div>
            </div> : null}

          {showEntry ? <div className="space-y-1">
              <label className="text-sm font-medium">Entrada (%)</label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.01}
                {...register("entryPercentage", { valueAsNumber: true })}
              />
              {errors.entryPercentage ? <p className="text-xs text-destructive">{errors.entryPercentage.message}</p> : null}
            </div> : null}

          {/* SCRUM-52: sem nenhum marcado, a condição continua aparecendo pra
              qualquer método que mostre condição — igual ao comportamento de
              antes. Marcar restringe a tela de venda a só esses métodos. */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Métodos de pagamento vinculados</label>
            <p className="text-xs text-muted-foreground">
              Nenhum marcado: a condição aparece para qualquer método. Marcando um ou
              mais, ela só aparece para eles na tela de venda.
            </p>
            <Controller
              name="paymentMethodIds"
              control={control}
              render={({ field }) => (
                <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                  {methods.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nenhum método de pagamento ativo cadastrado.
                    </p>
                  ) : (
                    methods.map((m) => (
                      <label key={m.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={field.value.includes(m.id)}
                          onChange={(e) => {
                            field.onChange(
                              e.target.checked
                                ? [...field.value, m.id]
                                : field.value.filter((id) => id !== m.id)
                            );
                          }}
                        />
                        <TruncatedText text={m.name} className="max-w-[20ch]" />
                      </label>
                    ))
                  )}
                </div>
              )}
            />
          </div>

          {/* Preview */}
          <InstallmentPreview
            type={selectedType}
            installments={installments}
            daysBetween={daysBetween}
            entryPercentage={entryPct}
          />
          </div>

          <DialogFooter className="mt-4 shrink-0 border-t pt-4">
            <Button type="button" variant="cancel" onClick={() => onOpenChange(false)}>
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

// ─── Preview ───────────────────────────────────────────────────────────

function InstallmentPreview({
  type,
  installments,
  daysBetween,
  entryPercentage,
}: {
  type: PaymentConditionType;
  installments: number;
  daysBetween: number;
  entryPercentage: number;
}) {
  const SAMPLE_AMOUNT = 1000;

  const lines = React.useMemo(() => {
    if (type === "CASH") {
      return [{ label: "A vista", amount: SAMPLE_AMOUNT, days: 0 }];
    }

    const result: { label: string; amount: number; days: number }[] = [];

    if (type === "ENTRY_PLUS_INSTALLMENT" && entryPercentage > 0) {
      const entryAmount = (SAMPLE_AMOUNT * entryPercentage) / 100;
      result.push({ label: "Entrada", amount: entryAmount, days: 0 });
      const remaining = SAMPLE_AMOUNT - entryAmount;
      const perInstallment = remaining / Math.max(installments, 1);
      for (let i = 1; i <= installments; i++) {
        result.push({
          label: `Parcela ${i}/${installments}`,
          amount: perInstallment,
          days: i * daysBetween,
        });
      }
    } else {
      const perInstallment = SAMPLE_AMOUNT / Math.max(installments, 1);
      for (let i = 1; i <= installments; i++) {
        result.push({
          label: `Parcela ${i}/${installments}`,
          amount: perInstallment,
          days: i * daysBetween,
        });
      }
    }

    return result;
  }, [type, installments, daysBetween, entryPercentage]);

  // Mesmo com o limite de 48 no schema, 48 linhas já estouram o diálogo.
  const MAX_PREVIEW_LINES = 6;
  const visibleLines = lines.slice(0, MAX_PREVIEW_LINES);
  const hiddenCount = lines.length - visibleLines.length;

  return (
    <div className="rounded-lg border bg-muted/30 p-3 dark:bg-muted/10">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Exemplo para {formatCurrency(SAMPLE_AMOUNT)}
      </p>
      <div className="space-y-1">
        {visibleLines.map((line, idx) => (
          <div key={idx} className="flex items-center justify-between text-sm">
            <span>{line.label}</span>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {line.days === 0 ? "Hoje" : `${line.days} dias`}
              </span>
              <span className="font-medium">{formatCurrency(line.amount)}</span>
            </div>
          </div>
        ))}
        {hiddenCount > 0 && (
          <p className="pt-1 text-xs text-muted-foreground">
            … e mais {hiddenCount} parcela{hiddenCount > 1 ? "s" : ""}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Delete dialog ─────────────────────────────────────────────────────

function DeleteConditionDialog({
  condition,
  onClose,
}: {
  condition: PaymentCondition | null;
  onClose: () => void;
}) {
  const deleteMutation = useDeletePaymentCondition();
  const { addToast } = useToast();

  const handleDelete = async () => {
    if (!condition) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(condition.id);
      addToast("Condicao excluida com sucesso!", "success");
      onClose();
    } catch (err) {
      addToast(
        getApiErrorMessage(err) ?? "Erro ao excluir condição. Tente novamente.",
        "error"
      );
      onClose();
    }
  };

  return (
    <ConfirmDialog
      open={!!condition}
      onOpenChange={(open) => !open && onClose()}
      title="Excluir Condicao"
      message={`Deseja excluir a condicao "${condition?.name}"? Esta acao nao pode ser desfeita.`}
      destructive
      loading={deleteMutation.isPending}
      onConfirm={handleDelete}
    />
  );
}

// AE-27/FN-09: the menu hides this route, but a URL still reaches it — the
// page guard is the real one.
export default function PaymentConditionsPage() {
  return (
    <RequirePermission permission="financial:create" subject="as condições de pagamento">
      <PaymentConditionsPageContent />
    </RequirePermission>
  );
}
