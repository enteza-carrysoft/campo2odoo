/**
 * Credenciales que solo existen en el servidor (variables de entorno).
 *
 * El navegador nunca recibe las claves: envía las suyas si el usuario las ha
 * escrito en Configuración, y si no, el servidor usa las de entorno. Las claves
 * de entorno solo se usan contra el mismo servidor configurado en el entorno,
 * para que nadie pueda hacer que se envíen a una URL distinta.
 */

const same = (a: string, b: string) => a.trim().replace(/\/+$/, "").toLowerCase() === b.trim().replace(/\/+$/, "").toLowerCase();

export interface OdooCredentials {
  odooUrl: string;
  odooDb: string;
  odooUsername: string;
  odooApiKey: string;
}

export function resolveOdooCredentials(input: Partial<OdooCredentials>): OdooCredentials {
  const env = {
    odooUrl: process.env.ODOO_URL ?? "",
    odooDb: process.env.ODOO_DB ?? "",
    odooUsername: process.env.ODOO_USERNAME ?? "",
    odooApiKey: process.env.ODOO_API_KEY ?? "",
  };
  const creds = {
    odooUrl: input.odooUrl || env.odooUrl,
    odooDb: input.odooDb || env.odooDb,
    odooUsername: input.odooUsername || env.odooUsername,
    odooApiKey: input.odooApiKey ?? "",
  };
  const matchesEnv =
    same(creds.odooUrl, env.odooUrl) && creds.odooDb === env.odooDb && creds.odooUsername === env.odooUsername;
  if (!creds.odooApiKey && matchesEnv) creds.odooApiKey = env.odooApiKey;

  if (!creds.odooUrl || !creds.odooDb || !creds.odooUsername || !creds.odooApiKey) {
    throw new Error("Faltan credenciales de Odoo: completa URL, base de datos, usuario y API key en Configuración.");
  }
  return creds;
}

export function resolveAzureCredentials(input: { endpoint?: string | null; apiKey?: string | null }) {
  const envEndpoint = process.env.AZURE_DI_ENDPOINT ?? "";
  const endpoint = input.endpoint || envEndpoint;
  let apiKey = input.apiKey || "";
  if (!apiKey && envEndpoint && same(endpoint, envEndpoint)) apiKey = process.env.AZURE_DI_KEY ?? "";
  return {
    endpoint: endpoint || undefined,
    apiKey: apiKey || undefined,
    modelId: process.env.AZURE_DI_MODEL_ID || undefined,
  };
}

/** Qué claves tiene el servidor, sin revelarlas. */
export function serverSecretFlags() {
  return {
    odooApiKey: !!process.env.ODOO_API_KEY,
    azureDiKey: !!process.env.AZURE_DI_KEY,
  };
}
