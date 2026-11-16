import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { SearchableSelectBase } from './searchable-select';

describe('SearchableSelectBase — selectedOption', () => {
  const loadOptions = async () => [{ value: 'c-1', label: 'Ana Souza' }];

  it('shows the label of a value that is not in the loaded list', () => {
    // Um cliente recém-cadastrado ainda não veio da busca: sem isto o campo
    // ficava selecionado, mas com o texto do placeholder.
    render(
      <SearchableSelectBase
        value="c-new"
        onChange={() => undefined}
        loadOptions={loadOptions}
        placeholder="Buscar cliente..."
        selectedOption={{ value: 'c-new', label: 'Maria Nova', description: '529.982.247-25' }}
      />,
    );

    expect(screen.getByRole('button', { name: /Maria Nova/ })).toBeTruthy();
    expect(screen.queryByText('Buscar cliente...')).toBeNull();
  });

  it('ignores selectedOption when it is not the selected value', () => {
    render(
      <SearchableSelectBase
        value=""
        onChange={() => undefined}
        loadOptions={loadOptions}
        placeholder="Buscar cliente..."
        selectedOption={{ value: 'c-new', label: 'Maria Nova' }}
      />,
    );

    expect(screen.getByText('Buscar cliente...')).toBeTruthy();
    expect(screen.queryByText('Maria Nova')).toBeNull();
  });
});
