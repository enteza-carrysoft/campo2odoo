/**
 * Cliente mínimo de Azure Document Intelligence (API REST v4, 2024-11-30).
 * La v4 mejora el modelo prebuilt-invoice (desglose de IVA, NIF del cliente,
 * más idiomas) respecto a la v3 del SDK @azure/ai-form-recognizer.
 */

const API_VERSION = "2024-11-30";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_POLL_MS = 120_000;
const MAX_RETRIES = 5;

export interface DIField {
  type?: string;
  content?: string;
  confidence?: number;
  valueString?: string;
  valueDate?: string;
  valueNumber?: number;
  valueInteger?: number;
  valueCurrency?: { amount?: number; currencyCode?: string };
  valueArray?: DIField[];
  valueObject?: Record<string, DIField>;
}

export interface DIDocument {
  docType?: string;
  confidence?: number;
  fields?: Record<string, DIField>;
  boundingRegions?: { pageNumber: number }[];
}

export interface DIAnalyzeResult {
  content?: string;
  pages?: { pageNumber: number }[];
  documents?: DIDocument[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(res: Response, fallback: number): number {
  const s = Number(res.headers.get("retry-after"));
  return Number.isFinite(s) && s > 0 ? s * 1000 : fallback;
}

/** fetch con timeout y reintentos ante 429/5xx (límite de peticiones del tier F0/S0). */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) return res;
    await sleep(retryAfterMs(res, 1000 * 2 ** attempt));
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function analyzeDocument(
  pdf: Buffer,
  endpoint: string,
  apiKey: string,
  modelId = "prebuilt-invoice"
): Promise<DIAnalyzeResult> {
  const base = endpoint.replace(/\/+$/, "");
  const url = `${base}/documentintelligence/documentModels/${encodeURIComponent(modelId)}:analyze?api-version=${API_VERSION}`;
  const headers = { "Ocp-Apim-Subscription-Key": apiKey };

  const start = await fetchWithRetry(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ base64Source: pdf.toString("base64") }),
  });
  if (start.status === 401) throw new Error("Azure DI rechazó la clave (401). Revisa la API key.");
  if (start.status !== 202) throw new Error(`Azure DI: ${await errorMessage(start)}`);

  const operationUrl = start.headers.get("operation-location");
  if (!operationUrl) throw new Error("Azure DI no devolvió la URL de la operación.");

  const deadline = Date.now() + MAX_POLL_MS;
  let wait = retryAfterMs(start, 1000);
  while (Date.now() < deadline) {
    await sleep(wait);
    const poll = await fetchWithRetry(operationUrl, { headers });
    if (!poll.ok) throw new Error(`Azure DI: ${await errorMessage(poll)}`);
    const body = await poll.json();
    if (body.status === "succeeded") return body.analyzeResult ?? {};
    if (body.status === "failed") {
      throw new Error(`Azure DI no pudo analizar el documento: ${body.error?.message ?? "error desconocido"}`);
    }
    wait = retryAfterMs(poll, 1000);
  }
  throw new Error("Azure DI tardó demasiado en analizar el documento.");
}
