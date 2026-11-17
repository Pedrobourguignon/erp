"use client";

import type { ProductLookupResult, SaleCandidate } from "@erp/shared-types";
import { useCallback, useState } from "react";

import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { getMutationErrorMessage } from "@/lib/mutation-error";
import { lookupForSale, lookupProductCode } from "@/lib/product-lookup";
import { playScanSound, scanSoundEnabled, setScanSoundEnabled } from "@/lib/scan-sound";

export interface ScanNotice {
  code: string;
  message: string;
}

export interface VariantPicker {
  productName: string;
  variants: SaleCandidate[];
}

interface UseCartScannerOptions {
  /** A product or variant to put in the cart. */
  onCandidate: (candidate: SaleCandidate) => void;
  /** Off while something else owns the keyboard. */
  enabled?: boolean;
}

/**
 * The barcode reader on a cart screen: what was read goes through the exact
 * lookup and lands in the cart, asks for the size/colour, or raises a warning
 * that stays until the next good read — with a beep, because the operator is
 * looking at the customer, not at the screen.
 */
export function useCartScanner({ onCandidate, enabled = true }: UseCartScannerOptions) {
  const [notice, setNotice] = useState<ScanNotice | null>(null);
  const [picker, setPicker] = useState<VariantPicker | null>(null);
  const [soundOn, setSoundState] = useState(scanSoundEnabled);

  const beep = useCallback(
    (kind: "ok" | "error") => {
      if (soundOn) {playScanSound(kind);}
    },
    [soundOn]
  );

  const settle = useCallback(
    (result: Exclude<ProductLookupResult, { kind: "NOT_FOUND" }>) => {
      setNotice(null);
      beep("ok");
      if (result.kind === "MATCH") {
        onCandidate(result.item);
      } else {
        setPicker({ productName: result.productName, variants: result.variants });
      }
    },
    [beep, onCandidate]
  );

  const handleCode = useCallback(
    async (code: string) => {
      try {
        const result = await lookupProductCode(code);
        if (result.kind === "NOT_FOUND") {
          beep("error");
          setNotice({ code, message: result.message });
          return;
        }
        settle(result);
      } catch (error) {
        beep("error");
        setNotice({ code, message: getMutationErrorMessage(error, `Não foi possível ler o código ${code}.`) });
      }
    },
    [beep, settle]
  );

  /** A product picked by name: straight to the cart, or the size/colour first. */
  const pickProduct = useCallback(
    async (productId: string) => {
      try {
        const result = await lookupForSale(productId);
        setNotice(null);
        if (result.kind === "MATCH") {
          onCandidate(result.item);
        } else if (result.kind === "CHOOSE_VARIANT") {
          setPicker({ productName: result.productName, variants: result.variants });
        }
      } catch (error) {
        setNotice({ code: "", message: getMutationErrorMessage(error, "Não foi possível adicionar o produto.") });
      }
    },
    [onCandidate]
  );

  const pickVariant = useCallback(
    (candidate: SaleCandidate) => {
      setPicker(null);
      onCandidate(candidate);
    },
    [onCandidate]
  );

  const setSoundOn = useCallback((on: boolean) => {
    setSoundState(on);
    setScanSoundEnabled(on);
  }, []);

  useBarcodeScanner({ onScan: (code) => void handleCode(code), enabled: enabled && picker === null });

  return {
    handleCode,
    pickProduct,
    pickVariant,
    closePicker: () => setPicker(null),
    picker,
    notice,
    dismissNotice: () => setNotice(null),
    soundOn,
    setSoundOn,
  };
}
