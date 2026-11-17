import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateTenant = vi.fn();
const addToast = vi.fn();
let tenant: Record<string, unknown> | undefined;

vi.mock('@/hooks/use-tenant', () => ({
  useTenant: () => ({ data: tenant, isLoading: false, isError: false, error: null }),
  useUpdateTenant: () => ({ mutateAsync: updateTenant, isPending: false }),
}));

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: () => true, isLoaded: true }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ addToast }),
}));

import { ReceiptSettingsTab } from './receipt-settings-tab';

describe('ReceiptSettingsTab', () => {
  beforeEach(() => {
    updateTenant.mockReset().mockResolvedValue({});
    addToast.mockReset();
    tenant = { receiptFormat: 'THERMAL_80', receiptFooter: null };
  });

  it('starts on the format the store already uses', () => {
    tenant = { receiptFormat: 'A4', receiptFooter: 'Volte sempre' };
    render(<ReceiptSettingsTab />);

    expect(screen.getByRole('radio', { name: /Folha A4/ })).toBeChecked();
    expect(screen.getByLabelText(/Rodapé do recibo/)).toHaveValue('Volte sempre');
  });

  it('offers the three printer formats', () => {
    render(<ReceiptSettingsTab />);

    expect(screen.getByRole('radio', { name: /Térmica 80 mm/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Térmica 58 mm/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Folha A4/ })).not.toBeChecked();
  });

  it('saves the chosen format and footer', async () => {
    render(<ReceiptSettingsTab />);

    fireEvent.click(screen.getByRole('radio', { name: /Térmica 58 mm/ }));
    fireEvent.change(screen.getByLabelText(/Rodapé do recibo/), {
      target: { value: 'Trocas em até 30 dias.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }));

    await waitFor(() =>
      expect(updateTenant).toHaveBeenCalledWith({
        receiptFormat: 'THERMAL_58',
        receiptFooter: 'Trocas em até 30 dias.',
      }),
    );
    expect(addToast).toHaveBeenCalledWith('Configurações do recibo salvas!', 'success');
  });

  it('refuses a footer longer than the column', async () => {
    render(<ReceiptSettingsTab />);

    fireEvent.change(screen.getByLabelText(/Rodapé do recibo/), {
      target: { value: 'x'.repeat(301) },
    });
    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }));

    expect(await screen.findByText('O rodapé tem no máximo 300 caracteres')).toBeInTheDocument();
    expect(updateTenant).not.toHaveBeenCalled();
  });
});
