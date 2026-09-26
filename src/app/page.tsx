"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeftOpen, UploadCloud } from "lucide-react";
import type { AppConfig, ExtractedInvoice, InvoiceFile, OdooMasters } from "@/shared/types";
import { AppSidebar, type AppView } from "@/shared/components/AppSidebar";
import { ConfigPanel } from "@/features/config/components/ConfigPanel";
import { InvoiceTable } from "@/features/invoices/components/InvoiceTable";
import { PdfViewer } from "@/features/invoices/components/PdfViewer";
import { InvoiceToolbar } from "@/features/invoices/components/InvoiceToolbar";
import { BulkUploadPanel } from "@/features/invoices/components/BulkUploadPanel";
import { PdfDropTarget } from "@/features/invoices/components/PdfDropTarget";
import { invoiceFromExtraction, ownTaxIds } from "@/features/invoices/lib/from-extraction";

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
const SIDEBAR_KEY = "campo2odoo_sidebar_collapsed";

const ENGINE_LABELS: Record<string, string> = {
  native: "Texto nativo (pdf-parse)",
  "azure-di": "Azure Document Intelligence",
};

const VIEW_TITLES: Record<AppView, string> = {
  config: "Configuración",
  review: "Facturas · Revisión",
  bulk: "Facturas · Carga masiva",
};

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

export default function Home() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [masters, setMasters] = useState<OdooMasters | null>(null);
  const [serverSecrets, setServerSecrets] = useState({ odooApiKey: false, azureDiKey: false });
  const [invoices, setInvoices] = useState<InvoiceFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState<AppView>("config");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);
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

  async function handleExcelUpload(file: File) {
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
          setView("review");
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al procesar el archivo Excel");
    }
  }

  // Load config: merge localStorage + env vars (env takes precedence for non-empty values)
  useEffect(() => {
    const stored = readConfigFromStorage();

    fetch("/api/config")
      .then((r) => r.json())
      .then(({ serverSecrets: secrets, ...envConfig }: Partial<AppConfig> & { serverSecrets?: typeof serverSecrets }) => {
        if (secrets) setServerSecrets(secrets);
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
          (merged.azureDiKey || secrets?.azureDiKey) &&
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

  // Preferencia de menú lateral (solo comodidad local: si falla el storage, se ignora)
  useEffect(() => {
    try {
      setSidebarCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {}
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, prev ? "0" : "1");
      } catch {}
      return !prev;
    });
  }

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
          noSplit: false,
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
        formData.append("noSplit", String(inv.noSplit ?? false));
        formData.append("ownTaxIds", JSON.stringify(ownTaxIds(masters)));

        const res = await fetch("/api/extract", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (!res.ok || data.error) throw new Error(data.error ?? "Error");

        if (!Array.isArray(data)) {
          throw new Error("La respuesta del servidor no tiene el formato esperado (array)");
        }

        const splitInvoices: InvoiceFile[] = data.map(
          (item: { extracted: ExtractedInvoice; dataBase64: string }) =>
            invoiceFromExtraction({ source: inv, extracted: item.extracted, dataBase64: item.dataBase64, masters, config })
        );

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

  const pendingInvoices = invoices.filter((i) => i.status === "pending");
  const pendingCount = pendingInvoices.length;
  const extractedCount = invoices.filter((i) => i.status === "extracted").length;
  const selectedCount = invoices.filter(
    (i) => i.selectedForImport && i.status === "extracted"
  ).length;

  function extractAndReview() {
    setView("review");
    handleExtract();
  }

  return (
    <div className="min-h-screen flex bg-gray-50">
      <AppSidebar
        view={view}
        onNavigate={setView}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        invoiceCount={invoices.length}
        pendingCount={pendingCount}
        odooVersion={config.odooVersion}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 shrink-0 bg-white border-b border-gray-200 px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {sidebarCollapsed && (
              <button
                onClick={toggleSidebar}
                title="Mostrar menú"
                className="p-1.5 -ml-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100"
              >
                <PanelLeftOpen size={18} />
              </button>
            )}
            <h1 className="font-semibold text-gray-800">{VIEW_TITLES[view]}</h1>
          </div>
          {invoices.length > 0 && (
            <div className="text-xs text-gray-400">
              {invoices.length} archivo(s) · {extractedCount} extraído(s)
            </div>
          )}
        </header>

        <main className="flex-1 p-6">
          {view !== "config" && !masters && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              ⚠ Carga los maestros de Odoo en{" "}
              <button onClick={() => setView("config")} className="font-medium underline">
                Configuración
              </button>{" "}
              para poder asignar proveedores, diarios y cuentas.
            </div>
          )}

          {view === "config" && (
            <div>
              <ConfigPanel
                config={config}
                onChange={setConfig}
                onMastersLoaded={setMasters}
                masters={masters}
                serverSecrets={serverSecrets}
              />
              {masters && (
                <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-100 text-sm text-green-700">
                  ✓ Maestros cargados. Ve a{" "}
                  <button onClick={() => setView("bulk")} className="font-medium underline">
                    Carga masiva
                  </button>{" "}
                  para subir PDF o la plantilla Excel.
                </div>
              )}
            </div>
          )}

          {view === "bulk" && (
            <BulkUploadPanel
              pending={pendingInvoices}
              engineLabel={ENGINE_LABELS[config.extractionEngine] ?? config.extractionEngine}
              onPdfFiles={handleFiles}
              onExcelFile={handleExcelUpload}
              onRemove={deleteInvoice}
              onExtract={extractAndReview}
              onOpenConfig={() => setView("config")}
            />
          )}

          {view === "review" && (
            <PdfDropTarget onFiles={handleFiles}>
              {invoices.length === 0 ? (
                <div className="border-2 border-dashed border-gray-200 rounded-xl py-16 flex flex-col items-center text-center text-gray-400">
                  <UploadCloud size={36} className="mb-3" />
                  <p className="text-base font-medium text-gray-600">Aún no hay facturas</p>
                  <p className="text-sm mt-1">
                    Suelta PDF aquí o usa{" "}
                    <button onClick={() => setView("bulk")} className="underline hover:text-gray-600">
                      Carga masiva
                    </button>{" "}
                    para PDF y Excel.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <InvoiceToolbar
                    masters={masters}
                    pendingCount={pendingCount}
                    selectedCount={selectedCount}
                    canApplyCompany={invoices.some((i) => i.status === "extracted" || i.status === "pending")}
                    importing={importing}
                    exportingExcel={exportingExcel}
                    refreshingPartners={refreshingPartners}
                    hasImported={invoices.some((i) => i.importStatus === "success")}
                    onAddPdfs={handleFiles}
                    onExtract={handleExtract}
                    onImport={handleImport}
                    onExport={handleExcelExport}
                    onRefreshPartners={handleRefreshPartners}
                    onMassCompany={handleMassCompany}
                    onClearImported={() => {
                      setInvoices((prev) => prev.filter((i) => i.importStatus !== "success"));
                      setActiveInvoiceId(null);
                    }}
                  />

                  {/* Split panel: table (left) + PDF viewer (right) */}
                  <div className="grid gap-4" style={{ gridTemplateColumns: `1fr ${viewerWidth}px` }}>
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
                        extractionEngine={config.extractionEngine}
                      />
                    </div>

                    {/* Sticky PDF viewer with resize handle on left edge */}
                    <div className="sticky top-4 relative" style={{ height: "calc(100vh - 10rem)" }}>
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
                      <PdfViewer invoice={invoices.find((i) => i.id === activeInvoiceId) ?? null} />
                    </div>
                  </div>
                </div>
              )}
            </PdfDropTarget>
          )}
        </main>
      </div>
    </div>
  );
}
