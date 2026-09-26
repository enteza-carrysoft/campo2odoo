import { NextRequest, NextResponse } from "next/server";
import { extractInvoice } from "@/shared/lib/extraction";
import { splitPdfPages } from "@/shared/lib/extraction/pdf-splitter";
import { resolveAzureCredentials } from "@/shared/lib/server-credentials";
import { extractRequestSchema } from "@/shared/schemas/invoice";

// Un PDF de muchas páginas con Azure puede tardar; el máximo por defecto en Vercel es 300 s.
export const maxDuration = 300;

const MAX_PDF_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No se ha enviado ningún archivo" }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: "El PDF supera 20 MB" }, { status: 400 });
    }

    const parsed = extractRequestSchema.safeParse({
      engine: formData.get("engine") ?? undefined,
      azureDiEndpoint: formData.get("azureDiEndpoint") ?? undefined,
      azureDiKey: formData.get("azureDiKey") ?? undefined,
      noSplit: formData.get("noSplit") ?? undefined,
      ownTaxIds: formData.get("ownTaxIds") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { engine, noSplit, ownTaxIds } = parsed.data;
    const azure = resolveAzureCredentials({ endpoint: parsed.data.azureDiEndpoint, apiKey: parsed.data.azureDiKey });

    const buffer = Buffer.from(await file.arrayBuffer());
    const invoices = await extractInvoice(buffer, {
      engine,
      azureDiEndpoint: azure.endpoint,
      azureDiKey: azure.apiKey,
      azureDiModelId: azure.modelId,
      noSplit,
      ownTaxIds,
    });

    const results = await Promise.all(
      invoices.map(async (extracted) => {
        let dataBase64 = buffer.toString("base64");
        if (extracted.pageRange?.length) {
          try {
            dataBase64 = (await splitPdfPages(buffer, extracted.pageRange)).toString("base64");
          } catch (splitErr) {
            console.error("Error dividiendo el PDF, se usa el original:", splitErr);
          }
        }
        return { extracted, dataBase64 };
      })
    );

    return NextResponse.json(results);
  } catch (err) {
    console.error("Error during extraction:", err);
    const message = err instanceof Error ? err.message : "Error de extracción";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
