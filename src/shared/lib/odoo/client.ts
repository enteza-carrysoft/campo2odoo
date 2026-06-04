interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: { message: string } };
}

export class OdooClient {
  private uid: number | null = null;

  constructor(
    private readonly url: string,
    private readonly db: string,
    private readonly username: string,
    private readonly apiKey: string
  ) {}

  async authenticate(): Promise<number> {
    const uid = await this.jsonRpc<number>("common", "authenticate", [
      this.db,
      this.username,
      this.apiKey,
      {},
    ]);
    if (!uid) throw new Error("Credenciales incorrectas o usuario sin acceso.");
    this.uid = uid;
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
    const response = await fetch(`${this.url}/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        id: Date.now(),
        params: { service, method, args },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: JsonRpcResponse<T> = await response.json();

    if (data.error) {
      const msg =
        data.error.data?.message ||
        data.error.message ||
        "Error desconocido de Odoo";
      throw new Error(msg);
    }

    return data.result as T;
  }
}
