import { NextRequest, NextResponse } from "next/server";
import { OdooClient } from "@/shared/lib/odoo/client";
import { fetchMasters } from "@/shared/lib/odoo/masters";
import { odooMastersSchema } from "@/shared/schemas/invoice";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = odooMastersSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { odooUrl, odooDb, odooUsername, odooApiKey, odooVersion } = parsed.data;
    const client = new OdooClient(odooUrl, odooDb, odooUsername, odooApiKey);
    const masters = await fetchMasters(client, odooVersion);

    return NextResponse.json(masters);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al cargar maestros";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
