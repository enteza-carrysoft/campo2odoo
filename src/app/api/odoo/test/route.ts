import { NextRequest, NextResponse } from "next/server";
import { OdooClient } from "@/shared/lib/odoo/client";
import { odooTestSchema } from "@/shared/schemas/invoice";

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
    const uid = await client.authenticate();

    // Fetch available companies for info
    const companies = await client.searchRead<{ id: number; name: string }>(
      "res.company",
      [],
      ["id", "name"],
      { limit: 50 }
    );

    return NextResponse.json({ success: true, uid, companies });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error de conexión";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
