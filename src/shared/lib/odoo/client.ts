interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: { message: string; name?: string; debug?: string };
  };
}

// Debug activado por defecto. Pon ODOO_DEBUG=false en .env.local para silenciar.
const ODOO_DEBUG = (process.env.ODOO_DEBUG ?? "true").toLowerCase() !== "false";

/** Log estructurado por consola del servidor. Nunca imprime la API key. */
function odooLog(...parts: unknown[]): void {
  if (!ODOO_DEBUG) return;
  // eslint-disable-next-line no-console
  console.log("[odoo]", ...parts);
}

/** Resumen corto y seguro de los args de una llamada (sin credenciales). */
function summarizeArgs(service: string, method: string, args: unknown[]): string {
  try {
    if (service === "object" && method === "execute_kw") {
      // [db, uid, apiKey, model, method, args, kwargs]
      const model = args[3];
      const orm = args[4];
      const ormArgs = args[5];
      const kwargs = args[6] as Record<string, unknown> | undefined;
      const domain = Array.isArray(ormArgs) ? JSON.stringify(ormArgs[0]) : "";
      const fields = kwargs?.fields ? `fields=${(kwargs.fields as string[]).length}` : "";
      const limit = kwargs?.limit != null ? `limit=${kwargs.limit}` : "";
      const ctx = kwargs?.context ? `ctx=${JSON.stringify(kwargs.context)}` : "";
      return [`${model}.${orm}`, domain, fields, limit, ctx].filter(Boolean).join(" ");
    }
    if (service === "common" && method === "authenticate") {
      // [db, username, apiKey, {}]
      return `db=${args[0]} user=${args[1]} apiKey=***`;
    }
  } catch {
    /* noop */
  }
  return `${service}.${method}`;
}

/** Convierte un fallo de red de undici en un mensaje accionable en español. */
function describeNetworkError(endpoint: string, err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };

  // Timeout de AbortSignal.timeout()
  if (e?.name === "TimeoutError") {
    return `Tiempo de espera agotado (30s) conectando con ${endpoint}. El servidor de Odoo no respondió a tiempo.`;
  }

  const code = e?.cause?.code;
  const causeMsg = e?.cause?.message ?? e?.message ?? "error desconocido";

  const hints: Record<string, string> = {
    ENOTFOUND: "El host no existe o el DNS no resuelve. Revisa que ODOO_URL sea correcto (dominio/subdominio).",
    EAI_AGAIN: "Fallo temporal de DNS. Revisa tu conexión a internet o el dominio de ODOO_URL.",
    ECONNREFUSED: "Conexión rechazada. ¿Está el servidor levantado y el puerto/HTTPS es correcto?",
    ECONNRESET: "La conexión se cerró inesperadamente (servidor o proxy intermedio).",
    ETIMEDOUT: "Tiempo de conexión agotado. El servidor no es accesible desde aquí (firewall/red).",
    UND_ERR_CONNECT_TIMEOUT: "Tiempo de conexión agotado al abrir el socket.",
    CERT_HAS_EXPIRED: "El certificado SSL del servidor ha caducado.",
    DEPTH_ZERO_SELF_SIGNED_CERT: "Certificado SSL autofirmado no confiable.",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "No se pudo verificar la cadena del certificado SSL.",
    ERR_TLS_CERT_ALTNAME_INVALID: "El certificado SSL no coincide con el dominio de ODOO_URL.",
  };

  const hint = code && hints[code] ? hints[code] : "";
  const codePart = code ? `[${code}] ` : "";
  return `No se pudo conectar con Odoo (${endpoint}): ${codePart}${causeMsg}.${hint ? " " + hint : ""}`;
}

export class OdooClient {
  private uid: number | null = null;
  private readonly url: string;
  private static reqSeq = 0;

  constructor(
    url: string,
    private readonly db: string,
    private readonly username: string,
    private readonly apiKey: string
  ) {
    // Normaliza: sin barra final para evitar "//jsonrpc".
    this.url = (url ?? "").trim().replace(/\/+$/, "");
    if (this.url) {
      odooLog(`cliente creado → url=${this.url} db=${this.db} user=${this.username}`);
    } else {
      odooLog("⚠ cliente creado con URL vacía");
    }
  }

  async authenticate(): Promise<number> {
    const uid = await this.jsonRpc<number>("common", "authenticate", [
      this.db,
      this.username,
      this.apiKey,
      {},
    ]);
    if (!uid) throw new Error("Credenciales incorrectas o usuario sin acceso.");
    this.uid = uid;
    odooLog(`autenticado uid=${uid}`);
    return uid;
  }

  async executeKw<T>(
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {}
  ): Promise<T> {
    if (!this.uid) await this.authenticate();
    return this.jsonRpc<T>("object", "execute_kw", [
      this.db,
      this.uid!,
      this.apiKey,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  async searchRead<T>(
    model: string,
    domain: unknown[],
    fields: string[],
    opts: {
      limit?: number | false;
      order?: string;
      context?: Record<string, unknown>;
    } = {}
  ): Promise<T[]> {
    const kwargs: Record<string, unknown> = { fields };
    if (opts.limit !== false) kwargs.limit = opts.limit ?? 200;
    if (opts.order) kwargs.order = opts.order;
    if (opts.context) kwargs.context = opts.context;
    return this.executeKw<T[]>(model, "search_read", [domain], kwargs);
  }

  async create(model: string, vals: Record<string, unknown>): Promise<number> {
    return this.executeKw<number>(model, "create", [vals]);
  }

  async callMethod<T>(model: string, method: string, ids: number[]): Promise<T> {
    return this.executeKw<T>(model, method, [ids]);
  }

  private async jsonRpc<T>(
    service: string,
    method: string,
    args: unknown[]
  ): Promise<T> {
    if (!this.url) {
      throw new Error("URL de Odoo vacía. Configura ODOO_URL en la pestaña Configuración.");
    }

    const endpoint = `${this.url}/jsonrpc`;
    const reqId = ++OdooClient.reqSeq;
    const started = Date.now();
    const label = summarizeArgs(service, method, args);

    odooLog(`→ #${reqId} ${label}`);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "call",
          id: reqId,
          params: { service, method, args },
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      const ms = Date.now() - started;
      const cause = (err as { cause?: { code?: string } })?.cause;
      odooLog(
        `✗ #${reqId} FALLO DE RED en ${ms}ms ·`,
        `name=${(err as Error)?.name} code=${cause?.code ?? "-"} msg=${(err as Error)?.message}`
      );
      throw new Error(describeNetworkError(endpoint, err));
    }

    const ms = Date.now() - started;

    if (!response.ok) {
      let bodySnippet = "";
      try {
        bodySnippet = (await response.text()).slice(0, 300);
      } catch {
        /* noop */
      }
      odooLog(`✗ #${reqId} HTTP ${response.status} ${response.statusText} en ${ms}ms`, bodySnippet);
      throw new Error(
        `HTTP ${response.status} ${response.statusText} desde ${endpoint}.${
          bodySnippet ? ` Respuesta: ${bodySnippet}` : ""
        }`
      );
    }

    let data: JsonRpcResponse<T>;
    try {
      data = await response.json();
    } catch (err) {
      odooLog(`✗ #${reqId} respuesta no-JSON en ${ms}ms`, (err as Error)?.message);
      throw new Error(
        `Respuesta inválida de Odoo (no es JSON) desde ${endpoint}. ¿La URL apunta realmente a una instancia de Odoo?`
      );
    }

    if (data.error) {
      const msg =
        data.error.data?.message ||
        data.error.message ||
        "Error desconocido de Odoo";
      odooLog(
        `✗ #${reqId} ERROR ODOO en ${ms}ms ·`,
        `code=${data.error.code} name=${data.error.data?.name ?? "-"} msg=${msg}`
      );
      if (data.error.data?.debug && ODOO_DEBUG) {
        odooLog(`   traza Odoo #${reqId}:`, data.error.data.debug.slice(0, 1500));
      }
      throw new Error(msg);
    }

    const size = Array.isArray(data.result) ? `${data.result.length} reg.` : "ok";
    odooLog(`← #${reqId} ${label} · ${ms}ms · ${size}`);

    return data.result as T;
  }
}
