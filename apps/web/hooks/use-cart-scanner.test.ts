import type { ProductLookupResult, SaleCandidate } from "@erp/shared-types";
import { act, renderHook } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ScanSound from "@/lib/scan-sound";

const lookupProductCode = vi.fn();
const lookupForSale = vi.fn();
const playScanSound = vi.fn();

vi.mock("@/lib/product-lookup", () => ({
  lookupProductCode: (code: string) => lookupProductCode(code),
  lookupForSale: (p: string, v?: string) => lookupForSale(p, v),
}));
vi.mock("@/lib/scan-sound", async (importOriginal) => ({
  ...(await importOriginal<typeof ScanSound>()),
  playScanSound: (kind: string) => playScanSound(kind),
}));

import { useCartScanner } from "./use-cart-scanner";

const tee: SaleCandidate = {
  productId: "prod-cam",
  variantId: "var-m",
  name: "Camiseta Básica — M",
  sku: "CAM-M",
  ean: "7891000000017",
  salePrice: 59.9,
  available: 6,
};
const choose: ProductLookupResult = {
  kind: "CHOOSE_VARIANT",
  productId: "prod-cam",
  productName: "Camiseta Básica",
  variants: [tee, { ...tee, variantId: "var-p", name: "Camiseta Básica — P" }],
};
const notFound = new AxiosError("Not Found", "404", undefined, undefined, {
  status: 404,
  data: { message: "Nenhum produto com o código 0001" },
} as AxiosResponse);

function setup() {
  const onCandidate = vi.fn();
  const hook = renderHook(() => useCartScanner({ onCandidate }));
  return { onCandidate, hook };
}

describe("useCartScanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { window.localStorage.clear(); } catch { /* sem storage */ }
  });

  it("puts what was read in the cart and beeps", async () => {
    lookupProductCode.mockResolvedValue({ kind: "MATCH", item: tee });
    const { onCandidate, hook } = setup();

    await act(() => hook.result.current.handleCode("7891000000017"));

    expect(onCandidate).toHaveBeenCalledWith(tee);
    expect(playScanSound).toHaveBeenCalledWith("ok");
    expect(hook.result.current.notice).toBeNull();
  });

  it("asks for the size when the code is of a product with variants", async () => {
    lookupProductCode.mockResolvedValue(choose);
    const { onCandidate, hook } = setup();

    await act(() => hook.result.current.handleCode("CAM"));

    expect(onCandidate).not.toHaveBeenCalled();
    expect(hook.result.current.picker).toEqual({ productName: "Camiseta Básica", variants: choose.variants });

    act(() => hook.result.current.pickVariant(choose.variants[1]));

    expect(onCandidate).toHaveBeenCalledWith(choose.variants[1]);
    expect(hook.result.current.picker).toBeNull();
  });

  it("warns, with the code and a low beep, when nothing has that code", async () => {
    lookupProductCode.mockResolvedValue({
      kind: "NOT_FOUND",
      code: "0001",
      message: "Nenhum produto com o código 0001",
    });
    const { onCandidate, hook } = setup();

    await act(() => hook.result.current.handleCode("0001"));

    expect(onCandidate).not.toHaveBeenCalled();
    expect(playScanSound).toHaveBeenCalledWith("error");
    expect(hook.result.current.notice).toEqual({ code: "0001", message: "Nenhum produto com o código 0001" });
  });

  it("warns with the reason the API gave when the read fails (e.g. two products on one code)", async () => {
    lookupProductCode.mockRejectedValue(notFound);
    const { hook } = setup();

    await act(() => hook.result.current.handleCode("0001"));

    expect(playScanSound).toHaveBeenCalledWith("error");
    expect(hook.result.current.notice?.message).toBe("Nenhum produto com o código 0001");
  });

  it("clears the warning on the next good read", async () => {
    lookupProductCode.mockRejectedValueOnce(notFound).mockResolvedValueOnce({ kind: "MATCH", item: tee });
    const { hook } = setup();

    await act(() => hook.result.current.handleCode("0001"));
    await act(() => hook.result.current.handleCode("7891000000017"));

    expect(hook.result.current.notice).toBeNull();
  });

  it("opens the size choice for a product picked by name", async () => {
    lookupForSale.mockResolvedValue(choose);
    const { hook } = setup();

    await act(() => hook.result.current.pickProduct("prod-cam"));

    expect(lookupForSale).toHaveBeenCalledWith("prod-cam", undefined);
    expect(hook.result.current.picker?.variants).toHaveLength(2);
  });

  it("stays quiet when the operator turned the sound off, and remembers it", async () => {
    lookupProductCode.mockResolvedValue({ kind: "MATCH", item: tee });
    const { hook } = setup();

    act(() => hook.result.current.setSoundOn(false));
    await act(() => hook.result.current.handleCode("7891000000017"));

    expect(playScanSound).not.toHaveBeenCalled();
    expect(renderHook(() => useCartScanner({ onCandidate: vi.fn() })).result.current.soundOn).toBe(false);
  });
});
