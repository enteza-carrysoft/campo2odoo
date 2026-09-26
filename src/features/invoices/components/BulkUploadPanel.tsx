"use client";

import { FileText, X, Zap } from "lucide-react";
import { cx } from "@/shared/styles";
import type { InvoiceFile } from "@/shared/types";
import { UploadZone } from "./UploadZone";
import { ExcelUploadZone } from "./ExcelUploadZone";

interface Props {
  pending: InvoiceFile[];
  engineLabel: string;
  onPdfFiles: (files: File[]) => void;
  onExcelFile: (file: File) => Promise<void>;
  onRemove: (id: string) => void;
  onExtract: () => void;
  onOpenConfig: () => void;
}

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function BulkUploadPanel({
  pending,
  engineLabel,
  onPdfFiles,
  onExcelFile,
  onRemove,
  onExtract,
  onOpenConfig,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-700">Facturas en PDF</h2>
          <UploadZone onFiles={onPdfFiles} />
        </section>
        <section className="space-y-2 flex flex-col">
          <h2 className="text-sm font-semibold text-gray-700">Plantilla Excel</h2>
          <div className="flex-1">
            <ExcelUploadZone onFile={onExcelFile} />
          </div>
        </section>
      </div>

      <section className="bg-white border border-gray-200 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">
              PDF pendientes de extraer ({pending.length})
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Motor: <span className="font-medium text-gray-500">{engineLabel}</span> ·{" "}
              <button onClick={onOpenConfig} className="underline hover:text-gray-600">
                cambiar
              </button>
            </p>
          </div>
          <button onClick={onExtract} disabled={pending.length === 0} className={cx.btnPrimary}>
            <Zap size={16} className="mr-1" />
            Extraer y revisar ({pending.length})
          </button>
        </div>

        {pending.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">
            Añade PDF arriba. Las facturas del Excel pasan directamente a Revisión.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {pending.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <FileText size={16} className="text-gray-400 shrink-0" />
                <span className="flex-1 truncate text-gray-700" title={inv.name}>{inv.name}</span>
                <span className="text-xs text-gray-400 shrink-0">{formatSize(inv.size)}</span>
                <button
                  onClick={() => onRemove(inv.id)}
                  title="Quitar de la cola"
                  className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
