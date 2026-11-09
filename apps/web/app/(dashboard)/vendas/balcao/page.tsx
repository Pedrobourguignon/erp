"use client";

import type { PaginatedResponse } from "@erp/shared-types";
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
  AlertTriangle,
  CheckCircle2,
  ShoppingCart,
  Minus,
  Plus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useState, useCallback, useEffect, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";

import { MoneyInput } from "@/components/forms/money-input";
import { PaymentSelector } from "@/components/forms/payment-selector";
import {
  SearchableSelect,
  SearchableSelectBase,
} from "@/components/forms/searchable-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { TruncatedText } from "@/components/ui/truncated-text";
import { useCashRegisterSessions } from "@/hooks/use-cash-registers";
import { useInvalidSubmit } from "@/hooks/use-invalid-submit";
import { useCreateOrder } from "@/hooks/use-orders";
import api, { getApiErrorMessage } from "@/lib/api";
import { scheduleScrollToFirstError } from "@/lib/form-errors";
import { settlePayments } from "@/lib/payment-settlement";
import {
  fetchAvailableStock,
  refreshCartStock,
} from "@/lib/stock-snapshot";
import { formatCurrency, cn } from "@/lib/utils";



/**
 * Quantos produtos a lista traz de uma vez — o mesmo do seletor de clientes
 * (`lib/entity-search.ts`).
 */
const PRODUCT_PAGE_SIZE = 20;

// ─── Types ─────────────────────────────────────────────────────────────

interface CustomerOption {
  id: string;
  name: string;
  document: string;
  email: string;
}

interface ProductResult {
  id: string;
  name: string;
  sku: string;
  salePrice: number;
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

const counterSaleItemSchema = z
  .object({
    productId: z.string().min(1, "Selecione um produto"),
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
    // and the API then refused the sale for disagreeing with it.
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
    paymentConditionId: z.string().optional(),
    financialAccountId: z.string().optional(),
    amount: z.preprocess(coerceNumber, z.number().min(0.01, "Valor obrigatório")),
    installments: z.number().optional(),
    authorizationCode: z.string().optional(),
    // Both set by PaymentLine from the selected method: the schema has no
    // access to the method list. `requiresAuthorization` drives the rule below;
    // `methodType` tells cash apart, the only kind that accepts change (VD-08).
    requiresAuthorization: z.boolean().optional(),
    methodType: z.string().optional(),
  })
  .superRefine((payment, ctx) => {
    if (payment.requiresAuthorization && !payment.authorizationCode?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorizationCode"],
        message: "Código de autorização obrigatório",
      });
    }
  });

/** Item and order totals of the cart, with the API's own arithmetic. */
function counterSaleTotals(data: {
  items: { quantity: unknown; unitPrice: unknown; discount?: unknown }[];
  discount?: unknown;
}) {
  return calculateOrderTotals({
    items: data.items.map((item) => ({
      quantity: coerceNumber(item.quantity) as number,
      unitPrice: coerceNumber(item.unitPrice) as number,
      discount: coerceNumber(item.discount) as number,
    })),
    discount: coerceNumber(data.discount) as number,
  });
}

/** How much of each payment is charged to the sale, and how much is change. */
function counterSaleSettlement(data: {
  items: { quantity: unknown; unitPrice: unknown; discount?: unknown }[];
  discount?: unknown;
  payments: { amount: unknown; methodType?: string }[];
}) {
  return settlePayments(
    data.payments.map((p) => ({
      amount: coerceNumber(p.amount) as number,
      isCash: p.methodType === "CASH",
    })),
    counterSaleTotals(data).total
  );
}

const counterSaleSchema = z
  .object({
    customerId: z.string().min(1, "Selecione um cliente"),
    items: z.array(counterSaleItemSchema).min(1, "Adicione pelo menos um item"),
    payments: z
      .array(orderPaymentSchema)
      .min(1, "Adicione pelo menos uma forma de pagamento"),
    discount: z.preprocess(coerceNumber, z.number().min(0).default(0)),
    notes: z.string().max(1000).optional(),
  })
  .refine(
    (data) => (Number(data.discount) || 0) <= counterSaleTotals(data).subtotal,
    {
      message: "O desconto não pode ser maior que o total dos itens",
      path: ["discount"],
    }
  )
  .refine(
    // VD-08: cash above the total is change, not an error. The settlement says
    // whether the sale is covered; the excess never reaches the API.
    (data) => counterSaleSettlement(data).isSettled,
    {
      message:
        "Os pagamentos devem cobrir o total do pedido (somente dinheiro aceita valor acima).",
      path: ["payments"],
    }
  );

type CounterSaleFormValues = z.infer<typeof counterSaleSchema>;

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

export default function CounterSalePage() {
  const router = useRouter();
  const createOrder = useCreateOrder();
  const { addToast } = useToast();

  // A counter sale can only be finalized while a cash register is open.
  // VD-07/AE-28: a failed query is not the same as "no open register" — the
  // seller used to get a 403 here and read a warning telling them to open a
  // cash register they had, in a screen they cannot reach.
  const {
    data: openSessions,
    isLoading: sessionsLoading,
    error: sessionsError,
  } = useCashRegisterSessions({ status: "OPEN", limit: 20 });
  const sessionsUnavailable = !!sessionsError;
  const sessions = openSessions?.data ?? [];
  const hasOpenCashRegister = sessions.length > 0;
  // FN-05: com dois PDVs abertos a venda precisa dizer em qual foi feita.
  // Com um só, não faz sentido perguntar.
  const [sessionId, setSessionId] = useState<string>("");
  const needsSessionChoice = sessions.length > 1;
  const selectedSessionId = needsSessionChoice
    ? sessionId
    : sessions[0]?.id ?? "";
  const showNoCashRegisterWarning =
    !sessionsLoading && !sessionsUnavailable && !hasOpenCashRegister;
  /**
   * When the check itself failed we let the sale through: the API validates the
   * open session anyway and refuses with a real message. Blocking on a question
   * we could not ask is what left the seller staring at a dead button (VD-07).
   */
  const cashRegisterBlocksSale = !sessionsUnavailable && !hasOpenCashRegister;

  // An immediate payment without a linked account is refused by the API (SCRUM-30)
  const [hasMissingAccount, setHasMissingAccount] = useState(false);

  // Product search state
  /**
   * Os produtos já vistos pelo seletor, por id.
   *
   * A opção carrega só rótulo e descrição; somar o item ao pedido precisa do
   * preço e do saldo. Guardar o que a API acabou de devolver evita uma segunda
   * requisição para o mesmo dado.
   */
  const productsById = React.useRef(new Map<string, ProductResult>());

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CounterSaleFormValues>({
    resolver: zodResolver(counterSaleSchema),
    defaultValues: {
      customerId: "",
      items: [],
      payments: [],
      discount: 0,
      notes: "",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  const items = watch("items");
  const orderDiscount = watch("discount");

  // ─── Computed totals ───────────────────────────────────────────────

  // VD-10: the same functions the API uses, so the screen can never show a
  // total the backend will refuse.
  const calcItemTotal = (item: CounterSaleFormValues["items"][number]) =>
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
    discount: Number(orderDiscount) || 0,
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
      description: c.document,
    }));
  }, []);

  // ─── Product picker ───────────────────────────────────────────────

  /**
   * Carrega os produtos do seletor — sem texto, os primeiros disponíveis.
   *
   * O `SearchableSelectBase` chama isto ao abrir e a cada 300ms de digitação,
   * igual ao seletor de clientes logo acima.
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
        // O saldo entra aqui porque é o que decide a escolha — no balcão, com
        // o cliente esperando, descobrir a falta ao finalizar é tarde.
        description: `${produto.sku} · ${formatCurrency(Number(produto.salePrice))} · ${
          disponivel > 0 ? `${disponivel} un.` : "sem estoque"
        }`,
      };
    });
  }, []);

  // ─── Atalhos e foco (VD-18) ──────────────────────────────────────

  const formRef = useRef<HTMLFormElement>(null);
  const productFieldRef = useRef<HTMLDivElement>(null);
  const customerFieldRef = useRef<HTMLDivElement>(null);

  /**
   * Abre o seletor de produtos e deixa o cursor no campo de busca.
   *
   * Clicar no gatilho em vez de focar um input: o seletor foca o próprio campo
   * ao abrir. Se já estiver aberto, o clique fecharia — daí a checagem.
   */
  const focusSearch = useCallback(() => {
    const campo = productFieldRef.current?.querySelector("input");
    if (campo) {
      campo.focus();
      campo.select();
      return;
    }
    productFieldRef.current?.querySelector("button")?.click();
  }, []);

  /**
   * FN-13: "Finalizar Venda" fica no painel fixo à direita, sempre visível; o
   * campo Cliente rola junto com o carrinho. Sem isto, vender sem cliente não
   * produzia toast, requisição nem erro na tela — o botão parecia quebrado.
   */
  const onInvalid = useInvalidSubmit(() => {
    scheduleScrollToFirstError(() => formRef.current);
  });

  /**
   * F2 busca produto, F4 cliente, F9 finaliza, ESC limpa a busca.
   * O operador de balcão trabalha com as duas mãos no teclado — obrigar o
   * mouse a cada item é o que o QA mediu como custo por venda.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        focusSearch();
        return;
      }
      if (e.key === "F4") {
        e.preventDefault();
        customerFieldRef.current?.querySelector("button")?.click();
        return;
      }
      if (e.key === "F9") {
        e.preventDefault();
        // Passa pelo submit do form para não pular as validações do zod.
        formRef.current?.requestSubmit();
        return;
      }
      // O ESC é tratado dentro do seletor, que fecha a lista e limpa a busca.
      // Cancelar a venda inteira por ESC seria destrutivo demais para uma tecla
      // que se aperta sem pensar.
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusSearch]);

  // ─── Add product ─────────────────────────────────────────────────

  const addProductToOrder = useCallback(
    (product: ProductResult) => {
      const available = product.inventory?.totalAvailable ?? 0;
      const existingIndex = items.findIndex(
        (item) => item.productId === product.id
      );
      if (existingIndex >= 0) {
        const current = items[existingIndex];
        setValue(`items.${existingIndex}.quantity`, current.quantity + 1);
        // VD-18: o mesmo produto lido duas vezes no leitor soma quantidade. O
        // seletor já limpa a busca e devolve o foco (`keepOpenOnSelect`).
        return;
      }
      append({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        availableStock: available,
        quantity: 1,
        unitPrice: Number(product.salePrice),
        discount: 0,
      });
    },
    [items, append, setValue]
  );

  /**
   * O seletor devolve um id; o carrinho precisa do produto.
   *
   * Com `keepOpenOnSelect`, a lista continua aberta e o campo volta limpo e
   * focado — o próximo bipe cai onde deve, sem clique nenhum no meio.
   */
  const handlePickProduct = useCallback(
    (productId: string) => {
      const product = productsById.current.get(productId);
      if (product) {
        addProductToOrder(product);
      }
    },
    [addProductToOrder]
  );

  // ─── Submit ───────────────────────────────────────────────────────

  const onSubmit = async (data: CounterSaleFormValues) => {
    if (cashRegisterBlocksSale) {
      addToast("Abra o caixa para registrar vendas no balcão.", "error");
      return;
    }
    if (needsSessionChoice && !sessionId) {
      addToast("Selecione em qual caixa a venda será registrada.", "error");
      return;
    }
    // VD-21: the availableStock in the cart is a snapshot from the product
    // search. Confirm it against the server before charging the customer.
    const stock = await refreshCartStock(
      data.items.map((item) => ({
        productId: item.productId,
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

    const settlement = counterSaleSettlement(data);
    try {
      const result = await createOrder.mutateAsync({
        customerId: data.customerId || undefined,
        origin: "BALCAO",
        items: data.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
        })),
        // VD-08: send what is charged to the sale, not what was handed over —
        // the change is not revenue and must not become a receivable.
        payments: data.payments.map((p, index) => ({
          paymentMethodId: p.paymentMethodId,
          paymentConditionId: p.paymentConditionId || undefined,
          financialAccountId: p.financialAccountId || undefined,
          amount: settlement.applied[index],
          installments: p.installments || undefined,
          authorizationCode: p.authorizationCode || undefined,
        })),
        shippingCost: 0,
        discount: Number(data.discount) || 0,
        notes: data.notes || undefined,
        cashRegisterSessionId: selectedSessionId || undefined,
      });
      addToast(
        settlement.change > 0
          ? `Venda finalizada. Troco: ${formatCurrency(settlement.change)}`
          : "Venda no balcão finalizada com sucesso!",
        "success"
      );
      router.push(`/vendas/pedidos/${result.data.id}`);
    } catch (err) {
      addToast(
        getApiErrorMessage(err) ??
          "Erro ao finalizar venda. Verifique o estoque e tente novamente.",
        "error"
      );
    }
  };

  // ─── Stock validation ─────────────────────────────────────────────

  const hasStockIssues = items.some(
    (i) => i.quantity > i.availableStock
  );

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
          <h1 className="text-3xl font-bold tracking-tight">
            Venda no Balcão
          </h1>
          <p className="text-muted-foreground">
            Venda direta - o pedido será finalizado automaticamente
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
              <CardHeader>
                <CardTitle className="text-lg">Cliente</CardTitle>
              </CardHeader>
              <CardContent>
                {/* VD-18: F4 abre este seletor. O SearchableSelect não
                    encaminha ref, então o atalho alcança o gatilho pelo
                    wrapper — menos invasivo que mudar o componente. */}
                <div ref={customerFieldRef}>
                  <SearchableSelect
                    name="customerId"
                    control={control}
                    loadOptions={loadCustomers}
                    placeholder="Buscar cliente por nome ou documento..."
                    error={errors.customerId?.message}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Product picker */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Adicionar Produtos</CardTitle>
              </CardHeader>
              <CardContent>
                {/*
                  O mesmo seletor do cliente, logo acima — mas o balcão tem uma
                  exigência que as outras telas não têm: o leitor de código de
                  barras digita e termina com Enter, e o operador trabalha com
                  as duas mãos no teclado. Daí as duas opções abaixo, sem as
                  quais o dropdown custaria um clique por item bipado.

                  VD-18: o F2 alcança o gatilho pelo wrapper, como o F4 já faz
                  com o cliente — o `SearchableSelect` não encaminha ref.
                */}
                <div ref={productFieldRef}>
                  <SearchableSelectBase
                    // Escolher aqui é uma ação — some para o carrinho e o campo
                    // fica pronto para o próximo item.
                    value=""
                    onChange={handlePickProduct}
                    loadOptions={loadProducts}
                    selectFirstOnEnter
                    keepOpenOnSelect
                    placeholder="Buscar produto por nome, SKU ou código de barras..."
                    emptyMessage="Nenhum produto encontrado"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Order items */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Itens da Venda
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
                    <table className="w-full table-fixed text-sm">
                      <thead className="border-b bg-muted/50">
                        <tr>
                          <th className="px-2 py-2.5 text-left font-medium text-muted-foreground">
                            Produto
                          </th>
                          <th className="w-[136px] px-2 py-2.5 text-center font-medium text-muted-foreground">
                            Qtd
                          </th>
                          <th className="w-[132px] px-2 py-2.5 text-right font-medium text-muted-foreground">
                            Preço Unit.
                          </th>
                          <th className="w-[132px] px-2 py-2.5 text-right font-medium text-muted-foreground">
                            Desconto
                          </th>
                          <th className="w-[88px] px-2 py-2.5 text-right font-medium text-muted-foreground">
                            Total
                          </th>
                          <th className="w-11 px-2 py-2.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((field, index) => {
                          const item = items[index];
                          const qty = Number(item?.quantity) || 0;
                          const stock = Number(item?.availableStock) || 0;
                          const itemTotal = item ? calcItemTotal(item) : 0;
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
                                "border-b last:border-0",
                                overStock && "bg-red-50 dark:bg-red-950/20"
                              )}
                            >
                              <td className="px-2 py-3">
                                <TruncatedText
                                  as="p"
                                  text={item?.productName}
                                  className="max-w-[18ch] font-medium"
                                />
                                <TruncatedText
                                  as="p"
                                  text={item?.sku}
                                  className="max-w-[18ch] text-xs text-muted-foreground"
                                />
                                {/* O estoque mora aqui, não numa coluna própria: com ela
                                    a tabela passava da largura do cartão e o preço
                                    ficava cortado dentro do campo. */}
                                <div className="mt-1">
                                  <StockIndicator available={stock} />
                                </div>
                              </td>

                              <td className="px-2 py-3">
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-7 w-7 md:h-7 md:w-7"
                                    aria-label="Diminuir quantidade"
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
                                        item.productId
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
                                        "border-red-500 text-red-700"
                                    )}
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-7 w-7 md:h-7 md:w-7"
                                    aria-label="Aumentar quantidade"
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
                                {overStock && !itemErrors?.quantity ? <p className="mt-1 text-center text-[10px] text-red-600">
                                    Excede estoque!
                                  </p> : null}
                              </td>

                              <td className="px-2 py-3">
                                <MoneyInput
                                  name={`items.${index}.unitPrice`}
                                  control={control}
                                />
                              </td>

                              <td className="px-2 py-3">
                                <MoneyInput
                                  name={`items.${index}.discount`}
                                  control={control}
                                />
                                {itemErrors?.discount ? <p className="mt-1 text-[10px] text-destructive">
                                    {itemErrors.discount.message}
                                  </p> : null}
                              </td>

                              <td className="px-2 py-3 text-right font-semibold">
                                {formatCurrency(itemTotal)}
                              </td>

                              <td className="px-2 py-3">
                                <Tooltip content="Remover item">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    action="delete"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground md:h-7 md:w-7"
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

            {/* Discount & Notes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Desconto e Observações</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <MoneyInput
                    name="discount"
                    control={control}
                    label="Desconto Geral"
                  />
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Observações</label>
                    <textarea
                      {...register("notes")}
                      rows={3}
                      maxLength={1000}
                      placeholder="Observações internas sobre a venda..."
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
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
                  {(Number(orderDiscount) || 0) > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Desconto</span>
                      <span className="text-red-600">
                        -{formatCurrency(Number(orderDiscount) || 0)}
                      </span>
                    </div>
                  )}
                  <div className="border-t pt-2">
                    <div className="flex items-center justify-between font-semibold">
                      <span>Total</span>
                      <span className="text-lg">
                        {formatCurrency(Math.max(total, 0))}
                      </span>
                    </div>
                  </div>
                </div>

                {/* FN-05: escolha do caixa quando há mais de um aberto */}
                {needsSessionChoice ? <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      Caixa
                    </label>
                    <Select value={sessionId} onValueChange={setSessionId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o caixa" />
                      </SelectTrigger>
                      <SelectContent>
                        {sessions.map((session) => (
                          <SelectItem key={session.id} value={session.id}>
                            {session.cashRegister?.name ?? "Caixa"}
                            {session.operator?.name
                              ? ` · ${session.operator.name}`
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div> : null}

                {/* Cash register closed warning */}
                {showNoCashRegisterWarning ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Nenhum caixa aberto. Abra o caixa em Financeiro &gt; Caixa
                        para registrar vendas no balcão.
                      </p>
                    </div>
                  </div> : null}

                {/* Could not check the cash register — say so instead of lying */}
                {sessionsUnavailable ? <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Não foi possível consultar a situação do caixa. Fale com o
                        administrador se a venda não for concluída.
                      </p>
                    </div>
                  </div> : null}

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
                {hasStockIssues ? <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      <p className="text-xs text-red-700 dark:text-red-400">
                        Alguns itens excedem o estoque disponivel. Ajuste as
                        quantidades para finalizar a venda.
                      </p>
                    </div>
                  </div> : null}

                <div className="space-y-2 border-t pt-4">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={
                      createOrder.isPending ||
                      hasStockIssues ||
                      items.length === 0 ||
                      cashRegisterBlocksSale ||
                      (needsSessionChoice && !sessionId) ||
                      hasMissingAccount
                    }
                  >
                    {createOrder.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Finalizar Venda
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

                {/* VD-18: atalho que ninguém sabe que existe não economiza
                    tempo nenhum. Escondido no mobile, onde não há teclado. */}
                <dl className="mt-4 hidden gap-x-3 gap-y-1 border-t pt-3 text-[11px] text-muted-foreground sm:grid sm:grid-cols-[auto_1fr]">
                  {[
                    ["F2", "Buscar produto"],
                    ["F4", "Selecionar cliente"],
                    ["F9", "Finalizar venda"],
                    ["Esc", "Limpar busca"],
                  ].map(([key, description]) => (
                    <React.Fragment key={key}>
                      <dt>
                        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                          {key}
                        </kbd>
                      </dt>
                      <dd>{description}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
