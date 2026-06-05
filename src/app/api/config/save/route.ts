import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function mapToEnvString(map: Record<string, number>): string {
  return Object.entries(map)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
}

/**
 * Actualiza las líneas de las claves indicadas en el contenido de un .env.
 * Si una clave no existe, la añade al final del archivo.
 * Las claves obsoletas (old names) se eliminan si se encuentran.
 */
function patchEnvContent(
  content: string,
  updates: Record<string, string>,
  remove: string[] = []
): string {
  const lines = content.split("\n");
  const applied = new Set<string>();
  const removeSet = new Set(remove);

  const result: string[] = [];
  for (const line of lines) {
    const key = line.split("=")[0].trim();

    if (removeSet.has(key)) continue; // elimina claves obsoletas

    let replaced = false;
    for (const [uKey, uVal] of Object.entries(updates)) {
      if (key === uKey) {
        result.push(`${uKey}=${uVal}`);
        applied.add(uKey);
        replaced = true;
        break;
      }
    }
    if (!replaced) result.push(line);
  }

  // Añade las claves que no existían aún
  for (const [uKey, uVal] of Object.entries(updates)) {
    if (!applied.has(uKey)) result.push(`${uKey}=${uVal}`);
  }

  return result.join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { defaultJournalMap, defaultAccountMap, defaultTaxMap } = body as {
      defaultJournalMap: Record<string, number>;
      defaultAccountMap: Record<string, number>;
      defaultTaxMap: Record<string, number>;
    };

    const updates: Record<string, string> = {
      DEFAULT_JOURNAL_MAP: mapToEnvString(defaultJournalMap ?? {}),
      DEFAULT_ACCOUNT_MAP: mapToEnvString(defaultAccountMap ?? {}),
      DEFAULT_TAX_MAP: mapToEnvString(defaultTaxMap ?? {}),
    };

    // Claves antiguas con nombres distintos que ya no se usan
    const obsolete = ["DEFAULT_ACCOUNT_ID", "DEFAULT_TAX_ID"];

    const envPath = join(process.cwd(), ".env.local");
    let content = "";
    try {
      content = await readFile(envPath, "utf-8");
    } catch {
      // El archivo no existe, se creará desde cero
    }

    const patched = patchEnvContent(content, updates, obsolete);
    await writeFile(envPath, patched, "utf-8");

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al guardar";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
