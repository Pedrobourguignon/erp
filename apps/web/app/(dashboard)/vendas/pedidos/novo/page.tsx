"use client";

import type { PaginatedResponse, SaleCandidate } from "@erp/shared-types";
import {
  calculateItemTotal,
  calculateOrderTotals,
  maxItemDiscount,
} from "@erp/validators";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  Save,
  Loader2,
  Trash2,
  ShoppingCart,
  AlertTriangle,
  CheckCircle2,
  Minus,
  Plus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState, useCallback, useEffect, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";

import { NewCustomerButton } from "@/components/forms/customer-quick-create-dialog";
import { MoneyInput } from "@/components/forms/money-input";
import { PaymentSelector } from "@/components/forms/payment-selector";
import {
  SearchableSelect,
  SearchableSelectBase,
  type SelectOption,
} from "@/components/forms/searchable-select";
import { ScanNoticeBar } from "@/components/sales/scan-notice";
import { VariantPickerDialog } from "@/components/sales/variant-picker-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { TruncatedText } from "@/components/ui/truncated-text";
import { useCartScanner } from "@/hooks/use-cart-scanner";
import { useCashRegisterSessions } from "@/hooks/use-cash-registers";
import { useInvalidSubmit } from "@/hooks/use-invalid-submit";
import { useCreateOrder } from "@/hooks/use-orders";
import api, { getApiErrorMessage } from "@/lib/api";
import { placeInCart, splitVariantName } from "@/lib/counter-cart";
import { scheduleScrollToFirstError } from "@/lib/form-errors";
import { settlePayments } from "@/lib/payment-settlement";
import {
  fetchAvailableStock,
  refreshCartStock,
} from "@/lib/stock-snapshot";
import { formatCurrency, cn } from "@/lib/utils";




// ─── Types ─────────────────────────────────────────────────────────────

interface CustomerOption {
  id: string;
  name: string;
  document: string | null;
  email: string | null;
}

interface ProductResult {
  id: string;
  name: string;
  sku: string;
  ean?: string | null;
  salePrice: number;
  _count?: { variants?: number };
  inventory?: {
    totalQuantity: number;
    totalReserved: number;
    totalAvailable: number;
  };
}

// ─── Validation schema ─────────────────────────────────────────────────

const coerceNumber = (val: unknown) => {
  if (val === "" || val === null || val === undefined) {
    return 0;
  }
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
};

/**
 * Quantos produtos a lista traz de uma vez — o mesmo do seletor de clientes
 * (`lib/entity-search.ts`). A lista existe para navegar, não só para confirmar
 * um nome que já se sabe de cor.
 */
const PRODUCT_PAGE_SIZE = 20;

const orderItemSchema = z
  .object({
    productId: z.string().min(1, "Selecione um produto"),
    // A variação (tamanho/cor): o estoque reservado é o dela, não o do produto.
    variantId: z.string().nullable().optional(),
    productName: z.string(),
    sku: z.string(),
    availableStock: z.number(),
    quantity: z.preprocess(
      coerceNumber,
      z
        .number()
        .int("A quantidade deve ser um número inteiro")
        .min(1, "A quantidade mínima é 1")
    ),
    unitPrice: z.preprocess(
      coerceNumber,
      z.number().min(0.01, "Informe o preço unitário")
    ),
    discount: z.preprocess(
      coerceNumber,
      z.number().min(0, "O desconto não pode ser negativo").default(0)
    ),
  })
  .superRefine((item, ctx) => {
    // VD-10: a discount above the line made the cart show a negative subtotal
    // and the API then refused the order for disagreeing with it.
    const max = maxItemDiscount({
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
    });
    if (Number(item.discount) > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discount"],
        message: `O desconto não pode passar de ${formatCurrency(max)}`,
      });
    }
  });

const orderPaymentSchema = z
  .object({
    paymentMethodId: z.string().min(1, "Selecione a forma de pagamento"),
    financialAccountId: z.string().optional(),
    amount: z.preprocess(coerceNumber, z.number().min(0.01, "Valor obrigatório")),
    installments: z.number().optional(),
    // Set by PaymentLine from the selected method: the schema has no access to
    // the method list. Cash is the only kind that accepts change (VD-08).
    methodType: z.string().optional(),
  });

/** Totals of the cart, with the API's own arithmetic. */
function newOrderTotals(data: {
  items: { quantity: unknown; unitPrice: unknown; discount?: unknown }[];
  shippingCost?: unknown;
}) {
  return calculateOrderTotals({
    items: data.items.map((item) => ({
      quantity: coerceNumber(item.quantity) as number,
      unitPrice: coerceNumber(item.unitPrice) as number,
      discount: coerceNumber(item.discount) as number,
    })),
    shippingCost: coerceNumber(data.shippingCost) as number,
  });
}

/** How much of each payment is charged to the order, and how much is change. */
function newOrderSettlement(data: {
  items: { quantity: unknown; unitPrice: unknown; discount?: unknown }[];
  shippingCost?: unknown;
  payments: { amount: unknown; methodType?: string }[];
}) {
  return settlePayments(
    data.payments.map((p) => ({
      amount: coerceNumber(p.amount) as number,
      isCash: p.methodType === "CASH",
    })),
    newOrderTotals(data).total
  );
}

const newOrderSchema = z
  .object({
    customerId: z.string().min(1, "Selecione um cliente"),
    items: z.array(orderItemSchema).min(1, "Adicione pelo menos um item"),
    payments: z
      .array(orderPaymentSchema)
      .min(1, "Adicione pelo menos uma forma de pagamento"),
    shippingMethod: z.string().max(100).optional(),
    shippingCost: z.preprocess(coerceNumber, z.number().min(0).default(0)),
    notes: z.string().max(2000).optional(),
  })
  .refine((data) => newOrderSettlement(data).isSettled, {
    message:
      "Os pagamentos devem cobrir o total do pedido (somente dinheiro aceita valor acima).",
    path: ["payments"],
  });

type NewOrderFormValues = z.infer<typeof newOrderSchema>;

// ─── Stock badge ───────────────────────────────────────────────────────

function StockIndicator({ available }: { available: number }) {
  if (available <= 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
        <AlertTriangle className="h-3 w-3" />
        Sem estoque
      </span>
    );
  }
  if (available <= 5) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3" />
        {available} un.
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
      <CheckCircle2 className="h-3 w-3" />
      {available} un.
    </span>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────

export default function NewOrderPage() {
  const router = useRouter();
  const createOrder = useCreateOrder();
  const { addToast } = useToast();
  const formRef = React.useRef<HTMLFormElement>(null);

  /**
   * FN-13: sem isto, "Criar Pedido" com um campo recusado pelo zod não
   * emitia requisição nem mensagem — a tela ficava parada e o usuário
   * concluía que o botão estava quebrado.
   */
  const onInvalid = useInvalidSubmit(() => {
    scheduleScrollToFirstError(() => formRef.current);
  });

  // A sale by order can only be registered while a cash register is open
  const { data: openSessions } = useCashRegisterSessions({ status: "OPEN", limit: 1 });
  const hasOpenCashRegister = (openSessions?.data?.length ?? 0) > 0;

  // An immediate payment without a linked account is refused by the API (SCRUM-30)
  const [hasMissingAccount, setHasMissingAccount] = useState(false);
  // Cliente cadastrado agora, na própria tela: ainda não veio da busca.
  const [createdCustomer, setCreatedCustomer] = useState<SelectOption | null>(null);

  // Product search state
  /**
   * Os produtos já vistos pelo seletor, por id.
   *
   * A opção do dropdown carrega só rótulo e descrição; somar o item ao pedido
   * precisa do preço e do saldo. Guardar o que a API acabou de devolver evita
   * uma segunda requisição para o mesmo dado.
   */
  const productsById = React.useRef(new Map<string, ProductResult>());

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<NewOrderFormValues>({
    resolver: zodResolver(newOrderSchema),
    defaultValues: {
      customerId: "",
      items: [],
      payments: [],
      shippingMethod: "",
      shippingCost: 0,
      notes: "",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const items = watch("items");
  const shippingCost = watch("shippingCost");

  // ─── Computed totals ───────────────────────────────────────────────

  // VD-10: the same functions the API uses, so the screen can never show a
  // total the backend will refuse.
  const calcItemTotal = (item: NewOrderFormValues["items"][number]) =>
    calculateItemTotal({
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      discount: Number(item.discount) || 0,
    });

  const { subtotal, total } = calculateOrderTotals({
    items: items.map((item) => ({
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      discount: Number(item.discount) || 0,
    })),
    shippingCost: Number(shippingCost) || 0,
  });

  // ─── Customer loader ──────────────────────────────────────────────

  const loadCustomers = useCallback(async (search: string) => {
    const { data } = await api.get<PaginatedResponse<CustomerOption>>(
      "/customers",
      { params: { search, limit: 20 } }
    );
    return (data.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      description: c.document ?? undefined,
    }));
  }, []);

  // ─── Product picker ───────────────────────────────────────────────

  /**
   * Carrega os produtos do seletor — sem texto, os primeiros disponíveis.
   *
   * O `SearchableSelectBase` chama isto ao abrir e a cada 300ms de digitação,
   * que é exatamente o comportamento do seletor de clientes logo acima.
   *
   * O que a API devolve é guardado inteiro num mapa: a opção só carrega
   * rótulo e descrição, e para somar o item ao pedido são precisos o preço e o
   * saldo. Buscar o produto de novo pelo id seria uma segunda ida ao servidor
   * para um dado que acabou de chegar.
   */
  const loadProducts = useCallback(async (query: string) => {
    const { data } = await api.get<PaginatedResponse<ProductResult>>(
      "/products",
      {
        params: {
          // Sem texto, a busca não é enviada: `search=""` seria uma comparação
          // contra vazio em vez de "traga os primeiros".
          search: query.trim() || undefined,
          limit: PRODUCT_PAGE_SIZE,
          status: "ACTIVE",
        },
      }
    );

    const produtos = data.data ?? [];
    produtos.forEach((produto) => productsById.current.set(produto.id, produto));

    return produtos.map((produto) => {
      const disponivel = produto.inventory?.totalAvailable ?? 0;
      return {
        value: produto.id,
        label: produto.name,
        // O saldo entra aqui porque é o que decide a escolha: sem ele, vender
        // um item sem estoque só é descoberto ao tentar salvar.
        description: `${produto.sku} · ${formatCurrency(Number(produto.salePrice))} · ${
          disponivel > 0 ? `${disponivel} un.` : "sem estoque"
        }`,
      };
    });
  }, []);

  // ─── Add / update product ─────────────────────────────────────────

  /** Linha que acabou de entrar ou somar: pisca para o operador ver onde foi. */
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (flashTimer.current) {clearTimeout(flashTimer.current);}
  }, []);

  const addCandidate = useCallback(
    (candidate: SaleCandidate) => {
      // O mesmo produto (e variação) soma quantidade; outro tamanho é outra linha.
      const placement = placeInCart(items, candidate);
      if (placement.kind === "increment") {
        setValue(`items.${placement.index}.quantity`, placement.quantity);
      } else {
        append(placement.line);
      }
      setLastAdded(`${candidate.productId}:${candidate.variantId ?? ""}`);
      if (flashTimer.current) {clearTimeout(flashTimer.current);}
      flashTimer.current = setTimeout(() => setLastAdded(null), 1200);
    },
    [items, append, setValue]
  );

  // Leitor de código de barras: lê em qualquer campo da tela, pela busca exata.
  const scanner = useCartScanner({ onCandidate: addCandidate });

  /**
   * O que o seletor devolve é um id; o pedido precisa do produto.
   *
   * Escolher aqui não guarda seleção nenhuma — some para "Itens do Pedido" e o
   * campo volta ao estado inicial, pronto para o próximo item.
   */
  const handlePickProduct = useCallback(
    (productId: string) => {
      const product = productsById.current.get(productId);
      if (!product) {return;}
      // Produto com variações pergunta o tamanho/cor antes de entrar.
      if ((product._count?.variants ?? 0) > 0) {
        void scanner.pickProduct(product.id);
        return;
      }
      addCandidate({
        productId: product.id,
        variantId: null,
        name: product.name,
        sku: product.sku,
        ean: product.ean ?? null,
        salePrice: Number(product.salePrice),
        available: product.inventory?.totalAvailable ?? 0,
      });
    },
    [addCandidate, scanner]
  );

  // ─── Submit ───────────────────────────────────────────────────────

  const onSubmit = async (data: NewOrderFormValues) => {
    if (!hasOpenCashRegister) {
      addToast("Abra o caixa para registrar a venda por pedido.", "error");
      return;
    }
    // VD-21: the availableStock in the cart is a snapshot from the product
    // search. Confirm it against the server before creating the order.
    const stock = await refreshCartStock(
      data.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: Number(item.quantity) || 0,
        productName: item.productName,
      }))
    );
    stock.available.forEach((available, index) => {
      if (available !== null) {
        setValue(`items.${index}.availableStock`, available);
      }
    });
    if (stock.insufficient.length > 0) {
      const [first] = stock.insufficient;
      addToast(
        `Estoque insuficiente de ${first.productName}: ${first.available} un. disponíveis para ${first.quantity} solicitadas.`,
        "error"
      );
      return;
    }

    const settlement = newOrderSettlement(data);
    try {
      const result = await createOrder.mutateAsync({
        customerId: data.customerId,
        origin: "MANUAL",
        items: data.items.map((item) => ({
          productId: item.productId,
          variantId: item.variantId || undefined,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
        })),
        // VD-08: send what is charged to the order, not what was handed over —
        // the change is not revenue and must not become a receivable.
        payments: data.payments.map((p, index) => ({
          paymentMethodId: p.paymentMethodId,
          financialAccountId: p.financialAccountId || undefined,
          amount: settlement.applied[index],
          installments: p.installments || undefined,
        })),
        shippingMethod: data.shippingMethod || undefined,
        shippingCost: data.shippingCost,
        notes: data.notes || undefined,
      });
      addToast(
        settlement.change > 0
          ? `Pedido criado. Troco: ${formatCurrency(settlement.change)}`
          : "Pedido criado com sucesso!",
        "success"
      );
      router.push(`/vendas/pedidos/${result.data.id}`);
    } catch (err) {
      addToast(
        getApiErrorMessage(err) ?? "Erro ao criar pedido. Tente novamente.",
        "error"
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Tooltip content="Voltar">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Tooltip>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nova Venda</h1>
          <p className="text-muted-foreground">
            Crie um novo pedido de venda manual
          </p>
        </div>
      </div>

      <form ref={formRef} onSubmit={handleSubmit((data) => onSubmit(data), onInvalid)}
        noValidate
      >
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main content */}
          <div className="space-y-6 lg:col-span-2">
            {/* Customer */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg">Cliente</CardTitle>
                <NewCustomerButton
                  onCreated={(customer) => {
                    setCreatedCustomer(customer);
                    setValue("customerId", customer.value, {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                  }}
                />
              </CardHeader>
              <CardContent>
                <SearchableSelect
                  name="customerId"
                  control={control}
                  loadOptions={loadCustomers}
                  placeholder="Buscar cliente por nome ou documento..."
                  selectedOption={createdCustomer}
                  error={errors.customerId?.message}
                />
              </CardContent>
            </Card>

            {/* Product picker */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Adicionar Produtos</CardTitle>
              </CardHeader>
              <CardContent>
                {/*
                  O mesmo seletor do cliente, logo acima: abre já com os
                  primeiros produtos listados e filtra conforme se digita.
                  Antes era uma busca própria que só mostrava algo depois de
                  digitar, e cujos resultados abriam uma tabela dentro do
                  formulário — dois comportamentos para o mesmo gesto, e o
                  carrinho empurrado para fora da tela.
                */}
                <SearchableSelectBase
                  // Nunca guarda seleção: escolher aqui é uma ação (somar um
                  // item ao pedido), não um valor do formulário. O que foi
                  // escolhido aparece em "Itens do Pedido", não no campo.
                  value=""
                  onChange={handlePickProduct}
                  loadOptions={loadProducts}
                  placeholder="Buscar produto por nome, SKU ou código de barras..."
                  emptyMessage="Nenhum produto encontrado"
                />
                <div className="mt-2">
                  <ScanNoticeBar notice={scanner.notice} onDismiss={scanner.dismissNotice} />
                </div>
              </CardContent>
            </Card>

            {/* Order items */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Itens do Pedido
                  {fields.length > 0 && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({fields.length} {fields.length === 1 ? "item" : "itens"})
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fields.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
                    <ShoppingCart className="mb-3 h-10 w-10 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      Nenhum item adicionado
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Use a busca acima para encontrar e adicionar produtos
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/50">
                        <tr>
                          <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                            Produto
                          </th>
                          <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">
                            Estoque
                          </th>
                          <th className="w-32 px-4 py-2.5 text-center font-medium text-muted-foreground">
                            Qtd
                          </th>
                          <th className="w-36 px-4 py-2.5 text-right font-medium text-muted-foreground">
                            Preço Unit.
                          </th>
                          <th className="w-36 px-4 py-2.5 text-right font-medium text-muted-foreground">
                            Desconto
                          </th>
                          <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                            Total
                          </th>
                          <th className="w-10 px-2 py-2.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((field, index) => {
                          const item = items[index];
                          const qty = Number(item?.quantity) || 0;
                          const stock = Number(item?.availableStock) || 0;
                          const itemTotal = item ? calcItemTotal(item) : 0;
                          // VD-20: the old `&& stock > 0` silenced the warning
                          // for products with zero stock — exactly the case
                          // that needs it. Same rule as the PDV.
                          const overStock = qty > stock;
                          const itemErrors = errors.items?.[index];
                          // VD-21: the field is registered here so its
                          // onBlur can also refresh the stock snapshot below.
                          const quantityField = register(
                            `items.${index}.quantity`,
                            { valueAsNumber: true }
                          );

                          return (
                            <tr
                              key={field.id}
                              className={cn(
                                "border-b transition-colors duration-700 last:border-0",
                                overStock && "bg-amber-50 dark:bg-amber-950/20",
                                lastAdded === `${item?.productId}:${item?.variantId ?? ""}` &&
                                  "bg-emerald-50 dark:bg-emerald-950/30"
                              )}
                            >
                              {/* Product */}
                              <td className="px-4 py-3">
                                <TruncatedText
                                  as="p"
                                  text={splitVariantName(item?.productName ?? "").base}
                                  className="max-w-[24ch] font-medium"
                                />
                                {item?.variantId && splitVariantName(item.productName).variant ? (
                                  <span className="mt-0.5 inline-block max-w-full break-all rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">
                                    {splitVariantName(item.productName).variant}
                                  </span>
                                ) : null}
                                <TruncatedText
                                  as="p"
                                  text={item?.sku}
                                  className="max-w-[24ch] text-xs text-muted-foreground"
                                />
                              </td>

                              {/* Stock */}
                              <td className="px-4 py-3 text-center">
                                <StockIndicator available={stock} />
                              </td>

                              {/* Quantity */}
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-7 w-7"
                                    disabled={qty <= 1}
                                    onClick={() =>
                                      setValue(
                                        `items.${index}.quantity`,
                                        qty - 1
                                      )
                                    }
                                  >
                                    <Minus className="h-3 w-3" />
                                  </Button>
                                  <Input
                                    type="number"
                                    min={1}
                                    {...quantityField}
                                    onBlur={async (event) => {
                                      await quantityField.onBlur(event);
                                      const fresh = await fetchAvailableStock(
                                        item.productId,
                                        item.variantId
                                      );
                                      if (fresh !== null) {
                                        setValue(
                                          `items.${index}.availableStock`,
                                          fresh
                                        );
                                      }
                                    }}
                                    className={cn(
                                      "h-7 w-14 text-center text-sm",
                                      overStock &&
                                        "border-amber-500 text-amber-700"
                                    )}
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() =>
                                      setValue(
                                        `items.${index}.quantity`,
                                        qty + 1
                                      )
                                    }
                                  >
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                </div>
                                {/* VD-12: quantity 0 or negative used to block
                                    the submit with no message at all. */}
                                {itemErrors?.quantity ? <p className="mt-1 text-center text-[10px] text-destructive">
                                    {itemErrors.quantity.message}
                                  </p> : null}
                                {overStock && !itemErrors?.quantity ? <p className="mt-1 text-center text-[10px] text-amber-600">
                                    Excede estoque
                                  </p> : null}
                              </td>

                              {/* Unit price */}
                              <td className="px-4 py-3">
                                <MoneyInput
                                  name={`items.${index}.unitPrice`}
                                  control={control}
                                />
                              </td>

                              {/* Discount */}
                              <td className="px-4 py-3">
                                <MoneyInput
                                  name={`items.${index}.discount`}
                                  control={control}
                                />
                                {itemErrors?.discount ? <p className="mt-1 text-[10px] text-destructive">
                                    {itemErrors.discount.message}
                                  </p> : null}
                              </td>

                              {/* Total */}
                              <td className="px-4 py-3 text-right font-semibold">
                                {formatCurrency(itemTotal)}
                              </td>

                              {/* Remove */}
                              <td className="px-2 py-3">
                                <Tooltip content="Remover item">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    action="delete"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground"
                                    onClick={() => remove(index)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </Tooltip>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted/30">
                          <td
                            colSpan={5}
                            className="px-4 py-3 text-right font-semibold"
                          >
                            Subtotal
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">
                            {formatCurrency(subtotal)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {errors.items?.message ? <p className="mt-2 text-xs text-destructive">
                    {errors.items.message}
                  </p> : null}
              </CardContent>
            </Card>

            {/* Payment */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pagamento</CardTitle>
              </CardHeader>
              <CardContent>
                <PaymentSelector
                  control={control as never}
                  setValue={setValue as never}
                  totalAmount={total}
                  errors={errors.payments as never}
                  onMissingAccountChange={setHasMissingAccount}
                />
              </CardContent>
            </Card>

            {/* Shipping & Notes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Envio e Observações</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">
                      Método de Envio
                    </label>
                    <Input
                      {...register("shippingMethod")}
                      placeholder="Ex: Sedex, PAC, Transportadora..."
                      maxLength={100}
                    />
                  </div>
                  <MoneyInput
                    name="shippingCost"
                    control={control}
                    label="Custo do Frete"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Observações</label>
                  <textarea
                    {...register("notes")}
                    rows={3}
                    maxLength={2000}
                    placeholder="Observações internas sobre o pedido..."
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - Summary */}
          <div className="space-y-6">
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle className="text-lg">Resumo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Subtotal ({items.length}{" "}
                      {items.length === 1 ? "item" : "itens"})
                    </span>
                    <span>{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Frete</span>
                    <span>{formatCurrency(shippingCost ?? 0)}</span>
                  </div>
                  <div className="border-t pt-2">
                    <div className="flex items-center justify-between font-semibold">
                      <span>Total</span>
                      <span className="text-lg">{formatCurrency(total)}</span>
                    </div>
                  </div>
                </div>

                {/* Cash register closed warning */}
                {!hasOpenCashRegister && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Nenhum caixa aberto. Abra o caixa em Financeiro &gt; Caixa
                        para registrar a venda por pedido.
                      </p>
                    </div>
                  </div>
                )}

                {/* Payment method without a linked account (SCRUM-30) */}
                {hasMissingAccount ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Uma forma de pagamento à vista não tem conta financeira
                        vinculada. Vincule a conta em Configurações &gt; Métodos de
                        Pagamento para registrar a venda.
                      </p>
                    </div>
                  </div> : null}

                {/* Stock warnings */}
                {items.some(
                  (i) =>
                    i.quantity > i.availableStock && i.availableStock > 0
                ) && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Alguns itens excedem o estoque disponivel. O pedido sera
                        criado, mas podera nao ser confirmado ate a
                        regularizacao do estoque.
                      </p>
                    </div>
                  </div>
                )}

                {items.some((i) => i.availableStock <= 0) && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      <p className="text-xs text-red-700 dark:text-red-400">
                        Ha itens sem estoque disponivel no pedido.
                      </p>
                    </div>
                  </div>
                )}

                <div className="space-y-2 border-t pt-4">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={
                      createOrder.isPending ||
                      !hasOpenCashRegister ||
                      hasMissingAccount
                    }
                  >
                    {createOrder.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Criar Pedido
                  </Button>
                  <Button
                    type="button"
                    variant="cancel"
                    className="w-full"
                    onClick={() => router.back()}
                  >
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
      <VariantPickerDialog
        picker={scanner.picker}
        onPick={scanner.pickVariant}
        onClose={scanner.closePicker}
      />
    </div>
  );
}
