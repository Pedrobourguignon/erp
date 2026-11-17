"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import React, { useCallback } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { MoneyInput } from "@/components/forms/money-input";
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
  useCreateMovement,
  useWarehouses,
  type MovementType,
  type MovementReason,
  type CreateMovementPayload,
} from "@/hooks/use-inventory";
import { getMutationErrorMessage } from "@/lib/mutation-error";

import { FieldShell, WarehouseField } from "./movement-fields";
import { requireVariant, variantFields } from "./movement-variant";
import { ProductVariantField } from "./product-variant-field";

const REASONS_BY_TYPE: Record<"ENTRY" | "EXIT", { value: MovementReason; label: string }[]> = {
  ENTRY: [
    { value: "PURCHASE", label: "Compra" },
    { value: "RETURN_CUSTOMER", label: "Devolução de cliente" },
    { value: "PRODUCTION", label: "Produção" },
    { value: "INITIAL", label: "Saldo inicial" },
  ],
  EXIT: [
    { value: "SALE", label: "Venda" },
    { value: "RETURN_SUPPLIER", label: "Devolução a fornecedor" },
    { value: "DAMAGE", label: "Avaria" },
    { value: "THEFT", label: "Furto/Perda" },
  ],
};

// The reason list is already scoped to this form's type, so the ENTRY/EXIT
// cross-check the single-form version needed no longer has anything to catch.
const schema = z.object({
  productId: z.string().min(1, "Selecione um produto"),
  warehouseId: z.string().min(1, "Selecione um depósito"),
  quantity: z.coerce
    .number()
    .int("Quantidade deve ser um número inteiro")
    .min(1, "Quantidade deve ser ao menos 1")
    .max(1_000_000, "Quantidade acima do limite permitido"),
  reason: z.string().min(1, "Selecione um motivo"),
  // O custo médio do saldo só existe se a entrada disser quanto custou. Em
  // branco, a API cai no custo de cadastro do produto — nunca em zero.
  unitCost: z.coerce
    .number()
    .min(0, "O custo não pode ser negativo")
    .max(9_999_999, "Custo acima do limite permitido")
    .optional(),
  notes: z.string().max(500, "Observação muito longa").optional(),
  ...variantFields,
}).superRefine(requireVariant);

type FormValues = z.infer<typeof schema>;

interface EntryExitFormProps {
  type: "ENTRY" | "EXIT";
  onDone: () => void;
}

export function EntryExitForm({ type, onDone }: EntryExitFormProps) {
  const { addToast } = useToast();
  const createMovement = useCreateMovement();
  const { data: warehousesResp } = useWarehouses();
  const warehouses = warehousesResp?.data ?? [];

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { productId: "", warehouseId: "", quantity: 1, reason: "" },
  });
  const onInvalid = useInvalidSubmit();
  const [productId, variantId] = watch(["productId", "variantId"]);
  const onHasVariants = useCallback(
    (has: boolean) => setValue("hasVariants", has, { shouldValidate: false }),
    [setValue]
  );

  const onSubmit = async (values: FormValues) => {
    const payload: CreateMovementPayload = {
      productId: values.productId,
      variantId: values.variantId || undefined,
      type: type as MovementType,
      reason: values.reason as MovementReason,
      quantity: values.quantity,
      // Só entrada reprecifica o saldo; mandar custo numa saída não teria efeito.
      ...(type === "ENTRY" && values.unitCost ? { unitCost: values.unitCost } : {}),
      notes: values.notes || undefined,
      ...(type === "ENTRY"
        ? { toWarehouseId: values.warehouseId }
        : { fromWarehouseId: values.warehouseId }),
    };

    try {
      await createMovement.mutateAsync(payload);
      addToast("Movimentação registrada com sucesso!", "success");
      onDone();
    } catch (err) {
      addToast(
        getMutationErrorMessage(
          err,
          "Erro ao registrar movimentação. Verifique o estoque e tente novamente."
        ),
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
      {/* AE-26: o corpo rola e o rodapé fica fixo — o dropdown de produto
          cobria os campos de baixo e não havia como alcançá-los. */}
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
          label={type === "ENTRY" ? "Depósito de destino" : "Depósito de origem"}
          value={watch("warehouseId")}
          onChange={(v) => setValue("warehouseId", v, { shouldValidate: true })}
          warehouses={warehouses}
          error={errors.warehouseId?.message}
        />

        <div className="grid grid-cols-2 gap-3">
          <FieldShell label="Quantidade" error={errors.quantity?.message}>
            <Input type="number" min={1} {...register("quantity")} />
          </FieldShell>
          <FieldShell label="Motivo" error={errors.reason?.message}>
            <Select
              value={watch("reason")}
              onValueChange={(v) => setValue("reason", v, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Motivo" />
              </SelectTrigger>
              <SelectContent>
                {REASONS_BY_TYPE[type].map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>
        </div>

        {type === "ENTRY" ? (
          <MoneyInput
            name="unitCost"
            control={control}
            label="Custo unitário"
            error={errors.unitCost?.message}
          />
        ) : null}

        <FieldShell label="Observações" error={errors.notes?.message}>
          <Input maxLength={500} {...register("notes")} placeholder="Opcional" />
        </FieldShell>
      </div>

      <div className="mt-4 flex shrink-0 justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={createMovement.isPending}>
          {createMovement.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Registrar
        </Button>
      </div>
    </form>
  );
}
