import { NextRequest, NextResponse } from "next/server";
import { parseExcelBuffer, buildInvoicesFromExcelRows } from "@/shared/lib/excel/excel-importer";
import type { OdooMasters } from "@/shared/types";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const mastersRaw = formData.get("masters") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No se ha enviado ningún archivo Excel" },
        { status: 400 }
      );
    }

    const masters: OdooMasters | null = mastersRaw ? JSON.parse(mastersRaw) : null;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse Excel rows
    const rows = await parseExcelBuffer(buffer);

    // Group rows and map to Odoo masters
    const invoices = buildInvoicesFromExcelRows(rows, masters);

    return NextResponse.json({ invoices });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al procesar el archivo Excel";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
