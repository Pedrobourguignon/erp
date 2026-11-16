import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { useForm } from 'react-hook-form';
import { describe, it, expect } from 'vitest';

import { MoneyInput, parseInputToNumber } from './money-input';

interface TestForm {
  price: number;
}

function TestWrapper({
  defaultValue = 0,
  error,
  allowNegative,
  onValue,
}: {
  defaultValue?: number;
  error?: string;
  allowNegative?: boolean;
  onValue?: (value: number) => void;
}) {
  const form = useForm<TestForm>({
    defaultValues: { price: defaultValue },
  });

  const current = form.watch('price');
  onValue?.(current);

  return (
    <MoneyInput<TestForm>
      name="price"
      control={form.control}
      label="Price"
      error={error}
      allowNegative={allowNegative}
    />
  );
}

describe('MoneyInput', () => {
  it('should render with label', () => {
    render(<TestWrapper />);
    expect(screen.getByText('Price')).toBeInTheDocument();
  });

  it('liga o rótulo ao campo: clicar no texto foca o input e o leitor de tela anuncia o nome', () => {
    render(<TestWrapper />);
    expect(screen.getByLabelText('Price')).toHaveAttribute('inputmode', 'numeric');
  });

  it('should show R$ prefix', () => {
    render(<TestWrapper />);
    expect(screen.getByText('R$')).toBeInTheDocument();
  });

  it('should display formatted value for a non-zero default', () => {
    render(<TestWrapper defaultValue={1234.56} />);
    expect(screen.getByRole('textbox')).toHaveValue('1.234,56');
  });

  it('should display an empty string for zero so the placeholder shows', () => {
    render(<TestWrapper defaultValue={0} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('should show error message', () => {
    render(<TestWrapper error="Price is required" />);
    expect(screen.getByText('Price is required')).toBeInTheDocument();
  });

  it('should have the error class when error is present', () => {
    render(<TestWrapper error="Required" />);
    expect(screen.getByRole('textbox').className).toContain('border-destructive');
  });

  it('should render as disabled when disabled prop is set', () => {
    function DisabledWrapper() {
      const form = useForm<TestForm>({ defaultValues: { price: 0 } });
      return <MoneyInput<TestForm> name="price" control={form.control} disabled />;
    }
    render(<DisabledWrapper />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  // ─── AE-01: digits are cents, always appended at the end ──────────────
  // Regression: clicking the (right-aligned) field put the caret at position 0,
  // so typing "1234" produced R$ 12.300,04 and the wrong price was saved.

  describe('AE-01 — digit typing produces the right amount', () => {
    const cases: Array<{ typed: string; display: string; value: number }> = [
      { typed: '1', display: '0,01', value: 0.01 },
      { typed: '12', display: '0,12', value: 0.12 },
      { typed: '1234', display: '12,34', value: 12.34 },
      { typed: '199990', display: '1.999,90', value: 1999.9 },
    ];

    it.each(cases)('typing $typed shows $display', async ({ typed, display, value }) => {
      const user = userEvent.setup();
      let latest = -1;
      render(<TestWrapper onValue={(v) => { latest = v; }} />);
      const input = screen.getByRole('textbox');

      await user.click(input);
      await user.type(input, typed);

      expect(input).toHaveValue(display);
      expect(latest).toBeCloseTo(value, 2);
    });

    it('appends at the end even when the user clicks in the middle of the text', async () => {
      const user = userEvent.setup();
      render(<TestWrapper defaultValue={12.34} />);
      const input = screen.getByRole('textbox') as HTMLInputElement;

      input.focus();
      input.setSelectionRange(0, 0);
      await user.type(input, '5');

      // 12,34 + digit 5 → 123,45 (never 512,34 or an order-of-magnitude jump)
      expect(input).toHaveValue('123,45');
    });

    it('removes the last cent on backspace', async () => {
      const user = userEvent.setup();
      render(<TestWrapper />);
      const input = screen.getByRole('textbox');

      await user.click(input);
      await user.type(input, '1234');
      await user.keyboard('{Backspace}');

      expect(input).toHaveValue('1,23');
    });

    it('clears to zero when everything is deleted', async () => {
      const user = userEvent.setup();
      let latest = -1;
      render(<TestWrapper defaultValue={12.34} onValue={(v) => { latest = v; }} />);
      const input = screen.getByRole('textbox');

      await user.clear(input);

      expect(input).toHaveValue('');
      expect(latest).toBe(0);
    });
  });

  describe('parseInputToNumber', () => {
    it.each([
      ['', 0],
      ['1', 0.01],
      ['1234', 12.34],
      ['1.234,56', 1234.56],
      ['R$ 1.999,90', 1999.9],
      ['abc', 0],
    ])('parses %s as %s', (raw, expected) => {
      expect(parseInputToNumber(raw as string)).toBeCloseTo(expected as number, 2);
    });

    it('ignores the minus sign unless negatives are allowed', () => {
      expect(parseInputToNumber('-1234')).toBeCloseTo(12.34, 2);
      expect(parseInputToNumber('-1234', true)).toBeCloseTo(-12.34, 2);
    });

    it('caps absurdly long input instead of overflowing', () => {
      expect(Number.isFinite(parseInputToNumber('9'.repeat(40)))).toBe(true);
    });
  });
});
