"use client";

import { useRef, useState } from "react";
import { Upload, FileText } from "lucide-react";

interface Props {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export function UploadZone({ onFiles, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handle(files: FileList | null) {
    if (!files) return;
    const pdfs = Array.from(files).filter(
      (f) => f.type === "application/pdf" || f.name.endsWith(".pdf")
    );
    if (pdfs.length > 0) onFiles(pdfs);
  }

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handle(e.dataTransfer.files);
      }}
      className={`
        border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
        ${dragging ? "border-sky-400 bg-sky-50" : "border-gray-200 hover:border-sky-300 hover:bg-gray-50"}
        ${disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => handle(e.target.files)}
      />
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <div className="flex gap-2">
          <Upload size={32} />
          <FileText size={32} />
        </div>
        <div>
          <p className="text-base font-medium text-gray-600">
            Arrastra las facturas PDF aquí
          </p>
          <p className="text-sm">o haz clic para seleccionar archivos</p>
        </div>
        <p className="text-xs text-gray-300">Solo archivos PDF · múltiples a la vez</p>
      </div>
    </div>
  );
}
