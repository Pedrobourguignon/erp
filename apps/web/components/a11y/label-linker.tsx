"use client";

import { useEffect } from "react";

import { linkOrphanLabels } from "@/lib/link-orphan-labels";

/**
 * Keeps `linkOrphanLabels` running as screens and dialogs mount. Renders
 * nothing.
 */
export function LabelLinker() {
  useEffect(() => {
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => linkOrphanLabels(document.body));
    };

    run();
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return null;
}
