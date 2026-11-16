"use client";

import { UserPlus } from "lucide-react";
import React, { useState } from "react";

import { CustomerForm } from "@/components/forms/customer-form";
import type { SelectOption } from "@/components/forms/searchable-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useCreateCustomer, type CustomerFormData } from "@/hooks/use-customers";
import { maskDocument } from "@/lib/masks";
import { getMutationErrorMessage } from "@/lib/mutation-error";

interface CustomerQuickCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Recebe o cliente já como opção do seletor, pronto para ser escolhido. */
  onCreated: (customer: SelectOption) => void;
}

/**
 * Cadastro de cliente sem sair da venda.
 *
 * O balcão e o pedido pedem um cliente, e quem chega à loja nem sempre está
 * cadastrado: mandar o operador para /clientes/novo faria perder o carrinho.
 * É o mesmo `CustomerForm` da tela de clientes — uma só regra de validação.
 *
 * O diálogo vai para um portal, mas os eventos do React sobem pela árvore de
 * componentes: o `CustomerForm embedded` interrompe o submit antes de ele
 * alcançar o `<form>` da venda onde este botão está.
 */
export function CustomerQuickCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: CustomerQuickCreateDialogProps) {
  const createCustomer = useCreateCustomer();
  const { addToast } = useToast();

  const handleSubmit = async (values: CustomerFormData) => {
    try {
      const { data: customer } = await createCustomer.mutateAsync(values);
      addToast("Cliente cadastrado com sucesso!", "success");
      onCreated({
        value: customer.id,
        label: customer.name,
        description: customer.document
          ? maskDocument(customer.document, customer.documentType ?? "CPF")
          : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      addToast(
        getMutationErrorMessage(err, "Erro ao cadastrar o cliente. Tente novamente."),
        "error"
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Novo cliente</DialogTitle>
          <DialogDescription>
            Cadastre o cliente e ele já fica selecionado nesta venda.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <CustomerForm
            mode="create"
            embedded
            isSaving={createCustomer.isPending}
            onSubmit={handleSubmit}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface NewCustomerButtonProps {
  /** O cliente criado, como opção do seletor — a tela o escolhe no campo. */
  onCreated: (customer: SelectOption) => void;
}

/** "Novo cliente" ao lado do campo de cliente: botão + modal de cadastro. */
export function NewCustomerButton({ onCreated }: NewCustomerButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <UserPlus className="mr-2 h-4 w-4" />
        Novo cliente
      </Button>
      <CustomerQuickCreateDialog open={open} onOpenChange={setOpen} onCreated={onCreated} />
    </>
  );
}
