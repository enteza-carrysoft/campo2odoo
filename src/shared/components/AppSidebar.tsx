"use client";

import type { ReactNode } from "react";
import {
  Settings,
  FileSearch,
  UploadCloud,
  PanelLeftClose,
  LogOut,
  Zap,
} from "lucide-react";

export type AppView = "config" | "review" | "bulk";

interface Props {
  view: AppView;
  onNavigate: (view: AppView) => void;
  collapsed: boolean;
  onToggle: () => void;
  invoiceCount: number;
  pendingCount: number;
  odooVersion: string;
}

interface NavItemProps {
  icon: ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  badge?: number;
  indent?: boolean;
  onClick: () => void;
}

function NavItem({ icon, label, active, collapsed, badge, indent, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`relative w-full flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors
        ${collapsed ? "justify-center px-0" : indent ? "pl-7 pr-3" : "px-3"}
        ${active ? "bg-sky-50 text-sky-700" : "text-gray-600 hover:bg-gray-100 hover:text-gray-800"}`}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="flex-1 text-left truncate">{label}</span>}
      {!!badge && (
        <span
          className={`text-[10px] font-semibold rounded-full bg-sky-600 text-white leading-none
            ${collapsed ? "absolute top-0.5 right-1 px-1 py-0.5" : "px-1.5 py-1"}`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

export function AppSidebar({
  view,
  onNavigate,
  collapsed,
  onToggle,
  invoiceCount,
  pendingCount,
  odooVersion,
}: Props) {
  return (
    <aside
      inert={collapsed}
      className={`sticky top-0 h-screen shrink-0 bg-white flex flex-col overflow-hidden transition-[width] duration-200
        ${collapsed ? "w-0" : "w-56 border-r border-gray-200"}`}
    >
      <div className={`flex items-center gap-3 h-14 border-b border-gray-100 ${collapsed ? "justify-center" : "px-4"}`}>
        <div className="w-8 h-8 shrink-0 rounded-lg bg-sky-600 flex items-center justify-center">
          <Zap size={18} className="text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-bold text-gray-800 leading-tight">Campo2Odoo</p>
            <p className="text-[11px] text-gray-400 leading-tight">PDF → Odoo {odooVersion}</p>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        <NavItem
          icon={<Settings size={18} />}
          label="Configuración"
          active={view === "config"}
          collapsed={collapsed}
          onClick={() => onNavigate("config")}
        />

        {collapsed ? (
          <div className="my-2 border-t border-gray-100" />
        ) : (
          <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Facturas
          </p>
        )}

        <NavItem
          icon={<FileSearch size={18} />}
          label="Revisión"
          active={view === "review"}
          collapsed={collapsed}
          badge={invoiceCount}
          indent
          onClick={() => onNavigate("review")}
        />
        <NavItem
          icon={<UploadCloud size={18} />}
          label="Carga masiva"
          active={view === "bulk"}
          collapsed={collapsed}
          badge={pendingCount}
          indent
          onClick={() => onNavigate("bulk")}
        />
      </nav>

      <button
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
          window.location.href = "/login";
        }}
        className="flex items-center gap-2 h-10 px-4 border-t border-gray-100 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
      >
        <LogOut size={18} />
        <span>Salir</span>
      </button>
      <button
        onClick={onToggle}
        title="Ocultar menú"
        className="flex items-center gap-2 h-11 px-4 border-t border-gray-100 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
      >
        <PanelLeftClose size={18} />
        <span>Ocultar menú</span>
      </button>
    </aside>
  );
}
