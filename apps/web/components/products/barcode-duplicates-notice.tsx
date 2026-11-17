"use client";

import { ScanBarcode } from "lucide-react";
import Link from "next/link";
import React, { useState } from "react";

import { Button } from "@/components/ui/button";
import { useBarcodeDuplicates } from "@/hooks/use-barcode-duplicates";
import { pluralize } from "@/lib/utils";

/**
 * Two registrations on the same barcode stop the reader at the counter ("está
 * em mais de um produto"). The list says which ones, with a link to fix each.
 */
export function BarcodeDuplicatesNotice() {
  const { data } = useBarcodeDuplicates();
  const [open, setOpen] = useState(false);
  const duplicates = data ?? [];
  if (duplicates.length === 0) {return null;}

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <div className="flex flex-wrap items-center gap-2">
        <ScanBarcode className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1">
          <span className="font-semibold">{pluralize(duplicates.length, "código de barras repetido", "códigos de barras repetidos")}</span>
          {" — "}o leitor do balcão não sabe qual produto vender. Deixe cada código em um só cadastro.
        </p>
        <Button type="button" variant="outline" size="sm" aria-expanded={open}
          aria-label={open ? "Ocultar códigos repetidos" : "Ver códigos repetidos"}
          onClick={() => setOpen((o) => !o)}>
          {open ? "Ocultar" : "Ver"}
        </Button>
      </div>
      {open ? (
        <ul className="mt-3 space-y-2">
          {duplicates.map((group) => (
            <li key={group.ean} className="rounded-md bg-background/60 p-2">
              <p className="font-mono text-xs font-semibold">{group.ean}</p>
              <ul className="mt-1 space-y-0.5">
                {group.owners.map((owner) => (
                  <li key={`${owner.productId}-${owner.variantId ?? ""}`} className="min-w-0">
                    <Link href={`/estoque/produtos/${owner.productId}`} className="break-words underline underline-offset-2 hover:no-underline">
                      {owner.name}
                    </Link>
                    <span className="text-xs opacity-75"> · {owner.sku}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
