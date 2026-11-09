import { settlesAtSale } from './payment.constants';

describe('settlesAtSale', () => {
  it.each([
    ['CASH', null, true],
    ['PIX', undefined, true],
    ['PIX', 0, true],
    ['DEBIT_CARD', 0, true],
    // The method says the money arrives later: it is not in the account yet.
    ['DEBIT_CARD', 1, false],
    ['PIX', 2, false],
    ['CREDIT_CARD', 0, false],
    ['BOLETO', null, false],
  ])('should answer %s with %s settlement days as %s', (type, days, expected) => {
    expect(settlesAtSale(type, days)).toBe(expected);
  });
});
