import { describe, it, expect } from "vitest";

import { hasLineWithoutMethod, settlePayments } from "./payment-settlement";

const cash = (amount: number) => ({ amount, isCash: true });
const card = (amount: number) => ({ amount, isCash: false });

describe("settlePayments", () => {
  it("should charge an exact cash payment in full with no change", () => {
    const result = settlePayments([cash(199.8)], 199.8);

    expect(result).toEqual({
      applied: [199.8],
      change: 0,
      missing: 0,
      isSettled: true,
    });
  });

  // VD-08: this is the case the PDV blocked in silence.
  it("should accept cash above the total and return the change", () => {
    const result = settlePayments([cash(250)], 199.8);

    expect(result.applied).toEqual([199.8]);
    expect(result.change).toBe(50.2);
    expect(result.isSettled).toBe(true);
  });

  it("should report what is still missing", () => {
    const result = settlePayments([cash(100)], 199.8);

    expect(result.missing).toBe(99.8);
    expect(result.isSettled).toBe(false);
  });

  it("should let cash cover the remainder of a card payment", () => {
    const result = settlePayments([card(100), cash(150)], 199.8);

    expect(result.applied).toEqual([100, 99.8]);
    expect(result.change).toBe(50.2);
    expect(result.isSettled).toBe(true);
  });

  it("should refuse a card payment above the total", () => {
    const result = settlePayments([card(250)], 199.8);

    expect(result.isSettled).toBe(false);
    expect(result.change).toBe(0);
  });

  it("should never charge more than the total across several cash lines", () => {
    const result = settlePayments([cash(150), cash(150)], 199.8);

    expect(result.applied).toEqual([150, 49.8]);
    expect(result.change).toBe(100.2);
    expect(result.applied.reduce((a, b) => a + b, 0)).toBeCloseTo(199.8, 2);
  });

  it("should treat an empty payment list as unsettled", () => {
    expect(settlePayments([], 199.8).isSettled).toBe(false);
  });
});

describe("hasLineWithoutMethod", () => {
  it("should be false when there are no payment lines", () => {
    expect(hasLineWithoutMethod(undefined)).toBe(false);
    expect(hasLineWithoutMethod([])).toBe(false);
  });

  it("should flag a line whose method was never picked", () => {
    expect(
      hasLineWithoutMethod([{ paymentMethodId: "pm-1" }, { paymentMethodId: "" }])
    ).toBe(true);
  });

  it("should be false when every line has a method", () => {
    expect(hasLineWithoutMethod([{ paymentMethodId: "pm-1" }])).toBe(false);
  });
});
