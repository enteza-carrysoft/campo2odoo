"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Send, Zap } from "lucide-react";
import { cx } from "@/shared/styles";
import type { AppConfig, InvoiceFile, OdooMasters } from "@/shared/types";
import { ConfigPanel } from "@/features/config/components/ConfigPanel";
import { UploadZone } from "@/features/invoices/components/UploadZone";
import { InvoiceTable } from "@/features/invoices/components/InvoiceTable";
import { PdfViewer } from "@/features/invoices/components/PdfViewer";

const uuid = () => crypto.randomUUID();

const DEFAULT_CONFIG: AppConfig = {
  odooUrl: "",
  odooDb: "",
  odooUsername: "",
  odooApiKey: "",
  extractionEngine: "native",
  azureDiEndpoint: "",
  azureDiKey: "",
  defaultJournalId: null,
  defaultAccountId: null,
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

export default function Home() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [masters, setMasters] = useState<OdooMasters | null>(null);
  const [invoices, setInvoices] = useState<InvoiceFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<"config" | "facturas">("config");
  const [activeInvoiceId, setActiveInvoiceId] = useState<string | null>(null);

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

  const updateInvoice = useCallback(
    (id: string, updates: Partial<InvoiceFile>) => {
      setInvoices((prev) =>
        prev.map((inv) => (inv.id === id ? { ...inv, ...updates } : inv))
      );
    },
    []
  );

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

        updateInvoice(inv.id, {
          status: "extracted",
          extracted: data,
          lines: data.lines ?? [],
          selectedForImport: true,
        });
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
      if (!inv.partnerId) {
        alert(
          `Selecciona un proveedor para la factura "${inv.name}" antes de importar.`
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
          companyId: inv.companyId ?? masters!.companyId,
          partnerId: inv.partnerId!,
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
          pdfBase64: inv.dataBase64,
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

            {/* Upload zone — always visible */}
            <UploadZone onFiles={handleFiles} />

            {invoices.length > 0 && (
              <>
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
                <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 420px" }}>
                  {/* Left — invoice table (scrollable) */}
                  <div className="min-w-0 overflow-x-auto">
                    <InvoiceTable
                      invoices={invoices}
                      masters={masters}
                      onChange={updateInvoice}
                      activeId={activeInvoiceId}
                      onSelect={setActiveInvoiceId}
                    />
                  </div>

                  {/* Right — sticky PDF viewer */}
                  <div
                    className="sticky top-4"
                    style={{ height: "calc(100vh - 160px)" }}
                  >
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
