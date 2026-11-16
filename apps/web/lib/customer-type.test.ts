import { describe, expect, it } from 'vitest';

import { customerTypeLabel } from './customer-type';

describe('customerTypeLabel', () => {
  it.each([
    ['CPF', 'Pessoa Física'],
    ['CNPJ', 'Pessoa Jurídica'],
  ] as const)('names %s', (type, label) => {
    expect(customerTypeLabel(type)).toBe(label);
  });

  // CPF/CNPJ são opcionais: sem documento não há como saber o tipo, e dizer
  // "Pessoa Jurídica" (o que a tela fazia para tudo que não fosse CPF) é errado.
  it.each([[null], [undefined], ['']])(
    'does not guess a type when there is no document (%s)',
    (type) => {
      expect(customerTypeLabel(type)).toBe('Sem documento');
    },
  );
});
