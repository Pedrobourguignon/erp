"use client";

import { Loader2, Upload, FileText, CheckCircle2, AlertTriangle, Download, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import {
  useUploadImport,
  useImportJob,
  type ImportDomain,
  type ImportStatus,
} from "@/hooks/use-imports";
import { buildReportCsv, groupWarnings, splitIssues } from "@/lib/import-report";
import { getMutationErrorMessage } from "@/lib/mutation-error";

const COLUMNS: Record<ImportDomain, string> = {
  products:
    "CSV: sku, name, salePrice, costPrice, description, ncm, ean. Planilha (.xlsx): colunas NOME e VALOR DE VENDA (obrigatórias), mais VALOR DE CUSTO, ESTOQUE, CÓDIGO DE BARRAS, NCM, CFOP SAIDA, GRUPO e CATEGORIA.",
  customers: "name, email, phone, document",
  expenses: "description, amount, dueDate",
};

/** Products also take the spreadsheet export; the other domains are CSV only. */
const ACCEPT: Record<ImportDomain, string> = {
  products: ".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  customers: ".csv,text/csv",
  expenses: ".csv,text/csv",
};

const FORMAT_HINT: Record<ImportDomain, string> = {
  products: "um arquivo CSV ou uma planilha do Excel (.xlsx)",
  customers: "um arquivo CSV",
  expenses: "um arquivo CSV",
};

const STATUS_META: Record<ImportStatus, { label: string; variant: "default" | "success" | "warning" | "destructive" | "secondary" }> = {
  PENDING: { label: "Na fila", variant: "secondary" },
  PROCESSING: { label: "Processando", variant: "warning" },
  COMPLETED: { label: "Concluído", variant: "success" },
  COMPLETED_WITH_ERRORS: { label: "Concluído com erros", variant: "warning" },
  FAILED: { label: "Falhou", variant: "destructive" },
};

type ImportCsvDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  domain: ImportDomain;
  title: string;
  onCompleted?: () => void;
};

export function ImportCsvDialog({ open, onOpenChange, domain, title, onCompleted }: ImportCsvDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadImport();
  const { addToast } = useToast();
  const [jobId, setJobId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const { data: job } = useImportJob(jobId);
  const report = splitIssues(job?.errors);
  const warningGroups = groupWarnings(report.warnings);

  const downloadReport = () => {
    const blob = new Blob([buildReportCsv(job?.errors ?? [])], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const baseName = (job?.fileName ?? "arquivo")
      .replace(/\.[^.]+$/, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    link.download = `relatorio-importacao-${baseName || "arquivo"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (open) {
      setJobId(null);
      setFileName(null);
    }
  }, [open]);

  const isDone =
    job && ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"].includes(job.status);

  useEffect(() => {
    if (isDone) {onCompleted?.();}
  }, [isDone, onCompleted]);

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setFileName(file.name);
    try {
      const created = await upload.mutateAsync({ domain, file });
      setJobId(created.id);
      addToast("Arquivo enviado! Processando em segundo plano.", "success");
    } catch (error) {
      addToast(
        getMutationErrorMessage(
          error,
          error instanceof Error ? error.message : "Erro ao enviar arquivo."
        ),
        "error"
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Envie {FORMAT_HINT[domain]}. O processamento ocorre em segundo plano e cada
            linha é validada individualmente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <span className="font-medium">Colunas esperadas:</span> {COLUMNS[domain]}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT[domain]}
            className="hidden"
            onChange={handleFile}
          />
          {!jobId && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => inputRef.current?.click()}
              disabled={upload.isPending}
            >
              {upload.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Selecionar arquivo
            </Button>
          )}

          {job ? <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{fileName ?? job.fileName}</span>
                </div>
                <Badge variant={STATUS_META[job.status].variant}>
                  {STATUS_META[job.status].label}
                </Badge>
              </div>

              {isDone ? <div className={`grid gap-2 text-center text-sm ${report.warnings.length > 0 ? "grid-cols-4" : "grid-cols-3"}`}>
                  <div className="rounded-lg border p-2">
                    <p className="text-xs text-muted-foreground">Linhas</p>
                    <p className="font-bold">{job.totalRows}</p>
                  </div>
                  <div className="rounded-lg border p-2">
                    <p className="text-xs text-muted-foreground">Importadas</p>
                    <p className="font-bold text-emerald-600">{job.successRows}</p>
                  </div>
                  <div className="rounded-lg border p-2">
                    <p className="text-xs text-muted-foreground">Com erro</p>
                    <p className="font-bold text-destructive">{job.errorRows}</p>
                  </div>
                  {report.warnings.length > 0 ? <div className="rounded-lg border p-2">
                      <p className="text-xs text-muted-foreground">Avisos</p>
                      <p className="font-bold text-amber-600">{report.warnings.length}</p>
                    </div> : null}
                </div> : null}

              {isDone && job.errorRows === 0 ? <p className="flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> {report.warnings.length > 0
                    ? "Importação concluída. Nenhuma linha foi rejeitada."
                    : "Importação concluída sem erros."}
                </p> : null}

              {report.notes.map((note, i) => (
                <p key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {note.message}
                </p>
              ))}

              {warningGroups.length > 0 ? <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 text-xs dark:bg-amber-950/20">
                  <p className="mb-2 flex items-center gap-1.5 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    Importados com ajustes — confira o relatório
                  </p>
                  <ul className="space-y-1">
                    {warningGroups.map((group) => (
                      <li key={group.code} className="flex justify-between gap-3">
                        <span>{group.label}</span>
                        <span className="tabular-nums font-medium">{group.count}</span>
                      </li>
                    ))}
                  </ul>
                </div> : null}

              {report.errors.length > 0 ? <div className="max-h-48 overflow-y-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 border-b bg-muted/60">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Linha</th>
                        <th className="px-3 py-2 text-left font-medium">Erro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.errors.map((err, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-1.5 tabular-nums">{err.line}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3 text-destructive" />
                              {err.message}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div> : null}
            </div> : null}
        </div>

        <DialogFooter>
          {isDone && (job?.errors?.length ?? 0) > 0 ? (
            <Button type="button" variant="outline" onClick={downloadReport}>
              <Download className="mr-2 h-4 w-4" />
              Baixar relatório
            </Button>
          ) : null}
          <Button type="button" variant="cancel" onClick={() => onOpenChange(false)}>
            {isDone ? "Fechar" : "Cancelar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
