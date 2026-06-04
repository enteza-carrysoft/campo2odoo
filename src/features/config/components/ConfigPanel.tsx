"use client";

import { useState } from "react";
import type { AppConfig, OdooMasters } from "@/shared/types";
import { CheckCircle, XCircle, Loader2, RefreshCw, Server } from "lucide-react";
import { cx } from "@/shared/styles";

interface Props {
  config: AppConfig;
  onChange: (c: AppConfig) => void;
  onMastersLoaded: (m: OdooMasters) => void;
}

type TestStatus = "idle" | "testing" | "ok" | "error";
type MastersStatus = "idle" | "loading" | "ok" | "error";

export function ConfigPanel({ config, onChange, onMastersLoaded }: Props) {
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testMessage, setTestMessage] = useState("");
  const [mastersStatus, setMastersStatus] = useState<MastersStatus>("idle");
  const [mastersMessage, setMastersMessage] = useState("");
  const [companyName, setCompanyName] = useState("");

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
