"use client";

import { useState } from "react";
import { Loader2, Lock, Zap } from "lucide-react";
import { cx } from "@/shared/styles";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo entrar");
      // Solo rutas internas: evita redirecciones abiertas a otros dominios.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo entrar");
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white border border-gray-200 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-600 flex items-center justify-center">
            <Zap size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-800">Campo2Odoo</h1>
            <p className="text-xs text-gray-400">Acceso restringido</p>
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Contraseña</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={cx.input}
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={loading || !password} className={`${cx.btnPrimary} w-full`}>
          {loading ? <Loader2 size={16} className="animate-spin mr-1" /> : <Lock size={16} className="mr-1" />}
          Entrar
        </button>
      </form>
    </main>
  );
}
