import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { CreditRatesField } from './credit-rates-field';

const rates = (n: number, fee = 0) =>
  Array.from({ length: n }, (_, i) => ({ installments: i + 1, feePercentage: fee }));

describe('CreditRatesField', () => {
  // O screenshot pegou o "Até" preso em 1 depois de subir o máximo para 12.
  it('the range "Até" follows the maximum when the table grows', () => {
    const { rerender } = render(<CreditRatesField rates={rates(2)} onChange={() => {}} />);
    expect(screen.getByLabelText('Até')).toHaveValue(2);

    rerender(<CreditRatesField rates={rates(12)} onChange={() => {}} />);

    expect(screen.getByLabelText('Até')).toHaveValue(12);
  });

  it('applies the rate to the chosen range only', () => {
    const onChange = vi.fn();
    render(<CreditRatesField rates={rates(4, 3)} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Taxa (%)'), { target: { value: '4,99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(onChange).toHaveBeenCalledWith([
      { installments: 1, feePercentage: 3 },
      { installments: 2, feePercentage: 4.99 },
      { installments: 3, feePercentage: 4.99 },
      { installments: 4, feePercentage: 3 },
    ]);
  });

  it('ignores an invalid rate in the range', () => {
    const onChange = vi.fn();
    render(<CreditRatesField rates={rates(3)} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Taxa (%)'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('labels the first row as the cash price', () => {
    render(<CreditRatesField rates={rates(2)} onChange={() => {}} />);

    expect(screen.getByLabelText('À vista (1x)')).toBeInTheDocument();
    expect(screen.getByLabelText('2x')).toBeInTheDocument();
  });
});
