"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import React, { useCallback } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useInvalidSubmit } from "@/hooks/use-invalid-submit";
import {
  useAdjustStock,
  useInventoryItems,
  useWarehouses,
} from "@/hooks/use-inventory";
import { getMutationErrorMessage } from "@/lib/mutation-error";

import { FieldShell, WarehouseField } from "./movement-fields";
import { requireVariant, variantFields } from "./movement-variant";
import { ProductVariantField } from "./product-variant-field";

const ADJUSTMENT_REASONS = [
  { value: "COUNT", label: "Inventário / contagem" },
  { value: "DAMAGE", label: "Avaria" },
  { value: "THEFT", label: "Furto / perda" },
  { value: "ADJUSTMENT", label: "Outro ajuste" },
] as const;

const schema = z.object({
  productId: z.string().min(1, "Selecione um produto"),
  warehouseId: z.string().min(1, "Selecione um depósito"),
  countedQuantity: z.coerce
    .number()
    .int("A quantidade contada deve ser um número inteiro")
    .min(0, "A quantidade contada não pode ser negativa")
    .max(1_000_000, "Quantidade acima do limite permitido"),
  reason: z.enum(["COUNT", "DAMAGE", "THEFT", "ADJUSTMENT"]),
  // Mandatory: an adjustment rewrites a balance with no document behind it, so
  // the justification is the only audit trail there is.
  notes: z
    .string()
    .min(3, "Descreva o motivo do ajuste")
    .max(500, "Justificativa muito longa"),
  ...variantFields,
}).superRefine(requireVariant);

type FormValues = z.infer<typeof schema>;

/**
 * AE-25: stock adjustment from a physical count.
 *
 * The operator types the balance they counted, not a difference. The delta is
 * shown for confirmation but never sent: the server recomputes it from the
 * balance inside the transaction, so a sale that lands mid-form is not undone.
 */
export function AdjustmentForm({ onDone }: { onDone: () => void }) {
  const { addToast } = useToast();
  const adjustStock = useAdjustStock();
  const { data: warehousesResp } = useWarehouses();
  const warehouses = warehousesResp?.data ?? [];

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      productId: "",
      warehouseId: "",
      countedQuantity: 0,
      reason: "COUNT",
      notes: "",
    },
  });
  const onInvalid = useInvalidSubmit();

  const [productId, variantId] = watch(["productId", "variantId"]);
  const onHasVariants = useCallback(
    (has: boolean) => setValue("hasVariants", has, { shouldValidate: false }),
    [setValue]
  );
  const warehouseId = watch("warehouseId");
  const countedQuantity = watch("countedQuantity");

  // A listagem não filtra por variação: o saldo é o da linha do tamanho escolhido.
  const { data: itemsResp } = useInventoryItems(
    productId && warehouseId ? { productId, warehouseId, limit: 100 } : {}
  );
  const currentQuantity =
    productId && warehouseId
      ? (itemsResp?.data ?? []).find(
          (row) => (row.variantId ?? "") === (variantId ?? "")
        )?.quantity ?? 0
      : null;

  const delta =
    currentQuantity === null ? null : Number(countedQuantity || 0) - currentQuantity;

  const onSubmit = async (values: FormValues) => {
    try {
      const result = await adjustStock.mutateAsync({
        productId: values.productId,
        variantId: values.variantId || undefined,
        warehouseId: values.warehouseId,
        countedQuantity: values.countedQuantity,
        reason: values.reason,
        notes: values.notes,
      });
      addToast(
        `Ajuste registrado: ${result.previousQuantity} → ${result.newQuantity} un.`,
        "success"
      );
      onDone();
    } catch (err) {
      addToast(
        getMutationErrorMessage(err, "Erro ao ajustar o estoque."),
        "error"
      );
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit, onInvalid)}
      className="flex min-h-0 flex-1 flex-col"
      noValidate
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <ProductVariantField
          productId={productId}
          variantId={variantId ?? ""}
          onChange={(next) => {
            setValue("productId", next.productId, { shouldValidate: !!next.productId });
            setValue("variantId", next.variantId, { shouldValidate: !!next.variantId });
          }}
          onHasVariantsChange={onHasVariants}
          productError={errors.productId?.message}
          variantError={errors.variantId?.message}
        />

        <WarehouseField
          label="Depósito"
          value={warehouseId}
          onChange={(v) => setValue("warehouseId", v, { shouldValidate: true })}
          warehouses={warehouses}
          error={errors.warehouseId?.message}
        />

        <div className="grid grid-cols-2 gap-3">
          <FieldShell label="Saldo no sistema">
            <Input
              readOnly
              value={currentQuantity === null ? "—" : String(currentQuantity)}
              className="bg-muted"
            />
          </FieldShell>
          <FieldShell label="Quantidade contada" error={errors.countedQuantity?.message}>
            <Input type="number" min={0} {...register("countedQuantity")} />
          </FieldShell>
        </div>

        {delta !== null && delta !== 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="adjustment-delta">
            Diferença a registrar:{" "}
            <span className={delta > 0 ? "text-emerald-600" : "text-destructive"}>
              {delta > 0 ? `+${delta}` : delta} un.
            </span>
          </p>
        ) : null}

        <FieldShell label="Motivo" error={errors.reason?.message}>
          <Select
            value={watch("reason")}
            onValueChange={(v) =>
              setValue("reason", v as FormValues["reason"], { shouldValidate: true })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Motivo" />
            </SelectTrigger>
            <SelectContent>
              {ADJUSTMENT_REASONS.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldShell>

        <FieldShell label="Justificativa *" error={errors.notes?.message}>
          <Input
            maxLength={500}
            {...register("notes")}
            placeholder="Ex.: contagem cíclica de agosto"
          />
        </FieldShell>
      </div>

      <div className="mt-4 flex shrink-0 justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={adjustStock.isPending}>
          {adjustStock.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Registrar ajuste
        </Button>
      </div>
    </form>
  );
}
