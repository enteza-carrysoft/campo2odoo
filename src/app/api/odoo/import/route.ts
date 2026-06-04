import { NextRequest, NextResponse } from "next/server";
import { OdooClient } from "@/shared/lib/odoo/client";
import { importInvoiceToOdoo } from "@/shared/lib/odoo/importer";
import { importInvoiceSchema } from "@/shared/schemas/invoice";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = importInvoiceSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        { error: `${firstError.path.join(".")}: ${firstError.message}` },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const client = new OdooClient(
      data.odooUrl,
      data.odooDb,
      data.odooUsername,
      data.odooApiKey
    );

    const result = await importInvoiceToOdoo(client, data);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al importar";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
