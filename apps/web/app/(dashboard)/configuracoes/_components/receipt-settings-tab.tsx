"use client";

import {
  RECEIPT_FOOTER_MAX_LENGTH,
  RECEIPT_FORMATS,
  RECEIPT_FORMAT_LABELS,
  type ReceiptFormat,
} from "@erp/constants";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Can } from "@/components/auth/can";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useInvalidSubmit } from "@/hooks/use-invalid-submit";
import { useTenant, useUpdateTenant } from "@/hooks/use-tenant";
import { getMutationErrorMessage } from "@/lib/mutation-error";
import { cn } from "@/lib/utils";

const receiptSettingsSchema = z.object({
  receiptFormat: z.enum(RECEIPT_FORMATS),
  receiptFooter: z
    .string()
    .max(RECEIPT_FOOTER_MAX_LENGTH, `O rodapé tem no máximo ${RECEIPT_FOOTER_MAX_LENGTH} caracteres`),
});

type ReceiptSettingsValues = z.infer<typeof receiptSettingsSchema>;

const FORMAT_HINTS: Record<ReceiptFormat, string> = {
  THERMAL_80: "Impressora de cupom padrão (bobina de 80 mm)",
  THERMAL_58: "Impressora de cupom pequena ou portátil (bobina de 58 mm)",
  A4: "Impressora comum, em folha A4",
};

/** Papel da impressora e rodapé do recibo que o vendedor imprime para o cliente. */
export function ReceiptSettingsTab() {
  const { data: tenant, isLoading, isError, error } = useTenant();
  const updateTenant = useUpdateTenant();
  const { addToast } = useToast();
  const onInvalid = useInvalidSubmit();

  const { register, handleSubmit, reset, setValue, watch, formState } =
    useForm<ReceiptSettingsValues>({
      resolver: zodResolver(receiptSettingsSchema),
      defaultValues: { receiptFormat: "THERMAL_80", receiptFooter: "" },
    });
  const format = watch("receiptFormat");

  useEffect(() => {
    if (!tenant) {return;}
    reset({
      receiptFormat: tenant.receiptFormat ?? "THERMAL_80",
      receiptFooter: tenant.receiptFooter ?? "",
    });
  }, [tenant, reset]);

  const onSubmit = async (values: ReceiptSettingsValues) => {
    try {
      await updateTenant.mutateAsync(values);
      addToast("Configurações do recibo salvas!", "success");
    } catch (err) {
      addToast(getMutationErrorMessage(err, "Erro ao salvar as configurações do recibo."), "error");
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando as configurações do recibo...
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-destructive">
          {getMutationErrorMessage(error, "Não foi possível carregar as configurações do recibo.")}
        </CardContent>
      </Card>
    );
  }

  const footerError = formState.errors.receiptFooter?.message;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recibo do cliente</CardTitle>
        <CardDescription>
          O comprovante que o vendedor imprime na venda e na troca. Não é documento fiscal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-5" noValidate>
          <div className="space-y-2">
            <p id="receipt-format-label" className="text-sm font-medium">Impressora</p>
            <div role="radiogroup" aria-labelledby="receipt-format-label" className="grid gap-2 sm:grid-cols-3">
              {RECEIPT_FORMATS.map((value) => (
                <button key={value} type="button" role="radio" aria-checked={format === value}
                  onClick={() => setValue("receiptFormat", value, { shouldDirty: true })}
                  className={cn(
                    "rounded-md border p-3 text-left transition-colors",
                    format === value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
                  )}>
                  <span className="block text-sm font-medium">{RECEIPT_FORMAT_LABELS[value]}</span>
                  <span className="block text-xs text-muted-foreground">{FORMAT_HINTS[value]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="receipt-footer" className="text-sm font-medium">Rodapé do recibo</label>
            <textarea id="receipt-footer" {...register("receiptFooter")} rows={3}
              maxLength={RECEIPT_FOOTER_MAX_LENGTH}
              placeholder="Ex.: Trocas em até 30 dias, com este recibo e a etiqueta no produto."
              aria-invalid={Boolean(footerError)}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
            {footerError ? <p className="text-xs text-destructive">{footerError}</p> : (
              <p className="text-xs text-muted-foreground">Aparece no fim de todo recibo. Deixe vazio para não imprimir.</p>
            )}
          </div>

          <div className="flex justify-end">
            <Can permission="settings:update" mode="disable">
              <Button type="submit" disabled={formState.isSubmitting || updateTenant.isPending}>
                {updateTenant.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar
              </Button>
            </Can>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
