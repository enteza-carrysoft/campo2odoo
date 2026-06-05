import { NextRequest, NextResponse } from "next/server";
import { OdooClient } from "@/shared/lib/odoo/client";
import { odooTestSchema } from "@/shared/schemas/invoice";

const ES = { context: { lang: "es_ES" } };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = odooTestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { odooUrl, odooDb, odooUsername, odooApiKey } = parsed.data;
    const client = new OdooClient(odooUrl, odooDb, odooUsername, odooApiKey);

    await client.authenticate();

    const partners = await client.searchRead(
      "res.partner",
      [["supplier_rank", ">", 0]],
      ["id", "name", "vat", "email", "company_id"],
      { limit: 1000, order: "name asc", ...ES }
    );

    return NextResponse.json({ partners });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al cargar proveedores";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
