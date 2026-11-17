import type { OrderAdjustment } from '@erp/shared-types';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/receipts/print-receipt-button', () => ({
  PrintReceiptButton: (props: { orderId: string; adjustmentId?: string; label?: string }) => (
    <button type="button" data-order={props.orderId} data-adjustment={props.adjustmentId}>
      {props.label}
    </button>
  ),
}));

import { AdjustmentsList } from './adjustments-list';

function makeAdjustment(overrides: Partial<OrderAdjustment> = {}): OrderAdjustment {
  return {
    id: 'adj-1',
    type: 'EXCHANGE',
    quantity: 1,
    returnedName: 'Camiseta P',
    returnedSku: 'CAM-P',
    returnedValue: 95,
    newName: 'Camiseta M',
    newSku: 'CAM-M',
    newValue: 120,
    difference: 25,
    abatedAmount: 0,
    receivableId: null,
    payableId: null,
    reason: null,
    createdAt: '2026-11-20T15:00:00.000Z',
    ...overrides,
  };
}

describe('AdjustmentsList', () => {
  it('lets the seller print the receipt of each exchange', () => {
    render(
      <AdjustmentsList
        orderId="order-1"
        adjustments={[makeAdjustment(), makeAdjustment({ id: 'adj-2', type: 'RETURN', newName: null })]}
      />
    );

    const buttons = screen.getAllByRole('button', { name: 'Imprimir comprovante' });
    expect(buttons.map((b) => b.dataset.adjustment)).toEqual(['adj-1', 'adj-2']);
    expect(buttons.every((b) => b.dataset.order === 'order-1')).toBe(true);
  });
});
