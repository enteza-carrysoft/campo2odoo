import type { ExtractedInvoice, ExtractionEngine } from "@/shared/types";
import { extractWithNative } from "./native";
import { extractWithAzureDI } from "./azure-di";

export interface ExtractOptions {
  engine: ExtractionEngine;
  azureDiEndpoint?: string;
  azureDiKey?: string;
  noSplit?: boolean;
}

export async function extractInvoice(
  pdfBuffer: Buffer,
  opts: ExtractOptions
): Promise<ExtractedInvoice[]> {
  switch (opts.engine) {
    case "azure-di":
      if (!opts.azureDiEndpoint || !opts.azureDiKey) {
        throw new Error(
          "Azure DI requiere endpoint y API key. Configure las credenciales en Configuración."
        );
      }
      return extractWithAzureDI(
        pdfBuffer,
        opts.azureDiEndpoint,
        opts.azureDiKey,
        opts.noSplit ?? false
      );

    case "llm":
      throw new Error(
        "Motor LLM no implementado en esta versión. Use 'Texto nativo' o 'Azure DI'."
      );

    case "native":
    default:
      return extractWithNative(pdfBuffer);
  }
}
