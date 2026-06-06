"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Zap, FileSpreadsheet, RefreshCw } from "lucide-react";
import { cx } from "@/shared/styles";
import type { AppConfig, InvoiceFile, OdooMasters } from "@/shared/types";
import { ConfigPanel } from "@/features/config/components/ConfigPanel";
import { UploadZone } from "@/features/invoices/components/UploadZone";
import { InvoiceTable } from "@/features/invoices/components/InvoiceTable";
import { PdfViewer } from "@/features/invoices/components/PdfViewer";
import { matchPartner, isAutoAssignable } from "@/shared/lib/odoo/partner-match";

const uuid = () => crypto.randomUUID();

const DEFAULT_CONFIG: AppConfig = {
  odooUrl: "",
  odooDb: "",
  odooUsername: "",
  odooApiKey: "",
  odooVersion: "18",
  extractionEngine: "native",
  azureDiEndpoint: "",
  azureDiKey: "",
  defaultJournalId: null,
  defaultJournalMap: {},
  defaultAccountMap: {},
  defaultTaxMap: {},
};

const CONFIG_KEY = "campo2odoo_config";

function readConfigFromStorage(): AppConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatSplitName(originalName: string, pageRange?: number[]): string {
  if (!pageRange || pageRange.length === 0) return originalName;
  const extIndex = originalName.lastIndexOf(".");
  let nameWithoutExt = originalName;
  let ext = "";
  if (extIndex !== -1 && extIndex > 0) {
    nameWithoutExt = originalName.substring(0, extIndex);
    ext = originalName.substring(extIndex);
  }

  if (pageRange.length === 1) {
    return `${nameWithoutExt} (Pág. ${pageRange[0]})${ext}`;
  }
  const min = Math.min(...pageRange);
  const max = Math.max(...pageRange);
  if (min === max) {
    return `${nameWithoutExt} (Pág. ${min})${ext}`;
  }
  return `${nameWithoutExt} (Págs. ${min}-${max})${ext}`;
}

export default function Home() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [masters, setMasters] = useState<OdooMasters | null>(null);
  const [invoices, setInvoices] = useState<InvoiceFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<"config" | "facturas">("config");
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
  const excelInputRef = useRef<HTMLInputElement>(null);
  const [importingExcel, setImportingExcel] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [viewerWidth, setViewerWidth] = useState(420);
  const [refreshingPartners, setRefreshingPartners] = useState(false);
  const dragRef = useRef<{ active: boolean; startX: number; startWidth: number }>({
    active: false, startX: 0, startWidth: 420,
  });

  async function handleExcelExport() {
    if (invoices.length === 0) return;
    setExportingExcel(true);
    try {
      const res = await fetch("/api/excel/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoices, masters }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error ?? "Error al exportar");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "facturas_exportadas.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al exportar a Excel");
    } finally {
      setExportingExcel(false);
    }
  }

  async function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportingExcel(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (masters) {
        formData.append("masters", JSON.stringify(masters));
      }

      const res = await fetch("/api/excel/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Error al importar Excel");

      if (data.invoices && Array.isArray(data.invoices)) {
        setInvoices((prev) => [...prev, ...data.invoices]);
        if (data.invoices.length > 0) {
          setActiveInvoiceId(data.invoices[0].id);
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al procesar el archivo Excel");
    } finally {
      setImportingExcel(false);
      if (excelInputRef.current) excelInputRef.current.value = "";
    }
  }

  // Load config: merge localStorage + env vars (env takes precedence for non-empty values)
  useEffect(() => {
    const stored = readConfigFromStorage();

    fetch("/api/config")
      .then((r) => r.json())
      .then((envConfig: Partial<AppConfig>) => {
        // Fields from env override blank fields; user edits in localStorage win over defaults
        const merged: AppConfig = { ...stored };

        // Apply env values only where the stored value is still the default (empty)
        const envKeys = Object.keys(envConfig) as (keyof AppConfig)[];
        for (const key of envKeys) {
          const envVal = envConfig[key];
          if (envVal !== undefined && envVal !== null) {
            const storedVal = stored[key];
            // Override if the stored field is blank/null (i.e. user hasn't customized it)
            if (!storedVal) {
              (merged as unknown as Record<string, unknown>)[key] = envVal;
            }
          }
        }

        // Los mapas son objetos: !{} es false, hay que comparar claves
        for (const mapKey of ["defaultJournalMap", "defaultAccountMap", "defaultTaxMap"] as const) {
          const envMap = envConfig[mapKey];
          if (envMap && Object.keys(envMap).length > 0 && Object.keys(merged[mapKey] ?? {}).length === 0) {
            merged[mapKey] = envMap;
          }
        }

        // Auto-select Azure DI if both credentials are present and engine is still default
        if (
          merged.azureDiEndpoint &&
          merged.azureDiKey &&
          merged.extractionEngine === "native" &&
          stored.extractionEngine === "native"
        ) {
          merged.extractionEngine = "azure-di";
        }

        setConfig(merged);
      })
      .catch(() => {
        // Fallback to localStorage only if the API call fails
        setConfig(stored);
      });
  }, []);

  // Persist config to localStorage on change
  useEffect(() => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }, [config]);

  // Drag-to-resize viewer panel
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current.active) return;
      const delta = dragRef.current.startX - e.clientX;
      setViewerWidth(Math.max(300, Math.min(900, dragRef.current.startWidth + delta)));
    }
    function onMouseUp() {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const updateInvoice = useCallback(
    (id: string, updates: Partial<InvoiceFile>) => {
      setInvoices((prev) =>
        prev.map((inv) => (inv.id === id ? { ...inv, ...updates } : inv))
      );
    },
    []
  );

  const deleteInvoice = useCallback((id: string) => {
    setInvoices((prev) => prev.filter((inv) => inv.id !== id));
    setActiveInvoiceId((prev) => (prev === id ? null : prev));
  }, []);

  function journalForCompany(companyId: number | null): number | null {
    if (companyId && config.defaultJournalMap[String(companyId)]) {
      return config.defaultJournalMap[String(companyId)];
    }
    return config.defaultJournalId;
  }

  function handleMassCompany(companyId: number) {
    const cId = String(companyId);
    const journalId  = journalForCompany(companyId);
    const defAccount = config.defaultAccountMap[cId] ?? null;
    const defTax     = config.defaultTaxMap[cId]     ?? null;
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.status !== "extracted" && inv.status !== "pending") return inv;
        return {
          ...inv,
          companyId,
          ...(journalId != null ? { journalId } : {}),
          lines: inv.lines.map((l) => ({
            ...l,
            accountId: defAccount,
            taxIds: defTax ? [defTax] : [],
          })),
        };
      })
    );
  }

  async function handleRefreshPartners() {
    if (!masters) return;
    setRefreshingPartners(true);
    try {
      const res = await fetch("/api/odoo/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          odooUrl: config.odooUrl,
          odooDb: config.odooDb,
          odooUsername: config.odooUsername,
          odooApiKey: config.odooApiKey,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Error al recargar proveedores");
      setMasters((prev) => prev ? { ...prev, partners: data.partners } : prev);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al recargar proveedores");
    } finally {
      setRefreshingPartners(false);
    }
  }

  async function handleFiles(files: File[]) {
    const newInvoices: InvoiceFile[] = await Promise.all(
      files.map(async (f) => {
        const dataBase64 = await fileToBase64(f);
        return {
          id: uuid(),
          name: f.name,
          size: f.size,
          dataBase64,
          status: "pending" as const,
          companyId: masters?.companyId ?? null,
          partnerId: null,
          journalId: config.defaultJournalId,
          lines: [],
          selectedForImport: false,
          importStatus: "idle" as const,
        };
      })
    );
    setInvoices((prev) => [...prev, ...newInvoices]);
  }

  async function handleExtract() {
    const pending = invoices.filter((i) => i.status === "pending");
    if (pending.length === 0) return;

    // Mark all as extracting
    pending.forEach((inv) =>
      updateInvoice(inv.id, { status: "extracting" })
    );

    // Process sequentially to avoid overwhelming APIs
    for (const inv of pending) {
      try {
        const formData = new FormData();
        // Reconstruct File from base64
        const binary = atob(inv.dataBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/pdf" });
        formData.append("file", blob, inv.name);
        formData.append("engine", config.extractionEngine);
        if (config.azureDiEndpoint)
          formData.append("azureDiEndpoint", config.azureDiEndpoint);
        if (config.azureDiKey)
          formData.append("azureDiKey", config.azureDiKey);

        const res = await fetch("/api/extract", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (!res.ok || data.error) throw new Error(data.error ?? "Error");

        if (!Array.isArray(data)) {
          throw new Error("La respuesta del servidor no tiene el formato esperado (array)");
        }

        const splitInvoices: InvoiceFile[] = data.map((item: any) => {
          const { extracted, dataBase64 } = item;
          const formattedName = formatSplitName(inv.name, extracted.pageRange);
          const approximateSize = Math.round((dataBase64.length * 3) / 4);

          // Auto-relacionar el proveedor extraído con un proveedor de Odoo.
          // Solo se asigna cuando la confianza es alta (VAT / nombre exacto / fuerte)
          // para no asignar un proveedor equivocado; los casos dudosos quedan sin
          // asignar y el usuario elige en la tabla.
          let matchedPartnerId: number | null = null;
          if (masters?.partners?.length && (extracted.supplierName || extracted.supplierVat)) {
            const match = matchPartner(masters.partners, {
              name: extracted.supplierName,
              vat: extracted.supplierVat,
            });
            if (match && isAutoAssignable(match.confidence)) {
              matchedPartnerId = match.partner.id;
            }
          }

          return {
            id: uuid(),
            name: formattedName,
            size: approximateSize,
            dataBase64,
            status: "extracted" as const,
            extracted,
            companyId: inv.companyId ?? masters?.companyId ?? null,
            partnerId: matchedPartnerId,
            journalId: inv.journalId ?? journalForCompany(inv.companyId ?? masters?.companyId ?? null),
            lines: (extracted.lines ?? []).map((line: import("@/shared/types").ExtractedLine) => {
              const cId = String(inv.companyId ?? masters?.companyId ?? "");
              const defAccount = config.defaultAccountMap[cId] ?? null;
              const defTax = config.defaultTaxMap[cId] ?? null;
              return {
                ...line,
                accountId: line.accountId ?? defAccount,
                taxIds: line.taxIds.length > 0 ? line.taxIds : (defTax ? [defTax] : []),
              };
            }),
            selectedForImport: true,
            importStatus: "idle" as const,
          };
        });

        // Replace the original invoice in the invoices state with the split invoices
        setInvoices((prev) => {
          const idx = prev.findIndex((item) => item.id === inv.id);
          if (idx === -1) return prev;
          const next = [...prev];
          next.splice(idx, 1, ...splitInvoices);
          return next;
        });

        // Set the active invoice to the first split invoice if any
        if (splitInvoices.length > 0) {
          setActiveInvoiceId(splitInvoices[0].id);
        }
      } catch (err) {
        updateInvoice(inv.id, {
          status: "error",
          errorMessage:
            err instanceof Error ? err.message : "Error de extracción",
        });
      }
    }
  }

  async function handleImport() {
    const selected = invoices.filter(
      (i) => i.selectedForImport && i.status === "extracted"
    );
    if (selected.length === 0) return;

    // Validate
    for (const inv of selected) {
      if (!inv.partnerId && !inv.extracted?.supplierName) {
        alert(
          `Selecciona un proveedor o indica un nombre en el Excel para la factura "${inv.name}" antes de importar.`
        );
        return;
      }
      if (!inv.journalId) {
        alert(
          `Selecciona un diario para la factura "${inv.name}" antes de importar.`
        );
        return;
      }
      const missingAccount = inv.lines.find((l) => !l.accountId);
      if (missingAccount) {
        alert(
          `La línea "${missingAccount.description}" de "${inv.name}" no tiene cuenta contable.`
        );
        return;
      }
    }

    setImporting(true);

    for (const inv of selected) {
      updateInvoice(inv.id, { importStatus: "importing" });
      try {
        const body = {
          odooUrl: config.odooUrl,
          odooDb: config.odooDb,
          odooUsername: config.odooUsername,
          odooApiKey: config.odooApiKey,
          odooVersion: config.odooVersion,
          companyId: inv.companyId ?? masters!.companyId,
          partnerId: inv.partnerId,
          supplierName: inv.extracted?.supplierName ?? null,
          supplierVat: inv.extracted?.supplierVat ?? null,
          journalId: inv.journalId!,
          invoiceNumber: inv.extracted?.invoiceNumber ?? null,
          invoiceDate: inv.extracted?.invoiceDate ?? null,
          dueDate: inv.extracted?.dueDate ?? null,
          currency: inv.extracted?.currency ?? "EUR",
          lines: inv.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            accountId: l.accountId!,
            taxIds: l.taxIds,
          })),
          pdfBase64: inv.dataBase64 || null,
          fileName: inv.name,
        };

        const res = await fetch("/api/odoo/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();

        if (!res.ok || data.error) throw new Error(data.error ?? "Error");

        updateInvoice(inv.id, {
          importStatus: "success",
          importResult: data,
          selectedForImport: false,
        });
      } catch (err) {
        updateInvoice(inv.id, {
          importStatus: "error",
          errorMessage:
            err instanceof Error ? err.message : "Error al importar",
        });
      }
    }

    setImporting(false);
  }

  const pendingCount = invoices.filter((i) => i.status === "pending").length;
  const extractedCount = invoices.filter((i) => i.status === "extracted").length;
  const selectedCount = invoices.filter(
    (i) => i.selectedForImport && i.status === "extracted"
  ).length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center">
            <Zap size={18} className="text-white" />
          </div>
          <span className="font-bold text-gray-800 text-lg">Campo2Odoo</span>
          <span className="text-gray-400 text-sm hidden sm:block">
            Facturas PDF → Odoo 18
          </span>
        </div>
        {invoices.length > 0 && (
          <div className="text-xs text-gray-400">
            {invoices.length} archivo(s) · {extractedCount} extraído(s)
          </div>
        )}
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6">
        <nav className="flex gap-1">
          {(
            [
              { id: "config", label: "Configuración" },
              { id: "facturas", label: "Facturas" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${
                  activeTab === tab.id
                    ? "border-sky-500 text-sky-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <main className={`flex-1 p-6 w-full ${activeTab === "config" ? "max-w-7xl mx-auto" : ""}`}>
        {activeTab === "config" && (
          <div className="max-w-3xl">
            <ConfigPanel
              config={config}
              onChange={setConfig}
              onMastersLoaded={setMasters}
              masters={masters}
            />
            {masters && (
              <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-100 text-sm text-green-700">
                ✓ Maestros cargados. Puedes ir a la pestaña{" "}
                <button
                  onClick={() => setActiveTab("facturas")}
                  className="font-medium underline"
                >
                  Facturas
                </button>{" "}
                para subir PDFs.
              </div>
            )}
          </div>
        )}

        {activeTab === "facturas" && (
          <div className="space-y-4">
            {!masters && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                ⚠ Carga los maestros de Odoo en{" "}
                <button
                  onClick={() => setActiveTab("config")}
                  className="font-medium underline"
                >
                  Configuración
                </button>{" "}
                para poder asignar proveedores, diarios y cuentas.
              </div>
            )}

            {/* Upload zones */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <UploadZone onFiles={handleFiles} />
              </div>
              <div
                onClick={() => !importingExcel && excelInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors relative
                  ${importingExcel ? "border-gray-100 bg-gray-50/50 pointer-events-none" : "border-gray-200 hover:border-sky-300 hover:bg-gray-50/50"}
                `}
              >
                <input
                  ref={excelInputRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={handleExcelUpload}
                  disabled={importingExcel}
                />
                {importingExcel ? (
                  <Loader2 size={32} className="animate-spin text-sky-500 mb-2" />
                ) : (
                  <FileSpreadsheet size={32} className="text-gray-400 mb-2" />
                )}
                <div>
                  <p className="text-sm font-semibold text-gray-700">Importar desde Excel</p>
                  <p className="text-xs text-gray-400 mt-1 max-w-[200px] mx-auto">
                    {importingExcel ? "Procesando filas..." : "Carga la plantilla excel con facturas de proveedor"}
                  </p>
                </div>
              </div>
            </div>

            {invoices.length > 0 && (
              <>
                {/* Mass company selector */}
                {masters && invoices.some((i) => i.status === "extracted" || i.status === "pending") && (
                  <div className="flex items-center gap-2 p-3 bg-sky-50 border border-sky-100 rounded-lg">
                    <span className="text-xs font-medium text-sky-700 shrink-0">Aplicar empresa a todas:</span>
                    <select
                      defaultValue=""
                      onChange={(e) => { if (e.target.value) { handleMassCompany(Number(e.target.value)); e.target.value = ""; } }}
                      className="text-xs border border-sky-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-400"
                    >
                      <option value="">— Seleccionar empresa —</option>
                      {masters.companies.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <span className="text-xs text-sky-500">También asigna el diario por defecto de cada empresa.</span>
                  </div>
                )}

                {/* Action bar */}
                <div className="flex flex-wrap gap-3 items-center justify-between">
                  <div className="flex gap-3 flex-wrap">
                    {pendingCount > 0 && (
                      <button onClick={handleExtract} className={cx.btnOutline}>
                        <Zap size={16} className="mr-1" />
                        Extraer información ({pendingCount})
                      </button>
                    )}
                    {selectedCount > 0 && (
                      <button
                        onClick={handleImport}
                        disabled={importing}
                        className={cx.btnPrimary}
                      >
                        {importing ? (
                          <Loader2 size={16} className="animate-spin mr-1" />
                        ) : (
                          <Send size={16} className="mr-1" />
                        )}
                        Crear borradores en Odoo ({selectedCount})
                      </button>
                    )}
                    <button
                      onClick={handleExcelExport}
                      disabled={exportingExcel}
                      className={cx.btnOutline}
                    >
                      {exportingExcel ? (
                        <Loader2 size={16} className="animate-spin mr-1" />
                      ) : (
                        <FileSpreadsheet size={16} className="mr-1" />
                      )}
                      Exportar a Excel
                    </button>
                    {masters && (
                      <button
                        onClick={handleRefreshPartners}
                        disabled={refreshingPartners}
                        className={cx.btnOutline}
                        title="Recarga la lista de proveedores desde Odoo"
                      >
                        {refreshingPartners ? (
                          <Loader2 size={16} className="animate-spin mr-1" />
                        ) : (
                          <RefreshCw size={16} className="mr-1" />
                        )}
                        Actualizar proveedores
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setInvoices((prev) =>
                        prev.filter((i) => i.importStatus !== "success")
                      );
                      setActiveInvoiceId(null);
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Limpiar importadas
                  </button>
                </div>

                {/* Split panel: table (left) + PDF viewer (right) */}
                <div className="grid gap-4" style={{ gridTemplateColumns: `1fr ${viewerWidth}px` }}>
                  {/* Left — invoice table (scrollable) */}
                  <div className="min-w-0 overflow-x-auto">
                    <InvoiceTable
                      invoices={invoices}
                      masters={masters}
                      onChange={updateInvoice}
                      onDelete={deleteInvoice}
                      activeId={activeInvoiceId}
                      onSelect={setActiveInvoiceId}
                      journalMap={config.defaultJournalMap}
                      accountMap={config.defaultAccountMap}
                      taxMap={config.defaultTaxMap}
                    />
                  </div>

                  {/* Right — sticky PDF viewer with resize handle on left edge */}
                  <div
                    className="sticky top-4 relative"
                    style={{ height: "calc(100vh - 160px)" }}
                  >
                    {/* Drag handle */}
                    <div
                      className="absolute -left-3 top-0 bottom-0 w-6 z-20 flex items-center justify-center cursor-col-resize group"
                      onMouseDown={(e) => {
                        dragRef.current = { active: true, startX: e.clientX, startWidth: viewerWidth };
                        document.body.style.userSelect = "none";
                        document.body.style.cursor = "col-resize";
                        e.preventDefault();
                      }}
                    >
                      <div className="w-1 h-12 rounded-full bg-gray-300/30 group-hover:bg-sky-400/70 transition-colors" />
                    </div>
                    <PdfViewer
                      invoice={
                        invoices.find((i) => i.id === activeInvoiceId) ?? null
                      }
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
