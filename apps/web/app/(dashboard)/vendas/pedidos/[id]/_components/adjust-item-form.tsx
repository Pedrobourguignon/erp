"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useCashRegisterSessions } from "@/hooks/use-cash-registers";
import { useInvalidSubmit } from "@/hooks/use-invalid-submit";
import { useExchangeOrderItem, useReturnOrderItem } from "@/hooks/use-order-adjustments";
import type { OrderDetail, OrderItem } from "@/hooks/use-orders";
import { usePaymentMethods } from "@/hooks/use-payment-methods";
import { getMutationErrorMessage } from "@/lib/mutation-error";
import {
  REASON_MAX_LENGTH,
  adjustmentSuccessMessage,
  buildAdjustItemSchema,
  previewAdjustment,
  settlementOptions,
  toAdjustmentRequest,
  type AdjustItemValues,
  type AdjustMode,
} from "@/lib/order-adjustment";

import { AdjustItemSettlement } from "./adjust-item-settlement";
import { AdjustItemTarget } from "./adjust-item-target";

type AdjustItemFormProps = {
  order: OrderDetail;
  item: OrderItem;
  mode: AdjustMode;
  onDone: () => void;
};

export function AdjustItemForm({ order, item, mode, onDone }: AdjustItemFormProps) {
  const { addToast } = useToast();
  const onInvalid = useInvalidSubmit();
  const exchange = useExchangeOrderItem();
  const giveBack = useReturnOrderItem();
  const [newUnitPrice, setNewUnitPrice] = useState<number | null>(null);

  const { data: methodsResp } = usePaymentMethods({ isActive: true });
  const { data: sessionsResp } = useCashRegisterSessions({ status: "OPEN", limit: 20 });
  const openSessions = useMemo(() => sessionsResp?.data ?? [], [sessionsResp]);
  const { methods, sessionRequiredFor } = useMemo(
    () => settlementOptions({ methods: methodsResp?.data ?? [], openSessions, orderSessionId: order.cashRegisterSessionId }),
    [methodsResp, openSessions, order.cashRegisterSessionId]
  );

  // O resolver valida com os valores do envio; a prévia diz se ainda há
  // dinheiro a movimentar com eles (o preço do produto novo vem de fora do form).
  const priceRef = useRef<number | null>(null);
  priceRef.current = newUnitPrice;
  const schema = useMemo(
    () =>
      buildAdjustItemSchema({
        maxQuantity: item.quantity,
        sessionRequiredFor,
        settlementApplies: (v) => {
          const p = previewAdjustment({
            order, item, quantity: Number(v.quantity), mode,
            newUnitPrice: mode === "product" && v.productId ? priceRef.current : null,
          });
          return !!p && (p.charge > 0 || p.refund > 0);
        },
      }),
    [item, order, mode, sessionRequiredFor]
  );
  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<AdjustItemValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      mode, quantity: item.quantity, productId: "", variantId: "", reason: "",
      settleNow: true, paymentMethodId: "", cashRegisterSessionId: "",
    },
  });

  const [quantity, productId, variantId, settleNow, paymentMethodId] = watch([
    "quantity", "productId", "variantId", "settleNow", "paymentMethodId",
  ]);
  const preview = previewAdjustment({
    order, item, quantity: Number(quantity), mode,
    newUnitPrice: mode === "product" && productId ? newUnitPrice : null,
  });
  const pending = exchange.isPending || giveBack.isPending;

  const onSubmit = async (values: AdjustItemValues) => {
    const request = toAdjustmentRequest(values, {
      orderId: order.id,
      item,
      hasDifference: !!preview && (preview.charge > 0 || preview.refund > 0),
    });
    try {
      const { data } =
        request.kind === "exchange"
          ? await exchange.mutateAsync(request.payload)
          : await giveBack.mutateAsync(request.payload);
      addToast(adjustmentSuccessMessage(data), "success");
      onDone();
    } catch (error) {
      addToast(getMutationErrorMessage(error, "Não foi possível registrar. Tente novamente."), "error");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate className="space-y-4">
      {mode !== "return" ? (
        <AdjustItemTarget
          control={control}
          errors={errors}
          mode={mode}
          productId={mode === "size" ? item.productId : productId}
          variantId={variantId}
          excludeVariantId={mode === "size" ? item.variantId : null}
          onPriceChange={setNewUnitPrice}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <div className="space-y-1">
          <label htmlFor="adjust-quantity" className="text-sm font-medium">Quantidade *</label>
          <Input id="adjust-quantity" type="number" inputMode="numeric" {...register("quantity")} />
          <p className="text-xs text-muted-foreground">de {item.quantity} vendida(s)</p>
          {errors.quantity ? <p className="text-xs text-destructive">{errors.quantity.message}</p> : null}
        </div>
        <div className="min-w-0 space-y-1">
          <label htmlFor="adjust-reason" className="text-sm font-medium">
            Motivo{mode === "return" ? " *" : ""}
          </label>
          <Input id="adjust-reason" maxLength={REASON_MAX_LENGTH} placeholder="Ex.: ficou pequeno, defeito" {...register("reason")} />
          {errors.reason ? <p className="text-xs text-destructive">{errors.reason.message}</p> : null}
        </div>
      </div>

      <AdjustItemSettlement
        preview={preview}
        control={control}
        register={register}
        errors={errors}
        settleNow={settleNow}
        methods={methods}
        sessionChoices={settleNow && sessionRequiredFor(paymentMethodId) ? openSessions : []}
      />

      <DialogFooter>
        <Button type="button" variant="cancel" onClick={onDone}>Cancelar</Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {mode === "return" ? "Confirmar devolução" : "Confirmar troca"}
        </Button>
      </DialogFooter>
    </form>
  );
}
