"use client";

import React, { useEffect, useRef, useState } from "react";
import type { InvoiceFile, OdooMasters, ExtractedLine } from "@/shared/types";
import { cx } from "@/shared/styles";
import {
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  XCircle,
  ExternalLink,
  Trash2,
  Plus,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";

interface Props {
  invoices: InvoiceFile[];
  masters: OdooMasters | null;
  onChange: (id: string, updates: Partial<InvoiceFile>) => void;
  onDelete: (id: string) => void;
  activeId: string | null;
  onSelect: (id: string) => void;
  journalMap: Record<string, number>;
  accountMap: Record<string, number>;
  taxMap: Record<string, number>;
}

const COLS = 11; // total columns in thead

export function InvoiceTable({ invoices, masters, onChange, onDelete, activeId, onSelect, journalMap, accountMap, taxMap }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const errorIds = invoices.filter((i) => i.importStatus === "error").map((i) => i.id);
    if (errorIds.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      errorIds.forEach((id) => next.add(id));
      return next;
    });
  }, [invoices]);

  if (invoices.length === 0) return null;

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function updateLine(invoiceId: string, lineId: string, updates: Partial<ExtractedLine>) {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) return;
    onChange(invoiceId, { lines: inv.lines.map((l) => (l.id === lineId ? { ...l, ...updates } : l)) });
  }

  function deleteLine(invoiceId: string, lineId: string) {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) return;
    onChange(invoiceId, { lines: inv.lines.filter((l) => l.id !== lineId) });
  }

  function addLine(invoiceId: string) {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) return;
    const newLine: ExtractedLine = {
      id: crypto.randomUUID(),
      description: "",
      quantity: 1,
      unitPrice: 0,
      taxRate: null,
      amount: 0,
      accountId: null,
      taxIds: [],
    };
    onChange(invoiceId, { lines: [...inv.lines, newLine] });
  }

  function updateHeader<K extends keyof NonNullable<InvoiceFile["extracted"]>>(
    invoiceId: string,
    field: K,
    value: NonNullable<InvoiceFile["extracted"]>[K]
  ) {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv?.extracted) return;
    onChange(invoiceId, { extracted: { ...inv.extracted, [field]: value } });
  }

  const allSelected = invoices
    .filter((i) => i.status === "extracted")
    .every((i) => i.selectedForImport);

  function toggleAll() {
    const extracted = invoices.filter((i) => i.status === "extracted");
    extracted.forEach((i) => onChange(i.id, { selectedForImport: !allSelected }));
  }

  const expandableIds = invoices.filter((i) => i.status === "extracted").map((i) => i.id);
  const allExpanded = expandableIds.length > 0 && expandableIds.every((id) => expanded.has(id));

  return (
    <div className="space-y-2">
      {/* Expand / Collapse toolbar */}
      {expandableIds.length > 0 && (
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => setExpanded(new Set(expandableIds))}
            disabled={allExpanded}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-sky-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronsUpDown size={13} /> Expandir todo
          </button>
          <span className="text-gray-200">|</span>
          <button
            onClick={() => setExpanded(new Set())}
            disabled={expanded.size === 0}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-sky-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronsDownUp size={13} /> Contraer todo
          </button>
        </div>
      )}
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500 tracking-wide">
          <tr>
            <th className="px-3 py-3 w-8">
              <button onClick={toggleAll} className="block">
                {allSelected
                  ? <CheckSquare size={16} className="text-sky-600" />
                  : <Square size={16} className="text-gray-400" />}
              </button>
            </th>
            <th className="px-3 py-3 w-6" />
            <th className="px-3 py-3 text-left">Archivo</th>
            <th className="px-3 py-3 text-left">Empresa</th>
            <th className="px-3 py-3 text-left">Proveedor</th>
            <th className="px-3 py-3 text-left">Nº Factura</th>
            <th className="px-3 py-3 text-left">Fecha</th>
            <th className="px-3 py-3 text-right">Total</th>
            <th className="px-3 py-3 text-left">Diario</th>
            <th className="px-3 py-3 text-left">Estado</th>
            <th className="px-3 py-3 w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {invoices.map((inv) => (
            <React.Fragment key={inv.id}>
              {/* ── Main row ── */}
              <tr
                onClick={() => onSelect(inv.id)}
                className={`cursor-pointer transition-colors ${
                  activeId === inv.id
                    ? "bg-sky-50 ring-1 ring-inset ring-sky-200"
                    : inv.status === "extracted"
                    ? "hover:bg-gray-50"
                    : "opacity-60"
                }`}
              >
                <td className="px-3 py-3">
                  {inv.status === "extracted" && (
                    <button onClick={(e) => { e.stopPropagation(); onChange(inv.id, { selectedForImport: !inv.selectedForImport }); }}>
                      {inv.selectedForImport
                        ? <CheckSquare size={16} className="text-sky-600" />
                        : <Square size={16} className="text-gray-400" />}
                    </button>
                  )}
                </td>
                <td className="px-3 py-3">
                  {inv.status === "extracted" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpand(inv.id); }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      {expanded.has(inv.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  )}
                </td>
                <td className="px-3 py-3 font-medium text-gray-700 max-w-48 truncate">{inv.name}</td>
                {/* Empresa */}
                <td className="px-3 py-3">
                  <select
                    value={inv.companyId ?? ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const companyId = e.target.value ? Number(e.target.value) : null;
                      const cId = String(companyId ?? "");
                      const updates: Partial<InvoiceFile> = { companyId };
                      if (companyId && journalMap[cId]) updates.journalId = journalMap[cId];
                      // Reset line accounts/taxes to the new company's defaults to avoid
                      // cross-company mismatches. If no default is configured → null forces
                      // the user to pick, which is safer than sending wrong-company IDs.
                      const defAccount = companyId ? (accountMap[cId] ?? null) : null;
                      const defTax    = companyId ? (taxMap[cId]    ?? null) : null;
                      updates.lines = inv.lines.map((l) => ({
                        ...l,
                        accountId: defAccount,
                        taxIds: defTax ? [defTax] : [],
                      }));
                      onChange(inv.id, updates);
                    }}
                    className={`${cx.select} text-xs`}
                  >
                    <option value="">— Empresa —</option>
                    {(masters?.companies ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </td>
                {/* Proveedor */}
                <td className="px-3 py-3">
                  {inv.status === "extracted" ? (
                    <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                      {inv.extracted?.supplierName && (
                        <span className="text-xs text-gray-400 truncate max-w-48">{inv.extracted.supplierName}</span>
                      )}
                      <PartnerCombobox
                        partners={masters?.partners ?? []}
                        value={inv.partnerId}
                        supplierName={inv.extracted?.supplierName}
                        onChange={(id) => onChange(inv.id, { partnerId: id })}
                      />
                    </div>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                {/* Nº factura */}
                <td className="px-3 py-3">
                  {inv.status === "extracted" ? (
                    <input
                      type="text"
                      value={inv.extracted?.invoiceNumber ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateHeader(inv.id, "invoiceNumber", e.target.value)}
                      className={`${cx.input} text-xs w-28`}
                      placeholder="Nº factura"
                    />
                  ) : <span className="text-gray-400">—</span>}
                </td>
                {/* Fecha */}
                <td className="px-3 py-3">
                  {inv.status === "extracted" ? (
                    <input
                      type="date"
                      value={inv.extracted?.invoiceDate ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateHeader(inv.id, "invoiceDate", e.target.value)}
                      className={`${cx.input} text-xs`}
                    />
                  ) : <span className="text-gray-400">—</span>}
                </td>
                {/* Total — editable */}
                <td className="px-3 py-3">
                  {inv.status === "extracted" ? (
                    <input
                      type="number"
                      value={inv.extracted?.total ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateHeader(inv.id, "total", e.target.value === "" ? null : Number(e.target.value))}
                      className={`${cx.input} text-xs text-right w-24`}
                      step="0.01"
                      placeholder="0.00"
                    />
                  ) : <span className="text-gray-400 text-right block">—</span>}
                </td>
                {/* Diario */}
                <td className="px-3 py-3">
                  {inv.status === "extracted" ? (
                    <select
                      value={inv.journalId ?? ""}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onChange(inv.id, { journalId: e.target.value ? Number(e.target.value) : null })}
                      className={`${cx.select} text-xs`}
                    >
                      <option value="">— Diario —</option>
                      {(masters?.journals ?? []).map((j) => (
                        <option key={j.id} value={j.id}>
                          {j.name}{j.company_id ? ` · ${j.company_id[1]}` : ""}
                        </option>
                      ))}
                    </select>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-3 py-3"><StatusBadge invoice={inv} /></td>
                <td className="px-3 py-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(inv.id); }}
                    disabled={inv.importStatus === "importing"}
                    title="Eliminar factura"
                    className="text-gray-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>

              {/* ── Expanded: header editing + lines ── */}
              {expanded.has(inv.id) && inv.status === "extracted" && (
                <tr key={`${inv.id}-detail`}>
                  <td colSpan={COLS} className="bg-sky-50 px-6 py-5 space-y-5">

                    {/* Error panel */}
                    {inv.importStatus === "error" && inv.errorMessage && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                        <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1 flex items-center gap-1">
                          <XCircle size={13} /> Error al importar en Odoo
                        </p>
                        <pre className="text-xs text-red-800 whitespace-pre-wrap break-all font-mono bg-red-100 rounded p-3 mt-2 max-h-48 overflow-y-auto">
                          {inv.errorMessage}
                        </pre>
                      </div>
                    )}

                    {/* ── Cabecera editable ── */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                        Cabecera de la factura
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <HeaderField label="Nombre proveedor (OCR)">
                          <input
                            type="text"
                            value={inv.extracted?.supplierName ?? ""}
                            onChange={(e) => updateHeader(inv.id, "supplierName", e.target.value || null)}
                            className={`${cx.input} text-xs`}
                            placeholder="Nombre extraído"
                          />
                        </HeaderField>
                        <HeaderField label="NIF / VAT">
                          <input
                            type="text"
                            value={inv.extracted?.supplierVat ?? ""}
                            onChange={(e) => updateHeader(inv.id, "supplierVat", e.target.value || null)}
                            className={`${cx.input} text-xs`}
                            placeholder="B12345678"
                          />
                        </HeaderField>
                        <HeaderField label="Vencimiento">
                          <input
                            type="date"
                            value={inv.extracted?.dueDate ?? ""}
                            onChange={(e) => updateHeader(inv.id, "dueDate", e.target.value || null)}
                            className={`${cx.input} text-xs`}
                          />
                        </HeaderField>
                        <HeaderField label="Moneda">
                          <input
                            type="text"
                            value={inv.extracted?.currency ?? "EUR"}
                            onChange={(e) => updateHeader(inv.id, "currency", e.target.value)}
                            className={`${cx.input} text-xs`}
                            placeholder="EUR"
                          />
                        </HeaderField>
                        <HeaderField label="Base imponible">
                          <input
                            type="number"
                            value={inv.extracted?.subtotal ?? ""}
                            onChange={(e) => updateHeader(inv.id, "subtotal", e.target.value === "" ? null : Number(e.target.value))}
                            className={`${cx.input} text-xs text-right`}
                            step="0.01"
                            placeholder="0.00"
                          />
                        </HeaderField>
                        <HeaderField label="Cuota IVA">
                          <input
                            type="number"
                            value={inv.extracted?.totalTax ?? ""}
                            onChange={(e) => updateHeader(inv.id, "totalTax", e.target.value === "" ? null : Number(e.target.value))}
                            className={`${cx.input} text-xs text-right`}
                            step="0.01"
                            placeholder="0.00"
                          />
                        </HeaderField>
                        <HeaderField label="Total factura">
                          <input
                            type="number"
                            value={inv.extracted?.total ?? ""}
                            onChange={(e) => updateHeader(inv.id, "total", e.target.value === "" ? null : Number(e.target.value))}
                            className={`${cx.input} text-xs text-right font-semibold`}
                            step="0.01"
                            placeholder="0.00"
                          />
                        </HeaderField>
                      </div>
                    </div>

                    {/* ── Líneas ── */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                        Líneas de factura
                      </p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 border-b border-sky-100">
                            <th className="text-left pb-2 font-medium">Descripción</th>
                            <th className="text-right pb-2 font-medium w-16">Cant.</th>
                            <th className="text-right pb-2 font-medium w-24">P. Unitario</th>
                            <th className="text-right pb-2 font-medium w-24">Importe</th>
                            <th className="text-left pb-2 font-medium w-56">Cuenta contable</th>
                            <th className="text-left pb-2 font-medium w-44">Impuesto</th>
                            <th className="w-8" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-sky-100">
                          {inv.lines.map((line) => (
                            <tr key={line.id}>
                              {/* Descripción */}
                              <td className="py-2 pr-2">
                                <input
                                  type="text"
                                  value={line.description}
                                  onChange={(e) => updateLine(inv.id, line.id, { description: e.target.value })}
                                  className={`${cx.input} text-xs w-full`}
                                />
                              </td>
                              {/* Cantidad */}
                              <td className="py-2 pr-2">
                                <input
                                  type="number"
                                  value={line.quantity}
                                  onChange={(e) => updateLine(inv.id, line.id, { quantity: Number(e.target.value) })}
                                  className={`${cx.input} text-xs text-right w-16`}
                                  step="any"
                                />
                              </td>
                              {/* Precio unitario */}
                              <td className="py-2 pr-2">
                                <input
                                  type="number"
                                  value={line.unitPrice}
                                  onChange={(e) => updateLine(inv.id, line.id, { unitPrice: Number(e.target.value) })}
                                  className={`${cx.input} text-xs text-right w-24`}
                                  step="0.01"
                                />
                              </td>
                              {/* Importe calculado */}
                              <td className="py-2 pr-2 text-right font-semibold text-gray-700">
                                {(line.quantity * line.unitPrice).toFixed(2)} €
                              </td>
                              {/* Cuenta contable — select simple filtrado por empresa */}
                              <td className="py-2 pr-2">
                                <select
                                  value={line.accountId ?? ""}
                                  onChange={(e) => updateLine(inv.id, line.id, { accountId: e.target.value ? Number(e.target.value) : null })}
                                  className={`${cx.select} text-xs w-full`}
                                >
                                  <option value="">— Cuenta —</option>
                                  {(masters?.accounts ?? [])
                                    .filter((a) =>
                                      !inv.companyId ||
                                      !a.company_ids ||
                                      a.company_ids.length === 0 ||
                                      a.company_ids.includes(inv.companyId)
                                    )
                                    .map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.code} · {a.name}
                                      </option>
                                    ))}
                                </select>
                              </td>
                              {/* Impuesto */}
                              <td className="py-2 pr-2">
                                <select
                                  value={line.taxIds[0] ?? ""}
                                  onChange={(e) =>
                                    updateLine(inv.id, line.id, {
                                      taxIds: e.target.value ? [Number(e.target.value)] : [],
                                    })
                                  }
                                  className={`${cx.select} text-xs w-full`}
                                >
                                  <option value="">— Sin impuesto —</option>
                                  {(masters?.taxes ?? [])
                                    .filter((t) => taxBelongsToCompany(t.company_id, inv.companyId))
                                    .map((t) => (
                                      <option key={t.id} value={t.id}>
                                        {t.name} ({t.amount}%)
                                      </option>
                                    ))}
                                </select>
                              </td>
                              {/* Borrar línea */}
                              <td className="py-2 text-center">
                                <button
                                  onClick={() => deleteLine(inv.id, line.id)}
                                  className="text-gray-300 hover:text-red-500 transition-colors"
                                  title="Eliminar línea"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {/* Añadir línea */}
                      <button
                        onClick={() => addLine(inv.id)}
                        className="mt-3 flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 font-medium"
                      >
                        <Plus size={14} /> Añadir línea
                      </button>
                    </div>

                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function PartnerCombobox({
  partners,
  value,
  supplierName,
  onChange,
}: {
  partners: import("@/shared/types").OdooPartner[];
  value: number | null;
  supplierName: string | null | undefined;
  onChange: (id: number | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const selectedPartner = value ? partners.find((p) => p.id === value) : null;

  const filtered = query.trim().length === 0
    ? partners.slice(0, 60)
    : partners
        .filter((p) => {
          const q = query.toLowerCase();
          return (
            p.name.toLowerCase().includes(q) ||
            (p.vat ?? "").toLowerCase().includes(q)
          );
        })
        .slice(0, 60);

  const isCreateNew = value === null;

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={open ? query : (selectedPartner?.name ?? "")}
        placeholder={isCreateNew ? `🆕 ${supplierName || "Crear nuevo"}` : ""}
        className={`${cx.input} text-xs w-full ${isCreateNew ? "text-amber-700 bg-amber-50 border-amber-300 font-medium" : ""}`}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setQuery(""); } }}
      />
      {open && (
        <div className="absolute z-50 left-0 top-full mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {/* Crear nuevo */}
          <div
            onMouseDown={(e) => { e.preventDefault(); onChange(null); setOpen(false); setQuery(""); }}
            className="px-3 py-2 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 cursor-pointer border-b border-amber-200 sticky top-0"
          >
            🆕 Crear nuevo: {supplierName || "Proveedor nuevo"}
          </div>
          {/* Lista filtrada */}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400 italic">Sin resultados</div>
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                onMouseDown={(e) => { e.preventDefault(); onChange(p.id); setOpen(false); setQuery(""); }}
                className={`px-3 py-2 text-xs cursor-pointer hover:bg-sky-50 flex justify-between gap-2 ${value === p.id ? "bg-sky-50 font-medium text-sky-700" : "text-gray-700"}`}
              >
                <span className="truncate">{p.name}</span>
                {p.vat && <span className="text-gray-400 shrink-0">{p.vat}</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function HeaderField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function taxBelongsToCompany(
  companyId: [number, string] | false | undefined,
  selectedId: number | null
): boolean {
  if (!selectedId) return true;
  if (!companyId) return true;
  return (companyId as [number, string])[0] === selectedId;
}

function StatusBadge({ invoice }: { invoice: InvoiceFile }) {
  if (invoice.importStatus === "success" && invoice.importResult) {
    return (
      <a href={invoice.importResult.url} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1 text-green-600 font-medium hover:underline">
        <CheckCircle2 size={14} />
        {invoice.importResult.moveName}
        <ExternalLink size={12} />
      </a>
    );
  }
  if (invoice.importStatus === "importing") {
    return <span className="flex items-center gap-1 text-sky-600"><Loader2 size={14} className="animate-spin" />Importando…</span>;
  }
  if (invoice.importStatus === "error") {
    return (
      <span title={invoice.errorMessage} className="flex items-center gap-1 text-red-600 text-xs cursor-help">
        <XCircle size={14} className="shrink-0" />
        <span className="truncate max-w-48">{invoice.errorMessage ?? "Error al importar"}</span>
      </span>
    );
  }
  if (invoice.status === "extracting") {
    return <span className="flex items-center gap-1 text-sky-500"><Loader2 size={14} className="animate-spin" />Extrayendo…</span>;
  }
  if (invoice.status === "error") {
    return (
      <span title={invoice.errorMessage} className="flex items-center gap-1 text-red-500 text-xs">
        <AlertCircle size={14} />
        {invoice.errorMessage?.slice(0, 30) ?? "Error"}
      </span>
    );
  }
  if (invoice.status === "extracted") {
    return <span className="flex items-center gap-1 text-emerald-600 text-xs"><CheckCircle2 size={14} />Listo</span>;
  }
  return <span className="text-gray-400 text-xs">Pendiente</span>;
}
