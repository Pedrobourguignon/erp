import { describe, it, expect } from 'vitest';

import type { PaymentCondition } from '@/hooks/use-payment-conditions';
import type { PaymentMethod } from '@/hooks/use-payment-methods';

import {
  requiresLinkedAccount,
  hasMissingAccount,
  filterConditionsForMethod,
} from './payment-line';

function makeCondition(overrides: Partial<PaymentCondition> = {}): PaymentCondition {
  return {
    id: 'pc-1',
    name: 'A Vista',
    code: 'AV',
    type: 'CASH',
    installments: 1,
    daysBetweenInstallments: 0,
    entryPercentage: 0,
    isActive: true,
    paymentMethodIds: [],
    ...overrides,
  };
}

function makeMethod(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return {
    id: 'pm-1',
    name: 'Dinheiro',
    type: 'CASH',
    defaultAccountId: 'acc-1',
    feePercentage: 0,
    settlementDays: 0,
    requiresAuthorization: false,
    fiscalCode: null,
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

describe('filterConditionsForMethod', () => {
  const unlinked = makeCondition({ id: 'pc-avista', paymentMethodIds: [] });
  const linkedToCard = makeCondition({
    id: 'pc-12x',
    name: '12x sem juros',
    paymentMethodIds: ['pm-card'],
  });
  const linkedToBoleto = makeCondition({
    id: 'pc-boleto-30',
    name: 'Boleto 30 dias',
    paymentMethodIds: ['pm-boleto'],
  });
  const conditions = [unlinked, linkedToCard, linkedToBoleto];

  it('keeps every condition when no method is selected', () => {
    expect(filterConditionsForMethod(conditions, undefined)).toEqual(conditions);
  });

  it('shows an unlinked condition for any method', () => {
    expect(filterConditionsForMethod([unlinked], 'pm-card')).toEqual([unlinked]);
    expect(filterConditionsForMethod([unlinked], 'pm-boleto')).toEqual([unlinked]);
  });

  it('shows only the conditions linked to the selected method, plus the unlinked ones', () => {
    expect(filterConditionsForMethod(conditions, 'pm-card')).toEqual([
      unlinked,
      linkedToCard,
    ]);
  });

  it('hides a condition linked to a different method', () => {
    const result = filterConditionsForMethod(conditions, 'pm-card');
    expect(result).not.toContainEqual(linkedToBoleto);
  });

  it('hides every linked condition when the method matches none of them', () => {
    expect(filterConditionsForMethod(conditions, 'pm-pix')).toEqual([unlinked]);
  });
});
