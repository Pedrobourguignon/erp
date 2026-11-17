"use client";

import { useEffect, useRef } from "react";

import { BarcodeBurst, type BarcodeBurstOptions } from "@/lib/barcode-burst";

interface UseBarcodeScannerOptions extends BarcodeBurstOptions {
  onScan: (code: string) => void;
  /** Off while a dialog owns the keyboard. */
  enabled?: boolean;
  /** Clock in ms; injectable for tests. Defaults to the key event's own timestamp. */
  now?: () => number;
}

type Editable = HTMLInputElement | HTMLTextAreaElement;

function isEditable(el: Element | null): el is Editable {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

/**
 * Puts the field back as it was, through the native setter so React (and
 * react-hook-form) see the change.
 */
function restoreValue(el: Editable, value: string): void {
  if (el.value === value) {return;}
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Reads the barcode reader anywhere on the page.
 *
 * The reader types into whatever field has the cursor — quantity, discount,
 * the amount received — and its Enter would submit the form. Listening on the
 * window, in the capture phase, a burst is recognised at its Enter before any
 * field reacts: the Enter is swallowed, the focused field gets its value back,
 * and the code goes to `onScan`. A person typing is left alone.
 */
export function useBarcodeScanner({ onScan, enabled = true, now, ...burstOptions }: UseBarcodeScannerOptions) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const clockRef = useRef(now);
  clockRef.current = now;
  const { avgGapMs, maxGapMs, minLength } = burstOptions;

  useEffect(() => {
    if (!enabled) {return;}
    const burst = new BarcodeBurst({ avgGapMs, maxGapMs, minLength });
    let snapshot: { el: Editable; value: string } | null = null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {return;}
      // When the key was generated, not when the page got to it: a busy page
      // delivers a fast read late and in a lump, but its timestamps stay close.
      const at = clockRef.current ? clockRef.current() : event.timeStamp;
      const code = burst.push(event.key, at);

      if (code) {
        event.preventDefault();
        event.stopPropagation();
        if (snapshot) {restoreValue(snapshot.el, snapshot.value);}
        snapshot = null;
        onScanRef.current(code);
        return;
      }
      // First key of a possible read: remember the field before it changes.
      // Keys are never held back — without the closing Enter nobody can tell
      // a read from fast typing, and a swallowed key is worse than a field
      // that gets its value back.
      if (event.key.length === 1 && burst.length === 1) {
        const active = document.activeElement;
        snapshot = isEditable(active) ? { el: active, value: active.value } : null;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, avgGapMs, maxGapMs, minLength]);
}
