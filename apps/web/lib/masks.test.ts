import { describe, it, expect } from 'vitest';

import { maskCEP, maskCNPJ, maskCPF, maskDocument, maskPhone, unmask } from './masks';

describe('masks', () => {
  it.each([
    ['maskCPF', () => maskCPF('52998224725'), '529.982.247-25'],
    ['maskCNPJ', () => maskCNPJ('11222333000181'), '11.222.333/0001-81'],
    ['maskPhone fixo', () => maskPhone('1133334444'), '(11) 3333-4444'],
    ['maskPhone celular', () => maskPhone('11988887777'), '(11) 98888-7777'],
    ['maskCEP', () => maskCEP('01310100'), '01310-100'],
    ['maskDocument CPF', () => maskDocument('52998224725', 'CPF'), '529.982.247-25'],
    ['unmask', () => unmask('(11) 98888-7777'), '11988887777'],
  ])('%s formata', (_name, run, expected) => {
    expect(run()).toBe(expected);
  });

  // Telefone, CEP e documento são opcionais no cadastro e a API devolve `null`.
  // `maskPhone(null)` lançava TypeError e derrubava a listagem de clientes
  // inteira por causa de um único cliente sem telefone.
  describe.each([null, undefined])('com %p', (empty) => {
    it.each([
      ['maskCPF', () => maskCPF(empty)],
      ['maskCNPJ', () => maskCNPJ(empty)],
      ['maskPhone', () => maskPhone(empty)],
      ['maskCEP', () => maskCEP(empty)],
      ['maskDocument', () => maskDocument(empty, 'CPF')],
      ['unmask', () => unmask(empty)],
    ])('%s devolve string vazia em vez de lançar', (_name, run) => {
      expect(run()).toBe('');
    });
  });
});
