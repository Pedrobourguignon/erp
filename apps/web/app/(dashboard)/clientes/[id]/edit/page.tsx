"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import React from "react";

import { PermissionDeniedState } from "@/components/auth/permission-denied-state";
import { RequirePermission } from "@/components/auth/require-permission";
import { CustomerForm } from "@/components/forms/customer-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import {
  useCustomer,
  useUpdateCustomer,
  type CustomerFormData,
} from "@/hooks/use-customers";
import { isPermissionError } from "@/lib/api-errors";
import { maskDocument, maskPhone } from "@/lib/masks";
import { getMutationErrorMessage } from "@/lib/mutation-error";

/**
 * AE-06: the route that did not exist.
 *
 * The detail page had only "Excluir"; a customer with a typo in the document
 * could be deleted and retyped, but never corrected.
 */
function EditCustomerPageContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const { addToast } = useToast();

  const { data: customerResp, isLoading, isError, error } = useCustomer(customerId);
  const customer = customerResp?.data;
  const updateCustomer = useUpdateCustomer();

  const handleSubmit = async (values: CustomerFormData) => {
    try {
      await updateCustomer.mutateAsync({ id: customerId, ...values });
      addToast("Cliente atualizado com sucesso!", "success");
      router.push(`/clientes/${customerId}`);
    } catch (err) {
      addToast(
        getMutationErrorMessage(err, "Erro ao atualizar o cliente."),
        "error"
      );
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando o cliente...
        </CardContent>
      </Card>
    );
  }

  // AE-28: a failed request is not an empty form.
  if (isError || !customer) {
    return isPermissionError(error) ? (
      <PermissionDeniedState subject="este cliente" showHomeLink />
    ) : (
      <Card>
        <CardContent className="py-10 text-sm text-destructive">
          {getMutationErrorMessage(error, "Não foi possível carregar o cliente.")}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Tooltip content="Voltar">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Tooltip>
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-bold tracking-tight">Editar Cliente</h1>
          <p className="truncate text-muted-foreground">{customer.name}</p>
        </div>
      </div>

      <CustomerForm
        mode="edit"
        isSaving={updateCustomer.isPending}
        defaultValues={{
          documentType: customer.documentType ?? "CPF",
          name: customer.name ?? "",
          // The API stores digits only (AE-15); the mask is display.
          document: maskDocument(
            customer.document ?? "",
            customer.documentType ?? "CPF"
          ),
          email: customer.email ?? "",
          phone: maskPhone(customer.phone ?? ""),
          // Data civil: o dia vem à frente do "T" — sem conversão de fuso.
          birthDate: customer.birthDate ? customer.birthDate.slice(0, 10) : "",
        }}
        onSubmit={handleSubmit}
        onCancel={() => router.back()}
      />
    </div>
  );
}

export default function EditCustomerPage() {
  return (
    <RequirePermission permission="customers:update" subject="a edição de clientes">
      <EditCustomerPageContent />
    </RequirePermission>
  );
}
