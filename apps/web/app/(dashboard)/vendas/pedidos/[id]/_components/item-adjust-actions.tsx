"use client";

import { ArrowRightLeft, PackageX } from "lucide-react";

import { Can } from "@/components/auth/can";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { AdjustMode } from "@/lib/order-adjustment";

type ItemAdjustActionsProps = {
  /** Item vendido com tamanho/cor abre direto na troca de tamanho. */
  hasVariant: boolean;
  onPick: (mode: AdjustMode) => void;
};

export function ItemAdjustActions({ hasVariant, onPick }: ItemAdjustActionsProps) {
  return (
    <Can permission="orders:update" mode="disable">
      <div className="flex justify-end gap-1">
        {/* A tabela já tem sete colunas: abaixo de 2xl os botões ficam só com
            o ícone, e o nome vai no tooltip e no aria-label. */}
        <Tooltip content="Trocar tamanho ou produto">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Trocar"
            onClick={() => onPick(hasVariant ? "size" : "product")}
          >
            <ArrowRightLeft className="h-3.5 w-3.5 2xl:mr-1" />
            <span className="hidden 2xl:inline">Trocar</span>
          </Button>
        </Tooltip>
        <Tooltip content="Devolver sem troca">
          <Button variant="ghost" size="sm" aria-label="Devolver" onClick={() => onPick("return")}>
            <PackageX className="h-3.5 w-3.5 2xl:mr-1" />
            <span className="hidden 2xl:inline">Devolver</span>
          </Button>
        </Tooltip>
      </div>
    </Can>
  );
}
