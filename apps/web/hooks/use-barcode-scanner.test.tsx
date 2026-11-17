import { fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useBarcodeScanner } from "./use-barcode-scanner";

let clock = 0;
const now = () => clock;

function Page({ onScan, enabled = true }: { onScan: (code: string) => void; enabled?: boolean }) {
  useBarcodeScanner({ onScan, enabled, now });
  const [discount, setDiscount] = useState("5");
  const [submitted, setSubmitted] = useState(false);
  return (
    <form onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}>
      <label htmlFor="discount">Desconto</label>
      <input id="discount" value={discount} onChange={(e) => setDiscount(e.target.value)} />
      {submitted ? <p>enviado</p> : null}
    </form>
  );
}

/**
 * Types like a keyboard would: keydown, and the character lands in the field
 * unless the keydown was prevented. Enter submits the form unless prevented.
 */
function typeInto(input: HTMLInputElement, text: string, gap: number) {
  for (const key of [...text, "Enter"]) {
    clock += gap;
    const notPrevented = fireEvent.keyDown(input, { key });
    if (!notPrevented) {continue;}
    if (key === "Enter") {
      fireEvent.submit(input.form!);
    } else {
      fireEvent.change(input, { target: { value: input.value + key } });
    }
  }
}

describe("useBarcodeScanner", () => {
  it("hands over the code read, wherever the cursor was", () => {
    const onScan = vi.fn();
    render(<Page onScan={onScan} />);
    const field = screen.getByLabelText("Desconto") as HTMLInputElement;
    field.focus();

    typeInto(field, "7891000000017", 5);

    expect(onScan).toHaveBeenCalledWith("7891000000017");
  });

  it("leaves the focused field as it was before the read", () => {
    render(<Page onScan={vi.fn()} />);
    const field = screen.getByLabelText("Desconto") as HTMLInputElement;
    field.focus();

    typeInto(field, "7891000000017", 5);

    expect(field).toHaveValue("5");
  });

  it("does not let the reader's Enter submit the form", () => {
    render(<Page onScan={vi.fn()} />);
    const field = screen.getByLabelText("Desconto") as HTMLInputElement;
    field.focus();

    typeInto(field, "7891000000017", 5);

    expect(screen.queryByText("enviado")).not.toBeInTheDocument();
  });

  it("leaves a person typing alone", () => {
    const onScan = vi.fn();
    render(<Page onScan={onScan} />);
    const field = screen.getByLabelText("Desconto") as HTMLInputElement;
    field.focus();

    typeInto(field, "10", 180);

    expect(onScan).not.toHaveBeenCalled();
    expect(field).toHaveValue("510");
    expect(screen.getByText("enviado")).toBeInTheDocument();
  });

  // Digitação muito rápida sem Enter (autopreenchimento, teclado rápido) não é
  // leitura: nenhuma tecla pode se perder.
  it("never swallows fast keys that do not end in Enter", () => {
    render(<Page onScan={vi.fn()} />);
    const field = screen.getByLabelText("Desconto") as HTMLInputElement;
    field.focus();

    for (const key of "0000") {
      clock += 5;
      if (fireEvent.keyDown(field, { key })) {
        fireEvent.change(field, { target: { value: field.value + key } });
      }
    }

    expect(field).toHaveValue("50000");
  });

  it("does nothing while disabled (e.g. a dialog is open)", () => {
    const onScan = vi.fn();
    render(<Page onScan={onScan} enabled={false} />);
    const field = screen.getByLabelText("Desconto") as HTMLInputElement;
    field.focus();

    typeInto(field, "7891000000017", 5);

    expect(onScan).not.toHaveBeenCalled();
  });
});
