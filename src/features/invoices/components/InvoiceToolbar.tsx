"use client";

import { useRef } from "react";
import { FilePlus, FileSpreadsheet, Loader2, RefreshCw, Send, Zap } from "lucide-react";
import { cx } from "@/shared/styles";
import type { OdooMasters } from "@/shared/types";

interface Props {
  masters: OdooMasters | null;
  pendingCount: number;
  selectedCount: number;
  canApplyCompany: boolean;
  importing: boolean;
  exportingExcel: boolean;
  refreshingPartners: boolean;
  hasImported: boolean;
  onAddPdfs: (files: File[]) => void;
  onExtract: () => void;
  onImport: () => void;
  onExport: () => void;
  onRefreshPartners: () => void;
  onMassCompany: (companyId: number) => void;
  onClearImported: () => void;
}

const btnSm = cx.btnOutline.replace("px-4 py-2", "px-3 py-1.5");

export function InvoiceToolbar(p: Props) {
  const pdfInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) p.onAddPdfs(files);
          e.target.value = "";
        }}
      />
      <button onClick={() => pdfInputRef.current?.click()} className={btnSm} title="También puedes soltar PDF sobre la tabla">
        <FilePlus size={15} className="mr-1" />
        Añadir PDF
      </button>
      {p.pendingCount > 0 && (
        <button onClick={p.onExtract} className={btnSm}>
          <Zap size={15} className="mr-1" />
          Extraer ({p.pendingCount})
        </button>
      )}

      {p.masters && p.canApplyCompany && (
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) {
              p.onMassCompany(Number(e.target.value));
              e.target.value = "";
            }
          }}
          title="Aplica la empresa, su diario, cuenta e impuesto por defecto a todas las facturas pendientes o extraídas"
          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-400"
        >
          <option value="">Empresa para todas…</option>
          {p.masters.companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}

      <div className="flex-1" />

      {p.hasImported && (
        <button onClick={p.onClearImported} className="text-xs text-gray-400 hover:text-gray-600 px-2">
          Limpiar importadas
        </button>
      )}
      {p.masters && (
        <button
          onClick={p.onRefreshPartners}
          disabled={p.refreshingPartners}
          className={btnSm}
          title="Recarga la lista de proveedores desde Odoo"
        >
          {p.refreshingPartners ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        </button>
      )}
      <button onClick={p.onExport} disabled={p.exportingExcel} className={btnSm}>
        {p.exportingExcel ? <Loader2 size={15} className="animate-spin mr-1" /> : <FileSpreadsheet size={15} className="mr-1" />}
        Exportar
      </button>
      <button
        onClick={p.onImport}
        disabled={p.importing || p.selectedCount === 0}
        className={cx.btnPrimary.replace("px-4 py-2", "px-3 py-1.5")}
      >
        {p.importing ? <Loader2 size={15} className="animate-spin mr-1" /> : <Send size={15} className="mr-1" />}
        Crear borradores ({p.selectedCount})
      </button>
    </div>
  );
}
