import { NextRequest, NextResponse } from "next/server";
import { extractInvoice } from "@/shared/lib/extraction";
import { splitPdfPages } from "@/shared/lib/extraction/pdf-splitter";
import type { ExtractionEngine } from "@/shared/types";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const engine = (formData.get("engine") as ExtractionEngine) ?? "native";
    const azureDiEndpoint = formData.get("azureDiEndpoint") as string | null;
    const azureDiKey = formData.get("azureDiKey") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No se ha enviado ningún archivo" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const invoices = await extractInvoice(buffer, {
      engine,
      azureDiEndpoint: azureDiEndpoint ?? undefined,
      azureDiKey: azureDiKey ?? undefined,
    });

    const results = await Promise.all(
      invoices.map(async (extracted) => {
        let subPdfBase64: string;
        try {
          if (extracted.pageRange && extracted.pageRange.length > 0) {
            const splitBuffer = await splitPdfPages(buffer, extracted.pageRange);
            subPdfBase64 = splitBuffer.toString("base64");
          } else {
            subPdfBase64 = buffer.toString("base64");
          }
        } catch (splitErr) {
          console.error("Error splitting PDF pages, falling back to original:", splitErr);
          subPdfBase64 = buffer.toString("base64");
        }

        return {
          extracted,
          dataBase64: subPdfBase64,
        };
      })
    );

    return NextResponse.json(results);
  } catch (err) {
    console.error("Error during extraction:", err);
    const message = err instanceof Error ? err.message : "Error de extracción";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
