"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";

interface Props {
  onFile: (file: File) => Promise<void>;
}

export function ExcelUploadZone({ onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handle(files: FileList | null) {
    const file = Array.from(files ?? []).find((f) => f.name.toLowerCase().endsWith(".xlsx"));
    if (!file) return;
    setBusy(true);
    try {
      await onFile(file);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div
      onClick={() => !busy && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!busy) handle(e.dataTransfer.files);
      }}
      className={`h-full border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-colors
        ${busy ? "border-gray-100 bg-gray-50/50 pointer-events-none" : dragging ? "border-emerald-400 bg-emerald-50" : "border-gray-200 hover:border-emerald-300 hover:bg-gray-50"}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => handle(e.target.files)}
      />
      {busy ? (
        <Loader2 size={32} className="animate-spin text-emerald-500 mb-3" />
      ) : (
        <FileSpreadsheet size={32} className="text-gray-400 mb-3" />
      )}
      <p className="text-base font-medium text-gray-600">
        {busy ? "Procesando filas..." : "Arrastra la plantilla Excel aquí"}
      </p>
      <p className="text-sm text-gray-400 mt-1">
        o haz clic para seleccionar el .xlsx
      </p>
      <p className="text-xs text-gray-300 mt-3">
        Las facturas llegan ya extraídas, listas para revisar
      </p>
    </div>
  );
}
