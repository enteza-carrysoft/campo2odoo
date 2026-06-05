import { NextRequest, NextResponse } from "next/server";
import { generateExcelBuffer } from "@/shared/lib/excel/excel-exporter";
import type { InvoiceFile, OdooMasters } from "@/shared/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const invoices = body.invoices as InvoiceFile[] | undefined;
    const masters = body.masters as OdooMasters | null | undefined;

    if (!invoices || !Array.isArray(invoices)) {
      return NextResponse.json(
        { error: "No se proporcionó una lista válida de facturas para exportar" },
        { status: 400 }
      );
    }

    const buffer = await generateExcelBuffer(invoices, masters ?? null);

    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="facturas_exportadas.xlsx"',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al exportar a Excel";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
