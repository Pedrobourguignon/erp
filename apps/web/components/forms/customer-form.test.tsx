import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';

import { CustomerForm } from './customer-form';

function render(ui: React.ReactElement) {
  return rtlRender(
    <TooltipProvider>
      <Toaster>{ui}</Toaster>
    </TooltipProvider>,
  );
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText('Nome completo'), 'Maria Souza');
  await user.type(screen.getByPlaceholderText('(00) 00000-0000'), '11987654321');
}

const submit = () => screen.getByRole('button', { name: 'Salvar Cliente' });

describe('CustomerForm — CPF, e-mail e nascimento opcionais', () => {
  it('saves with only name and phone, sending "no value" as null', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CustomerForm mode="create" onSubmit={onSubmit} onCancel={() => undefined} />);

    await fillRequired(user);
    await user.click(submit());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Maria Souza',
      document: null,
      // sem documento não há tipo: a tela não pode "adivinhar" CPF
      documentType: null,
      email: null,
      birthDate: null,
    });
  });

  it('does not mark CPF or e-mail as required', () => {
    render(<CustomerForm mode="create" onSubmit={vi.fn()} onCancel={() => undefined} />);

    expect(screen.queryByText(/CPF \*/)).toBeNull();
    expect(screen.queryByText('E-mail *')).toBeNull();
    expect(screen.getByText('Nome *')).toBeTruthy();
    expect(screen.getByText('Telefone *')).toBeTruthy();
  });

  it('sends the birth date as YYYY-MM-DD, untouched', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<CustomerForm mode="create" onSubmit={onSubmit} onCancel={() => undefined} />);

    await fillRequired(user);
    await user.type(screen.getByLabelText('Data de nascimento'), '1990-05-20');
    await user.click(submit());

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].birthDate).toBe('1990-05-20');
  });

  it('still validates a CPF when one is typed', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CustomerForm mode="create" onSubmit={onSubmit} onCancel={() => undefined} />);

    await fillRequired(user);
    await user.type(screen.getByPlaceholderText('000.000.000-00'), '11111111111');
    await user.click(submit());

    // a mensagem aparece no campo e no aviso do formulário
    expect((await screen.findAllByText(/inválido/i)).length).toBeGreaterThan(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('still validates an e-mail when one is typed', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CustomerForm mode="create" onSubmit={onSubmit} onCancel={() => undefined} />);

    await fillRequired(user);
    await user.type(screen.getByPlaceholderText('email@exemplo.com'), 'sem-arroba');
    await user.click(submit());

    expect(await screen.findByText('E-mail inválido')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a birth date in the future', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CustomerForm mode="create" onSubmit={onSubmit} onCancel={() => undefined} />);

    await fillRequired(user);
    await user.type(screen.getByLabelText('Data de nascimento'), '2999-01-01');
    await user.click(submit());

    expect(
      await screen.findByText('A data de nascimento não pode ser no futuro'),
    ).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('still requires the name and the phone', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<CustomerForm mode="create" onSubmit={onSubmit} onCancel={() => undefined} />);

    await user.click(submit());

    expect(await screen.findByText('Nome deve ter pelo menos 3 caracteres')).toBeTruthy();
    expect(screen.getByText('Telefone é obrigatório')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('prefills a customer without document or e-mail on edit and keeps them blank', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <CustomerForm
        mode="edit"
        defaultValues={{ name: 'Maria Souza', phone: '(11) 98765-4321', document: '', email: '', birthDate: '' }}
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Salvar Alterações' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // `null` é o que apaga na API; "" seria recusado como e-mail.
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ document: null, email: null, birthDate: null });
  });
});

describe('CustomerForm embedded (modal)', () => {
  it('does not let the submit reach the sale form underneath', async () => {
    const saleSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    // O modal vive num portal, mas os eventos do React sobem pela árvore de
    // componentes: sem a trava, salvar o cliente também enviaria a venda.
    render(
      <form onSubmit={saleSubmit}>
        <CustomerForm mode="create" embedded onSubmit={onSubmit} onCancel={() => undefined} />
      </form>,
    );

    await fillRequired(user);
    await user.click(submit());

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(saleSubmit).not.toHaveBeenCalled();
  });

  it('drops the page card around the fields', () => {
    render(<CustomerForm mode="create" embedded onSubmit={vi.fn()} onCancel={() => undefined} />);

    expect(screen.queryByText('Dados do Cliente')).toBeNull();
  });

  it('keeps the card on the page', () => {
    render(<CustomerForm mode="create" onSubmit={vi.fn()} onCancel={() => undefined} />);

    expect(screen.getByText('Dados do Cliente')).toBeTruthy();
  });
});
