/**
 * Sesión mínima protegida por contraseña (APP_PASSWORD).
 *
 * La cookie guarda "expiración.firma", con la firma HMAC-SHA256 derivada de la
 * contraseña: cambiar APP_PASSWORD invalida todas las sesiones. Usa Web Crypto
 * para funcionar igual en el proxy y en las rutas de API.
 */

export const SESSION_COOKIE = "c2o_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

async function hmacKey(password: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(`campo2odoo-session:${password}`));
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const toHex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) return null;
  return new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

export function appPassword(): string | null {
  return process.env.APP_PASSWORD || null;
}

export async function createSessionToken(password: string): Promise<string> {
  const expires = String(Date.now() + SESSION_MAX_AGE_S * 1000);
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(password), encoder.encode(expires));
  return `${expires}.${toHex(signature)}`;
}

export async function verifySessionToken(token: string | undefined, password: string): Promise<boolean> {
  const [expires, sigHex] = token?.split(".") ?? [];
  const signature = sigHex ? fromHex(sigHex) : null;
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  // verify() compara en tiempo constante.
  return crypto.subtle.verify("HMAC", await hmacKey(password), signature, encoder.encode(expires));
}

/** Comparación de contraseñas en tiempo constante (vía HMAC de ambas). */
export async function passwordMatches(candidate: string, password: string): Promise<boolean> {
  const key = await hmacKey(password);
  const expected = await crypto.subtle.sign("HMAC", key, encoder.encode(password));
  return crypto.subtle.verify("HMAC", key, expected, encoder.encode(candidate));
}
