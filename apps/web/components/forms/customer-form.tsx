"use client";

import { documentErrorMessage, isValidDocument } from "@erp/validators";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CustomerFormData } from "@/hooks/use-customers";
import { useInvalidSubmit } from "@/hooks/use-invalid-submit";
import { maskDocument, maskPhone } from "@/lib/masks";
import { cn, todayDateKey } from "@/lib/utils";

// ─── Schema ─────────────────────────────────────────────────────────────

const customerSchema = z.object({
  documentType: z.enum(["CPF", "CNPJ"]),
  name: z
    .string()
    .min(3, "Nome deve ter pelo menos 3 caracteres")
    .max(255, "Nome muito longo"),
  // AE-04: counting digits accepted `111.111.111-11`. The real validation is
  // the check digit, and it comes from @erp/validators — the same one the API
  // uses.
  // CPF/CNPJ é opcional (cliente de balcão); quando vem, tem que ser válido.
  document: z.string().max(18, "Documento muito longo"),
  email: z
    .string()
    .max(255, "E-mail muito longo")
    .refine((value) => value === "" || z.string().email().safeParse(value).success, {
      message: "E-mail inválido",
    }),
  // `YYYY-MM-DD` do <input type="date">; vazio = não informada.
  birthDate: z.string().refine((value) => value === "" || value >= "1900-01-01", {
    message: "Informe uma data de nascimento a partir de 1900",
  }).refine((value) => value === "" || value <= todayDateKey(), {
    message: "A data de nascimento não pode ser no futuro",
  }),
  phone: z
    .string()
    .min(1, "Telefone é obrigatório")
    .max(20, "Telefone muito longo")
    .refine(
      (val) => {
        const digits = val.replace(/\D/g, "");
        return digits.length >= 10 && digits.length <= 11;
      },
      { message: "Telefone inválido" }
    ),
});

const customerSchemaWithDocument = customerSchema.superRefine((data, ctx) => {
  if (data.document !== "" && !isValidDocument(data.document, data.documentType)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["document"],
      message: documentErrorMessage(data.documentType),
    });
  }
});

export type CustomerFormValues = z.infer<typeof customerSchema>;

// ─── Component ──────────────────────────────────────────────────────────

interface CustomerFormProps {
  mode: "create" | "edit";
  defaultValues?: Partial<CustomerFormValues>;
  isSaving?: boolean;
  /**
   * Dentro de um modal: sem o cartão em volta e sem a linha do rodapé — o
   * diálogo já é a moldura.
   */
  embedded?: boolean;
  onSubmit: (values: CustomerFormData) => Promise<void>;
  onCancel: () => void;
}

/** Cartão na página; sem moldura própria dentro de um modal. */
function FormShell({
  embedded,
  children,
}: {
  embedded: boolean;
  children: React.ReactNode;
}) {
  if (embedded) {
    return <div className="space-y-4">{children}</div>;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Dados do Cliente</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

/**
 * AE-06: the customer CRUD had no "U".
 *
 * The detail page imported the `Edit` icon and never used it, `/clientes/[id]/edit`
 * was a 404, and `PATCH /customers/:id` had been there the whole time. This is
 * the create form extracted so both routes share one schema — a second copy is
 * how the edit path became a second open door for invalid documents (AE-08).
 */
export function CustomerForm({
  mode,
  defaultValues,
  isSaving,
  embedded = false,
  onSubmit,
  onCancel,
}: CustomerFormProps) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchemaWithDocument),
    defaultValues: {
      documentType: "CPF",
      name: "",
      document: "",
      email: "",
      phone: "",
      birthDate: "",
      ...defaultValues,
    },
  });
  const onInvalid = useInvalidSubmit();

  const documentType = watch("documentType");

  const submit = handleSubmit(
    (values) =>
      onSubmit({
        ...values,
        // Campo em branco é "sem valor", não uma string vazia: a API recusa ""
        // como e-mail, e `null` é o que apaga na edição.
        document: values.document || null,
        documentType: values.document ? values.documentType : null,
        email: values.email || null,
        birthDate: values.birthDate || null,
      }),
    onInvalid,
  );

  const fieldError = (field: keyof CustomerFormValues) =>
    errors[field]?.message as string | undefined;

  return (
    <form
      onSubmit={(event) => {
        // Num modal, o submit não pode subir (pela árvore do React, que atravessa
        // o portal) até o formulário da venda que está por baixo.
        if (embedded) {
          event.stopPropagation();
        }
        return submit(event);
      }}
      className="space-y-6"
      noValidate
    >
      <FormShell embedded={embedded}>
          <div className="flex gap-2">
            {(["CPF", "CNPJ"] as const).map((type) => (
              <label
                key={type}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
                  documentType === type
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                )}
              >
                <input
                  type="radio"
                  value={type}
                  {...register("documentType")}
                  className="sr-only"
                />
                {type === "CPF" ? "Pessoa Física" : "Pessoa Jurídica"}
              </label>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Nome *</label>
              <Input
                {...register("name")}
                placeholder={documentType === "CNPJ" ? "Razão Social" : "Nome completo"}
                maxLength={255}
              />
              {fieldError("name") ? (
                <p className="text-xs text-destructive">{fieldError("name")}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">
                {documentType === "CPF" ? "CPF" : "CNPJ"}
              </label>
              <Input
                {...register("document")}
                onChange={(e) =>
                  setValue("document", maskDocument(e.target.value, documentType), {
                    shouldValidate: true,
                  })
                }
                placeholder={
                  documentType === "CPF" ? "000.000.000-00" : "00.000.000/0000-00"
                }
                maxLength={documentType === "CPF" ? 14 : 18}
              />
              {fieldError("document") ? (
                <p className="text-xs text-destructive">{fieldError("document")}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">E-mail</label>
              <Input
                {...register("email")}
                type="email"
                placeholder="email@exemplo.com"
                maxLength={255}
              />
              {fieldError("email") ? (
                <p className="text-xs text-destructive">{fieldError("email")}</p>
              ) : null}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Telefone *</label>
              <Input
                {...register("phone")}
                onChange={(e) =>
                  setValue("phone", maskPhone(e.target.value), { shouldValidate: true })
                }
                placeholder="(00) 00000-0000"
                maxLength={15}
              />
              {fieldError("phone") ? (
                <p className="text-xs text-destructive">{fieldError("phone")}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1 sm:max-w-[calc(50%-0.5rem)]">
            <label className="text-sm font-medium" htmlFor="customer-birth-date">
              Data de nascimento
            </label>
            <Input
              id="customer-birth-date"
              type="date"
              min="1900-01-01"
              max={todayDateKey()}
              {...register("birthDate")}
            />
            {fieldError("birthDate") ? (
              <p className="text-xs text-destructive">{fieldError("birthDate")}</p>
            ) : null}
          </div>
      </FormShell>

      <div
        className={cn(
          "flex items-center justify-end gap-3",
          !embedded && "border-t pt-6"
        )}
      >
        <Button type="button" variant="cancel" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting || isSaving}>
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {mode === "create" ? "Salvar Cliente" : "Salvar Alterações"}
        </Button>
      </div>
    </form>
  );
}
