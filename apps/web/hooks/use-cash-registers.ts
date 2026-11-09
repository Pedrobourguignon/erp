import type { PaginatedResponse, ApiResponse } from "@erp/shared-types";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import api from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────

export interface CashRegisterSession {
  id: string;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt?: string;
  cashRegisterId?: string;
  operatorId: string;
  openingBalance: number;
  closingBalance?: number;
  expectedBalance?: number;
  difference?: number;
  notes?: string;
  operator?: { id: string; name: string };
  closedBy?: { id: string; name: string };
  cashRegister?: { id: string; name: string };
  movements?: CashMovement[];
  /**
   * Running totals for the session, computed by the API — vêm tanto no detalhe
   * da sessão (`getCurrentSession`) quanto na listagem de caixas, que é onde o
   * card lê o saldo atual.
   */
  totals?: {
    supplies: number;
    withdrawals: number;
    /**
     * Vendas em dinheiro da sessão. Compõem o `currentBalance` e o saldo
     * esperado no fechamento — omitir da tela fazia o resumo não fechar:
     * abertura R$ 200 + entradas R$ 0 - saídas R$ 0 exibindo saldo R$ 500.
     */
    cashSales?: number;
    currentBalance?: number;
  };
}

export interface CashMovement {
  id: string;
  type: "SUPPLY" | "WITHDRAW";
  amount: number;
  reason: string;
  createdAt: string;
  performedBy?: { id: string; name: string };
}

/**
 * O fechamento devolve, além da sessão, o que fez com o dinheiro contado:
 * quanto ficou de troco e para onde foi o resto.
 */
export interface CloseSessionResult extends CashRegisterSession {
  retainedAmount?: number;
  transfer?: {
    toAccountId: string;
    toAccountName: string;
    amount: number;
  } | null;
}

export interface CashRegister {
  id: string;
  name: string;
  financialAccountId: string;
  isActive: boolean;
  currentSession?: CashRegisterSession;
}

export interface CreateCashRegisterPayload {
  name: string;
  financialAccountId: string;
}

// ─── Params ────────────────────────────────────────────────────────────

export interface CashRegisterSessionListParams {
  cashRegisterId?: string;
  status?: "OPEN" | "CLOSED";
  page?: number;
  limit?: number;
}

// ─── Query keys ────────────────────────────────────────────────────────

export const cashRegisterKeys = {
  all: ["cash-registers"] as const,
  lists: () => [...cashRegisterKeys.all, "list"] as const,
  list: () => [...cashRegisterKeys.lists()] as const,
  sessions: () => [...cashRegisterKeys.all, "sessions"] as const,
  sessionList: (params: CashRegisterSessionListParams) =>
    [...cashRegisterKeys.sessions(), params] as const,
  session: (id: string) =>
    [...cashRegisterKeys.all, "session", id] as const,
};

// ─── Hooks ─────────────────────────────────────────────────────────────

interface CashRegisterRaw {
  id: string;
  name: string;
  financialAccountId: string;
  isActive: boolean;
  sessions?: CashRegisterSession[];
  currentSession?: CashRegisterSession;
}

export function useCashRegisters() {
  return useQuery({
    queryKey: cashRegisterKeys.list(),
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<CashRegisterRaw>>(
        "/cash-registers"
      );
      return {
        ...data,
        data: data.data.map((reg) => ({
          ...reg,
          currentSession: reg.currentSession ?? reg.sessions?.[0] ?? undefined,
        })) as CashRegister[],
      };
    },
  });
}

export function useCreateCashRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateCashRegisterPayload) => {
      const { data } = await api.post<ApiResponse<CashRegister>>(
        "/cash-registers",
        payload
      );
      return data;
    },
    onSuccess: () => {
      // FN-11: o prefixo inteiro. Invalidar só `lists()` deixava a tabela de
      // sessões (`sessionList(params)`) intacta — o operador fechava o caixa e
      // a tela continuava mostrando "Aberto".
      queryClient.invalidateQueries({ queryKey: cashRegisterKeys.all });
    },
  });
}

export function useOpenCashRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      openingBalance,
    }: {
      id: string;
      openingBalance: number;
    }) => {
      const { data } = await api.post<ApiResponse<CashRegisterSession>>(
        `/cash-registers/${id}/open`,
        { openingBalance }
      );
      return data;
    },
    onSuccess: () => {
      // FN-11: o prefixo inteiro. Invalidar só `lists()` deixava a tabela de
      // sessões (`sessionList(params)`) intacta — o operador fechava o caixa e
      // a tela continuava mostrando "Aberto".
      queryClient.invalidateQueries({ queryKey: cashRegisterKeys.all });
    },
  });
}

export function useCloseCashRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      closingBalance,
      notes,
      retainedAmount,
      destinationAccountId,
    }: {
      id: string;
      closingBalance: number;
      notes?: string;
      /** Fundo de troco que fica na gaveta para a abertura seguinte. */
      retainedAmount?: number;
      /** Destino do que sai da gaveta. Sem ele, nada é transferido. */
      destinationAccountId?: string;
    }) => {
      const { data } = await api.post<ApiResponse<CloseSessionResult>>(
        `/cash-registers/${id}/close`,
        { closingBalance, notes, retainedAmount, destinationAccountId }
      );
      return data;
    },
    onSuccess: () => {
      // FN-11: o prefixo inteiro. Invalidar só `lists()` deixava a tabela de
      // sessões (`sessionList(params)`) intacta — o operador fechava o caixa e
      // a tela continuava mostrando "Aberto".
      queryClient.invalidateQueries({ queryKey: cashRegisterKeys.all });
    },
  });
}

export function useCashSupply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      amount,
      reason,
    }: {
      id: string;
      amount: number;
      reason: string;
    }) => {
      const { data } = await api.post<ApiResponse<CashMovement>>(
        `/cash-registers/${id}/supply`,
        { amount, reason }
      );
      return data;
    },
    onSuccess: () => {
      // FN-11: o prefixo inteiro. Invalidar só `lists()` deixava a tabela de
      // sessões (`sessionList(params)`) intacta — o operador fechava o caixa e
      // a tela continuava mostrando "Aberto".
      queryClient.invalidateQueries({ queryKey: cashRegisterKeys.all });
    },
  });
}

export function useCashWithdraw() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      amount,
      reason,
    }: {
      id: string;
      amount: number;
      reason: string;
    }) => {
      const { data } = await api.post<ApiResponse<CashMovement>>(
        `/cash-registers/${id}/withdraw`,
        { amount, reason }
      );
      return data;
    },
    onSuccess: () => {
      // FN-11: o prefixo inteiro. Invalidar só `lists()` deixava a tabela de
      // sessões (`sessionList(params)`) intacta — o operador fechava o caixa e
      // a tela continuava mostrando "Aberto".
      queryClient.invalidateQueries({ queryKey: cashRegisterKeys.all });
    },
  });
}

export function useCashRegisterSession(id: string) {
  return useQuery({
    queryKey: cashRegisterKeys.session(id),
    queryFn: async () => {
      const { data } = await api.get<ApiResponse<CashRegisterSession>>(
        `/cash-registers/${id}/session`
      );
      return data;
    },
    enabled: !!id,
  });
}

export function useCashRegisterSessions(
  params: CashRegisterSessionListParams = {}
) {
  return useQuery({
    queryKey: cashRegisterKeys.sessionList(params),
    queryFn: async () => {
      const { data } = await api.get<PaginatedResponse<CashRegisterSession>>(
        "/cash-register-sessions",
        {
          params: {
            cashRegisterId: params.cashRegisterId || undefined,
            status: params.status || undefined,
            page: params.page ?? 1,
            limit: params.limit ?? 20,
          },
        }
      );
      return data;
    },
    placeholderData: (prev) => prev,
  });
}
