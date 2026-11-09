import type { OrderItemAdjustmentResult } from "@erp/shared-types";
import { calculateItemAdjustment, roundMoney } from "@erp/validators";
import { z } from "zod";

import type {
  ExchangeOrderItemPayload,
  ReturnOrderItemPayload,
} from "@/hooks/use-order-adjustments";
import { formatCurrency } from "@/lib/utils";

/**
 * Troca de tamanho/cor (mesmo produto), troca por outro produto, ou devolução
 * sem troca. A conta é a mesma da API (`calculateItemAdjustment`), para que o
 * valor anunciado ao cliente seja exatamente o lançado.
 */
export type AdjustMode = "size" | "product" | "return";

export const REASON_MAX_LENGTH = 500;

const OPEN_RECEIVABLE_STATUSES = ["PENDING", "PARTIALLY_PAID", "OVERDUE"];

type MoneyLike = number | string | null | undefined;

export type AdjustableItem = {
  id: string;
  quantity: number;
  unitPrice: MoneyLike;
  discount: MoneyLike;
  totalPrice: MoneyLike;
};

export type AdjustableOrder = {
  subtotal?: MoneyLike;
  discount?: MoneyLike;
  receivables?: { amount: MoneyLike; paidAmount?: MoneyLike; status: string }[];
};

export type AdjustmentPreview = {
  /** > 0 cliente paga; < 0 loja devolve. */
  difference: number;
  charge: number;
  /** Parte da devolução abatida do que o cliente ainda deve. */
  abated: number;
  /** O que sai do caixa/conta como reembolso. */
  refund: number;
};

/** O que o cliente ainda deve neste pedido — a API abate isso antes de reembolsar. */
function outstandingOf(order: AdjustableOrder): number {
  return roundMoney(
    (order.receivables ?? [])
      .filter((r) => OPEN_RECEIVABLE_STATUSES.includes(r.status))
      .reduce((sum, r) => sum + Math.max(Number(r.amount) - Number(r.paidAmount ?? 0), 0), 0)
  );
}

function isValidQuantity(quantity: number, max: number): boolean {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= max;
}

/** `undefined` = troca por produto ainda sem preço: não há prévia possível. */
function replacementFor(mode: AdjustMode, newUnitPrice?: number | null) {
  if (mode === "return") {
    return null;
  }
  if (mode === "size") {
    return { keepPrice: true as const };
  }
  if (newUnitPrice == null || Number.isNaN(newUnitPrice)) {
    return undefined;
  }
  return { unitPrice: Number(newUnitPrice) };
}

export function previewAdjustment(input: {
  order: AdjustableOrder;
  item: AdjustableItem;
  quantity: number;
  mode: AdjustMode;
  newUnitPrice?: number | null;
}): AdjustmentPreview | null {
  const { order, item, quantity, mode, newUnitPrice } = input;
  const replacement = replacementFor(mode, newUnitPrice);
  if (!isValidQuantity(quantity, item.quantity) || replacement === undefined) {
    return null;
  }

  const math = calculateItemAdjustment({
    item: {
      quantity: item.quantity,
      totalPrice: Number(item.totalPrice ?? 0),
      discount: Number(item.discount ?? 0),
    },
    quantity,
    order: { subtotal: Number(order.subtotal ?? 0), discount: Number(order.discount ?? 0) },
    replacement,
  });

  const owed = Math.max(-math.difference, 0);
  const abated = Math.min(owed, outstandingOf(order));
  return {
    difference: math.difference,
    charge: Math.max(math.difference, 0),
    abated,
    refund: roundMoney(owed - abated),
  };
}

// ─── Formulário ──────────────────────────────────────────────────────────

export const adjustItemBaseSchema = z.object({
  mode: z.enum(["size", "product", "return"]),
  quantity: z.coerce.number().int("Informe um número inteiro de unidades."),
  productId: z.string(),
  variantId: z.string(),
  reason: z.string().max(REASON_MAX_LENGTH, `O motivo tem no máximo ${REASON_MAX_LENGTH} caracteres.`),
  settleNow: z.boolean(),
  paymentMethodId: z.string(),
  cashRegisterSessionId: z.string(),
});

export type AdjustItemValues = z.infer<typeof adjustItemBaseSchema>;

type AdjustItemSchemaOptions = {
  maxQuantity: number;
  /** Dinheiro com mais de um caixa aberto: o operador diz por qual passa. */
  sessionRequiredFor: (paymentMethodId: string) => boolean;
  /**
   * Há dinheiro a movimentar com estes valores? Sem isso, "acertar agora"
   * (marcado por padrão) exigia forma de pagamento numa seção escondida, e
   * a troca de tamanho não podia ser confirmada. Ausente = sempre há.
   */
  settlementApplies?: (values: AdjustItemValues) => boolean;
};

export function buildAdjustItemSchema(opts: AdjustItemSchemaOptions) {
  return adjustItemBaseSchema.superRefine((v, ctx) => {
    for (const [path, message] of adjustItemIssues(v, opts)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    }
  });
}

/** Regras que dependem do tipo de operação e da forma de pagamento escolhida. */
function adjustItemIssues(
  values: AdjustItemValues,
  opts: AdjustItemSchemaOptions
): [keyof AdjustItemValues, string][] {
  const settles = values.settleNow && (opts.settlementApplies?.(values) ?? true);
  const v = { ...values, settleNow: settles };
  const checks: [boolean, keyof AdjustItemValues, string][] = [
    [!isValidQuantity(v.quantity, opts.maxQuantity), "quantity", `Informe de 1 a no máximo ${opts.maxQuantity} unidade(s).`],
    [v.mode === "size" && !v.variantId, "variantId", "Escolha o novo tamanho/cor."],
    [v.mode === "product" && !v.productId, "productId", "Escolha o produto da troca."],
    [v.mode === "return" && !v.reason.trim(), "reason", "Informe o motivo da devolução."],
    [v.settleNow && !v.paymentMethodId, "paymentMethodId", "Escolha a forma de pagamento."],
    [
      v.settleNow && !!v.paymentMethodId && opts.sessionRequiredFor(v.paymentMethodId) && !v.cashRegisterSessionId,
      "cashRegisterSessionId",
      "Escolha por qual caixa o dinheiro passa.",
    ],
  ];
  return checks.filter(([failed]) => failed).map(([, path, message]) => [path, message]);
}

export type AdjustmentRequest =
  | { kind: "exchange"; payload: ExchangeOrderItemPayload }
  | { kind: "return"; payload: ReturnOrderItemPayload };

export function toAdjustmentRequest(
  values: AdjustItemValues,
  ctx: { orderId: string; item: AdjustableItem & { productId: string }; hasDifference: boolean }
): AdjustmentRequest {
  const reason = values.reason.trim();
  const settlement =
    values.settleNow && ctx.hasDifference && values.paymentMethodId
      ? {
          settlement: {
            paymentMethodId: values.paymentMethodId,
            ...(values.cashRegisterSessionId
              ? { cashRegisterSessionId: values.cashRegisterSessionId }
              : {}),
          },
        }
      : {};
  const common = { id: ctx.orderId, orderItemId: ctx.item.id, quantity: values.quantity };

  if (values.mode === "return") {
    return { kind: "return", payload: { ...common, reason, ...settlement } };
  }

  return {
    kind: "exchange",
    payload: {
      ...common,
      newProductId: values.mode === "size" ? ctx.item.productId : values.productId,
      ...(values.variantId ? { newVariantId: values.variantId } : {}),
      ...(reason ? { reason } : {}),
      ...settlement,
    },
  };
}

/** Toast de sucesso: diz se o dinheiro já passou ou se ficou um título em aberto. */
export function adjustmentSuccessMessage(
  result: Pick<OrderItemAdjustmentResult, "type" | "difference" | "refundAmount" | "abatedAmount" | "settled">
): string {
  const done = result.type === "EXCHANGE" ? "Troca registrada." : "Devolução registrada.";
  const { difference, refundAmount, abatedAmount, settled } = result;

  if (difference > 0) {
    return settled
      ? `${done} Recebido ${formatCurrency(difference)} do cliente.`
      : `${done} ${formatCurrency(difference)} a receber ficou em aberto no financeiro.`;
  }
  if (refundAmount > 0) {
    return settled
      ? `${done} Devolvido ${formatCurrency(refundAmount)} ao cliente.`
      : `${done} Reembolso de ${formatCurrency(refundAmount)} ficou em aberto no financeiro.`;
  }
  if (abatedAmount > 0) {
    return `${done} ${formatCurrency(abatedAmount)} abatidos do que o cliente devia.`;
  }
  return `${done} Sem diferença de valor.`;
}

type MethodLike = { id: string; type: string; isActive?: boolean };
type SessionLike = { id: string };

/**
 * Formas oferecidas para acertar a diferença e, para dinheiro, se o operador
 * precisa dizer o caixa — a mesma regra da API: o caixa da venda se ainda
 * estiver aberto, senão o único aberto; com vários, pergunta.
 */
export function settlementOptions<M extends MethodLike, S extends SessionLike>(input: {
  methods: M[];
  openSessions: S[];
  orderSessionId?: string | null;
}) {
  const methods = input.methods.filter((m) => m.isActive !== false && m.type !== "STORE_CREDIT");
  const orderSessionOpen = input.openSessions.some((s) => s.id === input.orderSessionId);
  const sessionRequiredFor = (paymentMethodId: string) =>
    methods.find((m) => m.id === paymentMethodId)?.type === "CASH" &&
    !orderSessionOpen &&
    input.openSessions.length > 1;

  return { methods, sessionRequiredFor };
}
