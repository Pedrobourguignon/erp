/**
 * Telefone, CEP e documento são opcionais em vários cadastros e a API devolve
 * `null` quando ausentes. Toda máscara aceita isso e devolve `""` — antes,
 * `maskPhone(null)` lançava TypeError e um único cliente sem telefone derrubava
 * a listagem de clientes inteira.
 */
type MaybeText = string | null | undefined;

/** Remove all non-digit characters */
export function unmask(value: MaybeText): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * Apply a mask pattern to a value.
 * '#' represents a digit placeholder.
 */
function applyMask(value: MaybeText, mask: string): string {
  const digits = unmask(value);
  let result = '';
  let digitIdx = 0;
  for (let i = 0; i < mask.length && digitIdx < digits.length; i++) {
    if (mask[i] === '#') {
      result += digits[digitIdx++];
    } else {
      result += mask[i];
    }
  }
  return result;
}

export function maskCPF(value: MaybeText): string {
  return applyMask(value, '###.###.###-##');
}

export function maskCNPJ(value: MaybeText): string {
  return applyMask(value, '##.###.###/####-##');
}

export function maskPhone(value: MaybeText): string {
  if (unmask(value).length <= 10) {
    return applyMask(value, '(##) ####-####');
  }
  return applyMask(value, '(##) #####-####');
}

export function maskCEP(value: MaybeText): string {
  return applyMask(value, '#####-###');
}

export function maskDocument(value: MaybeText, type: 'CPF' | 'CNPJ'): string {
  return type === 'CPF' ? maskCPF(value) : maskCNPJ(value);
}
