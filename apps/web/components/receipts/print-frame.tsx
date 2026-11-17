"use client";

import type { ReceiptFormat } from "@erp/shared-types";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { printWindow } from "@/lib/print-window";
import { pxToMm, receiptPageCss } from "@/lib/receipt-format";

const STYLE_TIMEOUT_MS = 2000;

/** Copies the page styles into the frame, so the receipt keeps its classes. */
function copyStyles(target: Document): Promise<void> {
  const loads: Promise<void>[] = [];
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    const clone = node.cloneNode(true) as HTMLElement;
    if (clone instanceof HTMLLinkElement) {
      loads.push(new Promise((resolve) => {
        clone.onload = () => resolve();
        clone.onerror = () => resolve();
      }));
    }
    target.head.appendChild(clone);
  });
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, STYLE_TIMEOUT_MS));
  return Promise.race([Promise.all(loads).then(() => undefined), timeout]);
}

/**
 * Prints `children` from a hidden iframe: the seller never leaves the screen
 * and the rest of the page does not go to paper. Calls `onDone` once the print
 * dialog closes (printed or cancelled).
 */
export function PrintFrame({ format, children, onDone }: {
  format: ReceiptFormat;
  children: React.ReactNode;
  onDone: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);
  const [stylesReady, setStylesReady] = useState(false);

  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) {return;}
    setMountNode(doc.body);
    let active = true;
    void copyStyles(doc).then(() => {
      if (active) {setStylesReady(true);}
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const win = frameRef.current?.contentWindow;
    const doc = frameRef.current?.contentDocument;
    if (!stylesReady || !win || !doc) {return;}
    // Let the portal paint with the copied styles, then cut the page to the
    // receipt: a thermal roll has no fixed length.
    const id = requestAnimationFrame(() => {
      const receipt = doc.body.firstElementChild;
      const height = receipt ? pxToMm(receipt.getBoundingClientRect().height) : 0;
      const page = doc.createElement("style");
      page.textContent = receiptPageCss(format, height);
      doc.head.appendChild(page);
      printWindow(win);
      onDone();
    });
    return () => cancelAnimationFrame(id);
  }, [stylesReady, format, onDone]);

  return (
    <iframe
      ref={frameRef}
      title="Recibo para impressão"
      aria-hidden
      tabIndex={-1}
      className="pointer-events-none fixed left-0 top-0 h-0 w-0 border-0 opacity-0"
    >
      {mountNode ? createPortal(children, mountNode) : null}
    </iframe>
  );
}
