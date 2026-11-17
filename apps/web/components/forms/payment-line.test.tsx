import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect } from 'vitest';

import type { PaymentMethod } from '@/hooks/use-payment-methods';

import {
  requiresLinkedAccount,
  hasMissingAccount,
  installmentChoices,
  fitInstallments,
  InstallmentPreview,
} from './payment-line';

function makeMethod(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return {
    id: 'pm-1',
    name: 'Dinheiro',
    type: 'CASH',
    defaultAccountId: 'acc-1',
    feePercentage: 0,
    settlementDays: 0,
    autoSettle: false,
    requiresAuthorization: false,
    fiscalCode: null,
    maxInstallments: 1,
    isActive: true,
    ...overrides,
  };
}

describe('requiresLinkedAccount', () => {
  it.each(['CASH', 'PIX', 'DEBIT_CARD'] as const)(
    'should require an account for the immediate type %s',
    (type) => {
      expect(requiresLinkedAccount(type)).toBe(true);
    }
  );

  it.each(['CREDIT_CARD', 'BOLETO', 'BANK_TRANSFER', 'CHECK', 'STORE_CREDIT', 'OTHER'] as const)(
    'should NOT require an account for the term type %s',
    (type) => {
      expect(requiresLinkedAccount(type)).toBe(false);
    }
  );

  it('should not require an account when no method is selected', () => {
    expect(requiresLinkedAccount(null)).toBe(false);
  });
});

describe('hasMissingAccount', () => {
  const methods = [
    makeMethod({ id: 'pm-cash', type: 'CASH', defaultAccountId: null }),
    makeMethod({ id: 'pm-pix', type: 'PIX', defaultAccountId: 'acc-1' }),
    makeMethod({ id: 'pm-boleto', type: 'BOLETO', defaultAccountId: null }),
  ];

  it('should flag an immediate method with no linked account', () => {
    expect(
      hasMissingAccount([{ paymentMethodId: 'pm-cash' }], methods)
    ).toBe(true);
  });

  it('should accept an immediate method with a linked account', () => {
    expect(
      hasMissingAccount([{ paymentMethodId: 'pm-pix' }], methods)
    ).toBe(false);
  });

  it('should accept an immediate method whose account was chosen on the line', () => {
    expect(
      hasMissingAccount(
        [{ paymentMethodId: 'pm-cash', financialAccountId: 'acc-2' }],
        methods
      )
    ).toBe(false);
  });

  it('should NOT flag a term method without an account (it settles later)', () => {
    expect(
      hasMissingAccount([{ paymentMethodId: 'pm-boleto' }], methods)
    ).toBe(false);
  });

  it('should flag when any line among several is missing its account', () => {
    expect(
      hasMissingAccount(
        [{ paymentMethodId: 'pm-pix' }, { paymentMethodId: 'pm-cash' }],
        methods
      )
    ).toBe(true);
  });

  it('should ignore an empty line with no method selected', () => {
    expect(hasMissingAccount([{ paymentMethodId: '' }], methods)).toBe(false);
  });

  it('should handle an undefined payments list', () => {
    expect(hasMissingAccount(undefined, methods)).toBe(false);
  });
});

// O vendedor digita as parcelas na venda; o método diz até quantas aceita.
describe('installmentChoices', () => {
  it('offers 1x up to the maximum of the method', () => {
    expect(installmentChoices(makeMethod({ type: 'CREDIT_CARD', maxInstallments: 4 }))).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('offers nothing for a method that is not split', () => {
    expect(installmentChoices(makeMethod({ maxInstallments: 1 }))).toEqual([]);
  });

  it('offers nothing when no method is selected', () => {
    expect(installmentChoices(undefined)).toEqual([]);
  });
});

describe('fitInstallments', () => {
  it('keeps a number the new method still accepts', () => {
    expect(fitInstallments(3, makeMethod({ maxInstallments: 6 }))).toBe(3);
  });

  // Trocar de um cartão 12x (com 10x escolhido) para PIX não pode levar o 10x junto.
  it('falls back to 1x when the new method accepts fewer', () => {
    expect(fitInstallments(10, makeMethod({ maxInstallments: 6 }))).toBe(1);
    expect(fitInstallments(3, makeMethod({ maxInstallments: 1 }))).toBe(1);
  });

  it('treats an empty value as 1x', () => {
    expect(fitInstallments(undefined, makeMethod({ maxInstallments: 6 }))).toBe(1);
  });
});

describe('InstallmentPreview', () => {
  it('shows the same split the API will create, with the cent left on the last one', () => {
    render(<InstallmentPreview installments={3} amount={250} />);

    expect(screen.getByText(/3x de R\$\s?83,33/)).toBeInTheDocument();
    expect(screen.getByText(/última de R\$\s?83,34/)).toBeInTheDocument();
    expect(screen.getByText(/30\/60\/90 dias/)).toBeInTheDocument();
  });

  // O prazo vem da maquininha do cartão.
  it('follows the first transfer of the card machine', () => {
    render(
      <InstallmentPreview
        installments={3}
        amount={300}
        receipt={{ mode: 'FLOW', firstDays: 31 }}
      />
    );

    expect(screen.getByText(/31\/61\/91 dias/)).toBeInTheDocument();
  });

  it('tells that an anticipated machine pays it all at once', () => {
    render(
      <InstallmentPreview
        installments={3}
        amount={300}
        receipt={{ mode: 'ANTICIPATED', firstDays: 1 }}
      />
    );

    expect(screen.getByText(/3x de R\$\s?100,00/)).toBeInTheDocument();
    expect(screen.getByText(/cai tudo em 1 dia/)).toBeInTheDocument();
  });

  it('shows nothing for a single installment', () => {
    const { container } = render(<InstallmentPreview installments={1} amount={250} />);

    expect(container).toBeEmptyDOMElement();
  });
});

