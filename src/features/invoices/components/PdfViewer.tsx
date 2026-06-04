"use client";

import { useEffect, useState } from "react";
import { FileText, ScanLine, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import type { InvoiceFile } from "@/shared/types";

interface Props {
  invoice: InvoiceFile | null;
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  if (pct >= 80) {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
        <CheckCircle size={11} /> {pct}% confianza
      </span>
    );
  }
  if (pct >= 55) {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30">
        <AlertTriangle size={11} /> {pct}% confianza
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-red-500/20 text-red-300 border border-red-500/30">
      <XCircle size={11} /> {pct}% confianza
    </span>
  );
}

export function PdfViewer({ invoice }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!invoice?.dataBase64) {
      setBlobUrl(null);
      return;
    }

    setLoading(true);
    setBlobUrl(null);

    // Defer blob creation to avoid blocking the UI
    const timer = setTimeout(() => {
      try {
        const binary = atob(invoice.dataBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } finally {
        setLoading(false);
      }
    }, 0);

    return () => {
      clearTimeout(timer);
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [invoice?.id]);

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!invoice) {
    return (
      <div className="flex flex-col items-center justify-center h-full rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700/50 text-gray-500 gap-4">
        <div className="w-20 h-20 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center">
          <FileText size={36} className="text-gray-600" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-gray-400">Visor de documento</p>
          <p className="text-xs text-gray-600 mt-1">
            Haz clic en una fila para ver el PDF
          </p>
        </div>
      </div>
    );
  }

  const engine = invoice.extracted?.engine;
  const engineLabel =
    engine === "azure-di"
      ? "Azure Document Intelligence"
      : engine === "llm"
      ? "LLM Vision"
      : "Texto nativo";

  return (
    <div className="flex flex-col h-full rounded-2xl overflow-hidden border border-gray-700/50 shadow-2xl">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 px-4 py-3 flex items-center gap-3 border-b border-gray-700/50">
        <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/30 flex items-center justify-center shrink-0">
          <FileText size={15} className="text-sky-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-100 truncate leading-tight">
            {invoice.name}
          </p>
          {invoice.extracted && (
            <p className="text-xs text-gray-500 truncate">
              {invoice.extracted.supplierName ?? "Proveedor no detectado"}
            </p>
          )}
        </div>
        {invoice.extracted?.confidence != null && (
          <ConfidenceBadge confidence={invoice.extracted.confidence} />
        )}
      </div>

      {/* ── Extraction summary strip ───────────────────────────────────── */}
      {invoice.extracted && (
        <div className="bg-gray-800/80 px-4 py-2 flex flex-wrap gap-x-4 gap-y-1 border-b border-gray-700/50">
          <Pill label="Motor" value={engineLabel} />
          <Pill
            label="Nº factura"
            value={invoice.extracted.invoiceNumber ?? "—"}
          />
          <Pill
            label="Fecha"
            value={invoice.extracted.invoiceDate ?? "—"}
          />
          <Pill
            label="Total"
            value={
              invoice.extracted.total != null
                ? `${invoice.extracted.total.toFixed(2)} ${invoice.extracted.currency}`
                : "—"
            }
            highlight
          />
        </div>
      )}

      {/* ── PDF ───────────────────────────────────────────────────────── */}
      <div className="flex-1 bg-gray-950 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950">
            <div className="flex flex-col items-center gap-3 text-gray-500">
              <ScanLine size={28} className="animate-pulse text-sky-500" />
              <p className="text-xs">Cargando PDF…</p>
            </div>
          </div>
        )}
        {blobUrl && (
          <iframe
            key={blobUrl}
            src={blobUrl}
            className="w-full h-full border-0"
            title={invoice.name}
          />
        )}
      </div>
    </div>
  );
}

function Pill({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <span className="flex items-center gap-1 text-xs">
      <span className="text-gray-500">{label}:</span>
      <span
        className={
          highlight ? "font-semibold text-sky-300" : "text-gray-300"
        }
      >
        {value}
      </span>
    </span>
  );
}
