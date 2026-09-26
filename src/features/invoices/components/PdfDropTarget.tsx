"use client";

import { useRef, useState, type ReactNode } from "react";
import { Upload } from "lucide-react";

interface Props {
  onFiles: (files: File[]) => void;
  children: ReactNode;
}

const isPdf = (f: File) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");

/** Permite soltar PDFs en cualquier parte de su contenido, mostrando un overlay. */
export function PdfDropTarget({ onFiles, children }: Props) {
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave se disparan en cada hijo: se cuenta la profundidad para evitar parpadeos
  const depth = useRef(0);

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  return (
    <div
      className="relative"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        const pdfs = Array.from(e.dataTransfer.files).filter(isPdf);
        if (pdfs.length > 0) onFiles(pdfs);
      }}
    >
      {children}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 rounded-xl border-2 border-dashed border-sky-400 bg-sky-50/80 flex items-center justify-center">
          <div className="flex items-center gap-2 text-sky-700 font-medium">
            <Upload size={20} />
            Suelta los PDF para añadirlos
          </div>
        </div>
      )}
    </div>
  );
}
