import type { ExtractedInvoice, ExtractionEngine } from "@/shared/types";
import { extractWithNative } from "./native";
import { extractWithAzureDI } from "./azure-di";
import { validateInvoice } from "./validate";

export interface ExtractOptions {
  engine: ExtractionEngine;
  azureDiEndpoint?: string;
  azureDiKey?: string;
  azureDiModelId?: string;
  noSplit?: boolean;
  /** NIF de nuestras empresas: ayudan a distinguir proveedor de cliente. */
  ownTaxIds?: string[];
}

async function runEngine(pdfBuffer: Buffer, opts: ExtractOptions): Promise<ExtractedInvoice[]> {
  switch (opts.engine) {
    case "azure-di":
      if (!opts.azureDiEndpoint || !opts.azureDiKey) {
        throw new Error("Azure DI requiere endpoint y API key. Configure las credenciales en Configuración.");
      }
      return extractWithAzureDI(pdfBuffer, opts.azureDiEndpoint, opts.azureDiKey, opts.noSplit ?? false, opts.azureDiModelId);
    case "llm":
      throw new Error("Motor LLM no implementado en esta versión. Use 'Texto nativo' o 'Azure DI'.");
    case "native":
    default:
      return extractWithNative(pdfBuffer);
  }
}

/** Extrae y valida: el texto completo solo se usa aquí y no viaja al navegador. */
export async function extractInvoice(pdfBuffer: Buffer, opts: ExtractOptions): Promise<ExtractedInvoice[]> {
  const raw = await runEngine(pdfBuffer, opts);
  return raw.map(({ rawText, ...inv }) =>
    validateInvoice(inv, { ownTaxIds: opts.ownTaxIds, text: rawText })
  );
}
