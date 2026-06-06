"use client";

import { useState } from "react";
import type { AppConfig, OdooMasters } from "@/shared/types";
import { CheckCircle, XCircle, Loader2, RefreshCw, Server, Bookmark, Save } from "lucide-react";
import { cx } from "@/shared/styles";

interface Props {
  config: AppConfig;
  onChange: (c: AppConfig) => void;
  onMastersLoaded: (m: OdooMasters) => void;
  masters: OdooMasters | null;
}

type TestStatus = "idle" | "testing" | "ok" | "error";
type MastersStatus = "idle" | "loading" | "ok" | "error";

export function ConfigPanel({ config, onChange, onMastersLoaded, masters }: Props) {
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMessage, setTestMessage] = useState("");
  const [mastersStatus, setMastersStatus] = useState<MastersStatus>("idle");
  const [mastersMessage, setMastersMessage] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");

  function set<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    onChange({ ...config, [key]: value });
  }

  async function handleTest() {
    setTestStatus("testing");
    setTestMessage("");
    try {
      const res = await fetch("/api/odoo/test", {
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
      if (!res.ok || data.error) throw new Error(data.error ?? "Error");
      const names = data.companies?.map((c: { name: string }) => c.name).join(", ") ?? "";
      setTestStatus("ok");
      setTestMessage(`UID ${data.uid} — Empresas: ${names}`);
    } catch (err) {
      setTestStatus("error");
      setTestMessage(err instanceof Error ? err.message : "Error de conexión");
    }
  }

  async function handleLoadMasters() {
    setMastersStatus("loading");
    setMastersMessage("");
    try {
      const res = await fetch("/api/odoo/masters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          odooUrl: config.odooUrl,
          odooDb: config.odooDb,
          odooUsername: config.odooUsername,
          odooApiKey: config.odooApiKey,
          odooVersion: config.odooVersion,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Error");
      onMastersLoaded(data);
      setMastersStatus("ok");
      setCompanyName(data.companyName ?? "");
      setMastersMessage(
        `${data.partners.length} proveedores · ${data.accounts.length} cuentas · ${data.taxes.length} impuestos · ${data.journals.length} diarios`
      );
    } catch (err) {
      setMastersStatus("error");
      setMastersMessage(err instanceof Error ? err.message : "Error al cargar");
    }
  }

  async function handleSaveEnv() {
    setSaveStatus("saving");
    setSaveMessage("");
    try {
      const res = await fetch("/api/config/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultJournalMap: config.defaultJournalMap,
          defaultAccountMap: config.defaultAccountMap,
          defaultTaxMap: config.defaultTaxMap,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Error");
      setSaveStatus("ok");
      setSaveMessage("Guardado en .env.local correctamente.");
    } catch (err) {
      setSaveStatus("error");
      setSaveMessage(err instanceof Error ? err.message : "Error al guardar");
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
      <div className="flex items-center gap-2 text-gray-700 font-semibold text-lg">
        <Server size={20} />
        <span>Conexión con Odoo 18</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="URL de Odoo" required>
          <input
            type="url"
            value={config.odooUrl}
            onChange={(e) => set("odooUrl", e.target.value)}
            placeholder="https://miempresa.odoo.com"
            className={cx.input}
          />
        </Field>
        <Field label="Base de datos" required>
          <input
            type="text"
            value={config.odooDb}
            onChange={(e) => set("odooDb", e.target.value)}
            placeholder="miempresa"
            className={cx.input}
          />
        </Field>
        <Field label="Usuario" required>
          <input
            type="email"
            value={config.odooUsername}
            onChange={(e) => set("odooUsername", e.target.value)}
            placeholder="usuario@empresa.com"
            className={cx.input}
          />
        </Field>
        <Field label="API Key" required>
          <input
            type="password"
            value={config.odooApiKey}
            onChange={(e) => set("odooApiKey", e.target.value)}
            placeholder="••••••••••••••••"
            className={cx.input}
          />
        </Field>
      </div>

      {/* Versión de Odoo */}
      <div>
        <p className="text-xs font-medium text-gray-600 uppercase tracking-wide mb-2">Versión de Odoo</p>
        <div className="flex gap-2">
          {([["15", "Odoo 15 Community/Enterprise"], ["18", "Odoo 16 / 17 / 18"]] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => set("odooVersion", v)}
              className={`px-4 py-2 rounded-lg border text-sm transition-colors
                ${config.odooVersion === v
                  ? "bg-sky-50 border-sky-400 text-sky-700 font-medium"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={handleTest}
          disabled={testStatus === "testing"}
          className={cx.btnOutline}
        >
          {testStatus === "testing" ? (
            <Loader2 size={16} className="animate-spin mr-1" />
          ) : null}
          Probar conexión
        </button>
        {testStatus === "ok" && (
          <span className="flex items-center gap-1 text-green-600 text-sm">
            <CheckCircle size={16} /> {testMessage}
          </span>
        )}
        {testStatus === "error" && (
          <span className="flex items-center gap-1 text-red-600 text-sm">
            <XCircle size={16} /> {testMessage}
          </span>
        )}
      </div>

      <hr className="border-gray-100" />

      {/* Extraction engine */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-3">Motor de extracción</p>
        <div className="flex flex-wrap gap-3">
          {(
            [
              { id: "native", label: "Texto nativo", desc: "Gratis · PDFs con texto embebido" },
              { id: "azure-di", label: "Azure Document Intelligence", desc: "Alta precisión · requiere credenciales" },
              { id: "llm", label: "LLM Vision", desc: "No disponible aún" },
            ] as const
          ).map((e) => (
            <button
              key={e.id}
              onClick={() => set("extractionEngine", e.id)}
              disabled={e.id === "llm"}
              className={`px-4 py-2 rounded-lg border text-sm transition-colors
                ${config.extractionEngine === e.id
                  ? "bg-sky-50 border-sky-400 text-sky-700 font-medium"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"}
                ${e.id === "llm" ? "opacity-40 cursor-not-allowed" : ""}
              `}
            >
              <span className="font-medium">{e.label}</span>
              <span className="block text-xs opacity-70">{e.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {config.extractionEngine === "azure-di" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-sky-50 rounded-lg border border-sky-100">
          <Field label="Azure DI Endpoint" required>
            <input
              type="url"
              value={config.azureDiEndpoint}
              onChange={(e) => set("azureDiEndpoint", e.target.value)}
              placeholder="https://myresource.cognitiveservices.azure.com"
              className={cx.input}
            />
          </Field>
          <Field label="Azure DI API Key" required>
            <input
              type="password"
              value={config.azureDiKey}
              onChange={(e) => set("azureDiKey", e.target.value)}
              placeholder="••••••••••••••••"
              className={cx.input}
            />
          </Field>
        </div>
      )}

      <hr className="border-gray-100" />

      {/* Masters */}
      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={handleLoadMasters}
          disabled={mastersStatus === "loading"}
          className={cx.btnPrimary}
        >
          {mastersStatus === "loading" ? (
            <Loader2 size={16} className="animate-spin mr-1" />
          ) : (
            <RefreshCw size={16} className="mr-1" />
          )}
          Cargar maestros de Odoo
        </button>
        {mastersStatus === "ok" && (
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1 text-green-600 text-sm">
              <CheckCircle size={16} /> {mastersMessage}
            </span>
            {companyName && (
              <span className="text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded px-2 py-0.5 w-fit">
                🏢 Empresa activa: <strong>{companyName}</strong>
              </span>
            )}
          </div>
        )}
        {mastersStatus === "error" && (
          <span className="flex items-center gap-1 text-red-600 text-sm">
            <XCircle size={16} /> {mastersMessage}
          </span>
        )}
      </div>

      {/* Valores por defecto por empresa — solo visible cuando los maestros están cargados */}
      {masters && masters.companies.length > 0 && (
        <>
          <hr className="border-gray-100" />
          <div>
            <div className="flex items-center gap-2 text-gray-700 font-semibold mb-1">
              <Bookmark size={16} />
              <span className="text-sm">Valores por defecto por empresa</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Se aplican automáticamente al extraer facturas. Editables en <code className="bg-gray-100 px-1 rounded">.env.local</code> con <code className="bg-gray-100 px-1 rounded">DEFAULT_JOURNAL_MAP</code>, <code className="bg-gray-100 px-1 rounded">DEFAULT_ACCOUNT_MAP</code> y <code className="bg-gray-100 px-1 rounded">DEFAULT_TAX_MAP</code>.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-100">
                    <th className="text-left pb-2 font-medium pr-3">Empresa</th>
                    <th className="text-left pb-2 font-medium pr-3">Diario por defecto</th>
                    <th className="text-left pb-2 font-medium pr-3">Cuenta de gastos</th>
                    <th className="text-left pb-2 font-medium">Impuesto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {masters.companies.map((company) => {
                    const cId = String(company.id);
                    const companyJournals = masters.journals.filter(
                      (j) => j.company_id && j.company_id[0] === company.id
                    );
                    const companyAccounts = masters.accounts.filter(
                      (a) => !a.company_ids.length || a.company_ids.includes(company.id)
                    );
                    const companyTaxes = masters.taxes.filter(
                      (t) => !t.company_id || t.company_id[0] === company.id
                    );
                    return (
                      <tr key={company.id}>
                        <td className="py-2 pr-3 font-medium text-gray-700 whitespace-nowrap">{company.name}</td>
                        <td className="py-2 pr-3">
                          <select
                            value={config.defaultJournalMap[cId] ?? ""}
                            onChange={(e) => {
                              const map = { ...config.defaultJournalMap };
                              if (e.target.value) map[cId] = Number(e.target.value);
                              else delete map[cId];
                              set("defaultJournalMap", map);
                            }}
                            className={`${cx.select} text-xs w-full`}
                          >
                            <option value="">—</option>
                            {companyJournals.map((j) => (
                              <option key={j.id} value={j.id}>{j.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 pr-3">
                          <select
                            value={config.defaultAccountMap[cId] ?? ""}
                            onChange={(e) => {
                              const map = { ...config.defaultAccountMap };
                              if (e.target.value) map[cId] = Number(e.target.value);
                              else delete map[cId];
                              set("defaultAccountMap", map);
                            }}
                            className={`${cx.select} text-xs w-full`}
                          >
                            <option value="">—</option>
                            {companyAccounts.map((a) => (
                              <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2">
                          <select
                            value={config.defaultTaxMap[cId] ?? ""}
                            onChange={(e) => {
                              const map = { ...config.defaultTaxMap };
                              if (e.target.value) map[cId] = Number(e.target.value);
                              else delete map[cId];
                              set("defaultTaxMap", map);
                            }}
                            className={`${cx.select} text-xs w-full`}
                          >
                            <option value="">—</option>
                            {companyTaxes.map((t) => (
                              <option key={t.id} value={t.id}>{t.name} ({t.amount}%)</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Botón guardar en .env.local */}
            <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-gray-100">
              <button
                onClick={handleSaveEnv}
                disabled={saveStatus === "saving"}
                className={cx.btnOutline}
              >
                {saveStatus === "saving"
                  ? <Loader2 size={15} className="animate-spin mr-1.5" />
                  : <Save size={15} className="mr-1.5" />}
                Guardar en .env.local
              </button>
              {saveStatus === "ok" && (
                <span className="flex items-center gap-1 text-green-600 text-sm">
                  <CheckCircle size={15} /> {saveMessage}
                </span>
              )}
              {saveStatus === "error" && (
                <span className="flex items-center gap-1 text-red-600 text-sm">
                  <XCircle size={15} /> {saveMessage}
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
