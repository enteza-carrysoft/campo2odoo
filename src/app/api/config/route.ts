import { NextResponse } from "next/server";
import { serverSecretFlags } from "@/shared/lib/server-credentials";

/**
 * Devuelve los valores de configuración disponibles en las variables de entorno
 * del servidor (.env.local). El cliente los usa para pre-poblar el formulario
 * sin que el usuario tenga que introducir las credenciales manualmente.
 *
 * Las claves (API key de Odoo, clave de Azure) NUNCA se devuelven: solo se
 * indica si el servidor las tiene, y las rutas de API las usan directamente.
 */

function parseMap(raw: string | undefined): Record<string, number> | null {
  if (!raw) return null;
  const map: Record<string, number> = {};
  raw.split(",").forEach((pair) => {
    const [cStr, vStr] = pair.trim().split(":");
    const cId = parseInt(cStr);
    const vId = parseInt(vStr);
    if (!isNaN(cId) && !isNaN(vId)) map[String(cId)] = vId;
  });
  return Object.keys(map).length > 0 ? map : null;
}

export async function GET() {
  const strings: Record<string, string | null> = {
    odooUrl: process.env.ODOO_URL ?? null,
    odooDb: process.env.ODOO_DB ?? null,
    odooUsername: process.env.ODOO_USERNAME ?? null,
    azureDiEndpoint: process.env.AZURE_DI_ENDPOINT ?? null,
  };

  const present: Record<string, unknown> = Object.fromEntries(
    Object.entries(strings).filter(([, v]) => v !== null && v !== "")
  );

  // Mapas empresa → valor por defecto. Formato: IDempresa:IDvalor,IDempresa:IDvalor
  const journalMap = parseMap(process.env.DEFAULT_JOURNAL_MAP);
  const accountMap = parseMap(process.env.DEFAULT_ACCOUNT_MAP);
  const taxMap     = parseMap(process.env.DEFAULT_TAX_MAP);
  if (journalMap) present.defaultJournalMap = journalMap;
  if (accountMap) present.defaultAccountMap = accountMap;
  if (taxMap)     present.defaultTaxMap     = taxMap;

  present.serverSecrets = serverSecretFlags();
  return NextResponse.json(present);
}
