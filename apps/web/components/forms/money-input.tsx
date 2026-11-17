"use client";

import React, { useCallback, useEffect, useId, useRef } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { cn } from "@/lib/utils";

// ─── Formatting helpers ─────────────────────────────────────────────────

/** Digits beyond this length overflow the safe integer range for cents. */
const MAX_DIGITS = 15;

function formatNumberToBRL(value: number): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Reads a currency value out of whatever the input currently holds.
 * The field is digit-driven: every digit is a cent, so "1234" is R$ 12,34.
 */
export function parseInputToNumber(raw: string, allowNegative = false): number {
  const digits = raw.replace(/\D/g, "").slice(0, MAX_DIGITS);
  if (!digits) {
    return 0;
  }
  const value = Number.parseInt(digits, 10) / 100;
  const isNegative = allowNegative && raw.trimStart().startsWith("-");
  return isNegative ? -value : value;
}

// ─── Types ──────────────────────────────────────────────────────────────

interface MoneyInputProps<TFieldValues extends FieldValues> {
  name: Path<TFieldValues>;
  control: Control<TFieldValues>;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  error?: string;
  /** Allows a leading minus sign. Off by default — prices are never negative. */
  allowNegative?: boolean;
  /** For an external `<label htmlFor>` when the label lives outside. */
  id?: string;
}

// ─── Component ──────────────────────────────────────────────────────────

export function MoneyInput<TFieldValues extends FieldValues>({
  name,
  control,
  label,
  placeholder = "0,00",
  disabled = false,
  className,
  error,
  allowNegative = false,
  id,
}: MoneyInputProps<TFieldValues>) {
  const {
    field,
    fieldState: { error: fieldError },
  } = useController({ name, control });

  const inputRef = useRef<HTMLInputElement | null>(null);

  const numericValue =
    field.value == null || field.value === "" ? 0 : Number(field.value);

  // An empty string (instead of "0,00") lets the placeholder show and keeps
  // the caret from landing to the left of pre-existing text.
  const displayValue =
    Number.isNaN(numericValue) || numericValue === 0
      ? ""
      : formatNumberToBRL(numericValue);

  // The input is right-aligned and controlled: without this, clicking it puts
  // the caret at position 0 and every keystroke multiplies the value instead
  // of appending cents.
  const moveCaretToEnd = useCallback(() => {
    const el = inputRef.current;
    if (!el) {
      return;
    }
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  useEffect(() => {
    if (inputRef.current && document.activeElement === inputRef.current) {
      moveCaretToEnd();
    }
  }, [displayValue, moveCaretToEnd]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      field.onChange(parseInputToNumber(e.target.value, allowNegative));
    },
    [field, allowNegative]
  );

  const errorMessage = error ?? fieldError?.message;
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={cn("space-y-1", className)}>
      {label ? <label htmlFor={inputId} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          {label}
        </label> : null}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          R$
        </span>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          ref={(el) => {
            inputRef.current = el;
            field.ref(el);
          }}
          value={displayValue}
          onChange={handleChange}
          onFocus={moveCaretToEnd}
          onClick={moveCaretToEnd}
          onBlur={field.onBlur}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm text-right ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            errorMessage && "border-destructive focus-visible:ring-destructive"
          )}
        />
      </div>
      {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
    </div>
  );
}
