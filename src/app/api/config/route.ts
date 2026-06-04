import { NextResponse } from "next/server";

/**
 * Devuelve los valores de configuración disponibles en las variables de entorno
 * del servidor (.env.local). El cliente los usa para pre-poblar el formulario
 * sin que el usuario tenga que introducir las credenciales manualmente.
 *
 * Solo se exponen los campos que ya están en el formulario de configuración;
 * nunca se exponen secretos a través de variables NEXT_PUBLIC.
 */
export async function GET() {
  const config: Record<string, string | null> = {
    odooUrl: process.env.ODOO_URL ?? null,
    odooDb: process.env.ODOO_DB ?? null,
    odooUsername: process.env.ODOO_USERNAME ?? null,
    odooApiKey: process.env.ODOO_API_KEY ?? null,
    azureDiEndpoint: process.env.AZURE_DI_ENDPOINT ?? null,
    azureDiKey: process.env.AZURE_DI_KEY ?? null,
  };

  // Eliminar los nulos para que el cliente sepa qué está configurado
  const present = Object.fromEntries(
    Object.entries(config).filter(([, v]) => v !== null && v !== "")
  );

  return NextResponse.json(present);
}
