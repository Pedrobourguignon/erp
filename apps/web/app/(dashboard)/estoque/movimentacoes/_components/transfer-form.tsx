"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Loader2 } from "lucide-react";
import React, { useCallback } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useInvalidSubmit } from "@/hooks/use-invalid-submit";
import { useTransferStock, useWarehouses } from "@/hooks/use-inventory";
import { getMutationErrorMessage } from "@/lib/mutation-error";

import { FieldShell, WarehouseField } from "./movement-fields";
import { requireVariant, variantFields } from "./movement-variant";
import { ProductVariantField } from "./product-variant-field";

const schema = z
  .object({
    productId: z.string().min(1, "Selecione um produto"),
    fromWarehouseId: z.string().min(1, "Selecione o depósito de origem"),
    toWarehouseId: z.string().min(1, "Selecione o depósito de destino"),
    quantity: z.coerce
      .number()
      .int("Quantidade deve ser um número inteiro")
      .min(1, "Quantidade deve ser ao menos 1")
      .max(1_000_000, "Quantidade acima do limite permitido"),
    notes: z.string().max(500, "Observação muito longa").optional(),
    ...variantFields,
  })
  .superRefine(requireVariant)
  .superRefine((values, ctx) => {
    if (values.fromWarehouseId && values.fromWarehouseId === values.toWarehouseId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toWarehouseId"],
        message: "O destino deve ser diferente da origem",
      });
    }
  });

type FormValues = z.infer<typeof schema>;

/**
 * AE-25: transfer between warehouses.
 *
 * The backend has had `POST /inventory/transfer` all along — with the origin ≠
 * destination and balance checks — and the dialog said transfers "have their
 * own flows", which existed nowhere in the frontend.
 */
export function TransferForm({ onDone }: { onDone: () => void }) {
  const { addToast } = useToast();
  const transferStock = useTransferStock();
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
      fromWarehouseId: "",
      toWarehouseId: "",
      quantity: 1,
      notes: "",
    },
  });
  const onInvalid = useInvalidSubmit();

  const fromWarehouseId = watch("fromWarehouseId");
  const toWarehouseId = watch("toWarehouseId");

  const [productId, variantId] = watch(["productId", "variantId"]);
  const onHasVariants = useCallback(
    (has: boolean) => setValue("hasVariants", has, { shouldValidate: false }),
    [setValue]
  );

  const onSubmit = async (values: FormValues) => {
    try {
      await transferStock.mutateAsync({
        productId: values.productId,
        variantId: values.variantId || undefined,
        fromWarehouseId: values.fromWarehouseId,
        toWarehouseId: values.toWarehouseId,
        quantity: values.quantity,
        notes: values.notes || undefined,
      });
      addToast("Transferência registrada com sucesso!", "success");
      onDone();
    } catch (err) {
      addToast(
        getMutationErrorMessage(err, "Erro ao transferir o estoque."),
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

        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <WarehouseField
            label="Origem"
            value={fromWarehouseId}
            onChange={(v) => setValue("fromWarehouseId", v, { shouldValidate: true })}
            warehouses={warehouses}
            excludeId={toWarehouseId}
            error={errors.fromWarehouseId?.message}
            placeholder="De"
          />
          <ArrowRight className="mb-2.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <WarehouseField
            label="Destino"
            value={toWarehouseId}
            onChange={(v) => setValue("toWarehouseId", v, { shouldValidate: true })}
            warehouses={warehouses}
            excludeId={fromWarehouseId}
            error={errors.toWarehouseId?.message}
            placeholder="Para"
          />
        </div>

        <FieldShell label="Quantidade" error={errors.quantity?.message}>
          <Input type="number" min={1} {...register("quantity")} />
        </FieldShell>

        <FieldShell label="Motivo / observações" error={errors.notes?.message}>
          <Input maxLength={500} {...register("notes")} placeholder="Opcional" />
        </FieldShell>
      </div>

      <div className="mt-4 flex shrink-0 justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={transferStock.isPending}>
          {transferStock.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Transferir
        </Button>
      </div>
    </form>
  );
}
