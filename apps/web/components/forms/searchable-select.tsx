"use client";

import { ChevronDown, X, Loader2, Search, Check } from "lucide-react";
import React, { useState, useRef, useEffect } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SearchableSelectBaseProps {
  /** Empty string means "nothing selected". */
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  loadOptions?: (search: string) => Promise<SelectOption[]>;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  error?: string;
  emptyMessage?: string;
  /**
   * Enter no campo de busca escolhe a primeira opção (VD-18).
   *
   * O leitor de código de barras do balcão digita depressa e termina com Enter.
   * A escolha não pode esperar os 300ms do debounce — o operador leria a demora
   * como "o bipe não pegou" — então o Enter refaz a busca na hora e usa o que
   * ela devolver.
   */
  selectFirstOnEnter?: boolean;
  /**
   * Depois de escolher, mantém a lista aberta e o campo limpo.
   *
   * É o que permite bipar um item atrás do outro sem reabrir o seletor a cada
   * produto — sem isto, um dropdown custaria um clique por item numa tela em
   * que o operador trabalha com as duas mãos no teclado.
   */
  keepOpenOnSelect?: boolean;
  /**
   * A opção que o chamador já conhece e que pode não estar na lista carregada
   * — o cliente que acabou de ser cadastrado na própria tela de venda. Só vale
   * enquanto for o `value` escolhido; sem ela o campo ficava selecionado e
   * mostrando o texto do placeholder.
   */
  selectedOption?: SelectOption | null;
}

interface SearchableSelectProps<TFieldValues extends FieldValues>
  extends Omit<SearchableSelectBaseProps, "value" | "onChange"> {
  name: Path<TFieldValues>;
  control: Control<TFieldValues>;
}

// ─── Base ───────────────────────────────────────────────────────────────

/**
 * The picker itself, driven by `value`/`onChange`.
 *
 * Split out of `SearchableSelect` so a **filter** can use it: a filter has no
 * form around it, and the alternative was a second copy of the whole dropdown —
 * exactly the duplication this lote is undoing (FT-03/FT-04).
 */
export function SearchableSelectBase({
  value,
  onChange,
  options: staticOptions,
  loadOptions,
  label,
  placeholder = "Selecionar...",
  disabled = false,
  className,
  error,
  emptyMessage = "Nenhum resultado encontrado",
  selectFirstOnEnter = false,
  keepOpenOnSelect = false,
  selectedOption: knownOption,
}: SearchableSelectBaseProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [asyncOptions, setAsyncOptions] = useState<SelectOption[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropUp, setDropUp] = useState(false);

  /**
   * AE-26: decide o lado ao abrir. Se não cabe abaixo mas cabe acima, sobe —
   * dentro de um modal apertado essa é a diferença entre alcançar os campos
   * de baixo e não alcançar.
   */
  useEffect(() => {
    if (!open || !containerRef.current) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const DROPDOWN_HEIGHT = 280; // max-h-56 da lista + campo de busca
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setDropUp(spaceBelow < DROPDOWN_HEIGHT && spaceAbove > spaceBelow);
  }, [open]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const options = loadOptions ? asyncOptions : staticOptions ?? [];

  // Filter static options locally
  const filteredOptions = loadOptions
    ? options
    : options.filter(
        (opt) =>
          opt.label.toLowerCase().includes(search.toLowerCase()) ||
          opt.value.toLowerCase().includes(search.toLowerCase())
      );

  // Async loading
  useEffect(() => {
    if (!loadOptions || !open) {
      return;
    }

    setIsLoadingOptions(true);
    if (debounceRef.current) {clearTimeout(debounceRef.current);}
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await loadOptions(search);
        setAsyncOptions(results);
      } catch {
        setAsyncOptions([]);
      } finally {
        setIsLoadingOptions(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {clearTimeout(debounceRef.current);}
    };
  }, [search, open, loadOptions]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Find selected label
  const allOptions = loadOptions ? asyncOptions : staticOptions ?? [];
  const selectedOption =
    allOptions.find((o) => o.value === value) ??
    (knownOption && knownOption.value === value ? knownOption : undefined);

  const handleSelect = (option: SelectOption) => {
    onChange(option.value);
    setSearch("");
    if (keepOpenOnSelect) {
      // Volta o foco para o campo: o próximo bipe cai onde deve.
      //
      // Os 50ms são os mesmos da abertura, e pela mesma razão: escolher um item
      // faz o formulário do chamador re-renderizar, e um `setTimeout(0)` corre
      // antes disso — o foco ia para o `body` e o bipe seguinte se perdia.
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }
    setOpen(false);
  };

  /**
   * Enter escolhe a primeira opção, sem esperar o debounce (VD-18).
   *
   * Refaz a busca na hora em vez de usar `filteredOptions`: quando o Enter do
   * leitor chega, o debounce de 300ms ainda não disparou e a lista em tela é a
   * da busca anterior — escolher a primeira dali adicionaria o produto errado.
   */
  const handleSearchKeyDown = async (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setSearch("");
      setOpen(false);
      return;
    }
    if (event.key !== "Enter" || !selectFirstOnEnter) {
      return;
    }
    event.preventDefault();

    let candidates = filteredOptions;
    if (loadOptions) {
      setIsLoadingOptions(true);
      try {
        candidates = await loadOptions(search);
        setAsyncOptions(candidates);
      } catch {
        candidates = [];
      } finally {
        setIsLoadingOptions(false);
      }
    }

    const [first] = candidates;
    if (first) {
      handleSelect(first);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setSearch("");
  };

  const errorMessage = error;

  return (
    <div className={cn("space-y-1", className)} ref={containerRef}>
      {label ? <label className="text-sm font-medium leading-none">{label}</label> : null}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen(!open);
            if (!open) {setTimeout(() => inputRef.current?.focus(), 50);}
          }}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            errorMessage && "border-destructive focus:ring-destructive/20 focus:border-destructive"
          )}
        >
          <span className={cn("truncate", !selectedOption && "text-muted-foreground")}>
            {selectedOption?.label ?? placeholder}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {value ? <X
                className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground transition-colors"
                onClick={handleClear}
              /> : null}
            <ChevronDown className={cn(
              "h-4 w-4 text-muted-foreground/70 transition-transform duration-200",
              open && "rotate-180"
            )} />
          </div>
        </button>

        {open ? <div
            ref={dropdownRef}
            className={cn(
              "absolute z-50 w-full overflow-hidden rounded-lg border bg-popover shadow-elevated animate-in fade-in-0 zoom-in-[0.98] duration-150",
              // AE-26: sem detecção de colisão a lista abria sempre para baixo
              // e cobria Depósito, Quantidade, Motivo e Observações — dentro de
              // um modal que não crescia nem rolava.
              dropUp ? "bottom-full mb-1" : "top-full mt-1"
            )}
          >
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground/60" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Buscar..."
                className="flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground/60"
              />
              {isLoadingOptions ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : null}
            </div>
            <div className="max-h-56 overflow-y-auto p-1">
              {filteredOptions.length === 0 && !isLoadingOptions ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </p>
              ) : (
                filteredOptions.map((option) => {
                  const isSelected = value === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleSelect(option)}
                      className={cn(
                        "relative flex w-full items-start gap-2 rounded-md px-2 py-2 pl-8 text-sm transition-colors",
                        "hover:bg-accent/10",
                        isSelected && "bg-accent/10"
                      )}
                    >
                      {isSelected ? <Check className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-accent" /> : null}
                      {/*
                        AE-31: o rótulo vem do banco e não tem limite — um nome
                        de produto de 255 caracteres sem espaços quebrava em seis
                        linhas e transformava uma opção da lista num parágrafo.
                        `min-w-0` é o que dá contra o que cortar; o `title`
                        devolve o texto inteiro, para o corte não virar perda.
                      */}
                      <div className="flex min-w-0 flex-1 flex-col items-start text-left">
                        <span
                          className={cn(
                            "w-full truncate font-medium",
                            isSelected && "text-accent-foreground"
                          )}
                          title={option.label}
                        >
                          {option.label}
                        </span>
                        {option.description ? <span
                            className="w-full truncate text-xs text-muted-foreground"
                            title={option.description}
                          >
                            {option.description}
                          </span> : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div> : null}
      </div>
      {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
    </div>
  );
}

// ─── react-hook-form wrapper ────────────────────────────────────────────

/**
 * `SearchableSelectBase` bound to a form field.
 *
 * Kept as the default export shape so every existing caller (product picker,
 * customer picker, movement dialog) is untouched.
 */
export function SearchableSelect<TFieldValues extends FieldValues>({
  name,
  control,
  error,
  ...rest
}: SearchableSelectProps<TFieldValues>) {
  const {
    field,
    fieldState: { error: fieldError },
  } = useController({ name, control });

  return (
    <SearchableSelectBase
      {...rest}
      value={(field.value as string) ?? ""}
      onChange={field.onChange}
      error={error ?? fieldError?.message}
    />
  );
}
