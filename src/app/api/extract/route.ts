import { NextRequest, NextResponse } from "next/server";
import { extractInvoice } from "@/shared/lib/extraction";
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

    const result = await extractInvoice(buffer, {
      engine,
      azureDiEndpoint: azureDiEndpoint ?? undefined,
      azureDiKey: azureDiKey ?? undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error de extracción";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
