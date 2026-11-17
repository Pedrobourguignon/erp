"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { useFinancialAccounts } from "@/hooks/use-financial-accounts";
import type {
  FinancialEntryListParams,
  FinancialEntryStatusFilter,
  FinancialEntryType,
} from "@/hooks/use-financial-entries";
import { cn, isInvertedRange } from "@/lib/utils";

const ALL = "all";

export interface EntriesFiltersProps {
  filters: FinancialEntryListParams;
  onChange: (patch: Partial<FinancialEntryListParams>) => void;
}

export function EntriesFilters({ filters, onChange }: EntriesFiltersProps) {
  const { data: accountsData } = useFinancialAccounts({ isActive: true });
  const accounts = accountsData?.data ?? [];

  // FN-23: an inverted period returned an empty list with the generic "Ajuste
  // os filtros", leaving the user to guess what was wrong.
  const invertedRange = isInvertedRange(filters.startDate, filters.endDate);

  return (
    // A data só precisa caber "dd/mm/aaaa": com a mesma largura dos dropdowns
    // sobrava meio campo vazio à direita do calendário.
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-[repeat(2,10rem)_repeat(3,minmax(0,1fr))]">
      <div className="space-y-1">
        <label htmlFor="entries-from" className="text-xs font-medium text-muted-foreground">De</label>
        <Input
          id="entries-from"
          type="date"
          max={filters.endDate || undefined}
          value={filters.startDate ?? ""}
          onChange={(e) => onChange({ startDate: e.target.value })}
          className={cn("h-9 md:h-9", invertedRange && "border-destructive")}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="entries-to" className="text-xs font-medium text-muted-foreground">Até</label>
        <Input
          id="entries-to"
          type="date"
          min={filters.startDate || undefined}
          value={filters.endDate ?? ""}
          onChange={(e) => onChange({ endDate: e.target.value })}
          className={cn("h-9 md:h-9", invertedRange && "border-destructive")}
          aria-invalid={invertedRange}
        />
        {invertedRange ? <p className="text-xs text-destructive">
            A data final deve ser posterior à inicial.
          </p> : null}
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Tipo</label>
        <Select
          value={filters.type ?? ALL}
          onValueChange={(v) =>
            onChange({
              type: v === ALL ? undefined : (v as FinancialEntryType),
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos</SelectItem>
            <SelectItem value="REVENUE">Receita</SelectItem>
            <SelectItem value="EXPENSE">Despesa</SelectItem>
            <SelectItem value="TRANSFER">Transferência</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Conta</label>
        <Select
          value={filters.accountId ?? ALL}
          onValueChange={(v) => onChange({ accountId: v === ALL ? undefined : v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Status</label>
        <Select
          value={filters.status ?? ALL}
          onValueChange={(v) =>
            onChange({
              status: v === ALL ? undefined : (v as FinancialEntryStatusFilter),
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos</SelectItem>
            <SelectItem value="PAID">Pago</SelectItem>
            <SelectItem value="OPEN">Em aberto</SelectItem>
            <SelectItem value="OVERDUE">Vencido</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
