/**
 * Mide la precisión de la extracción sobre facturas reales.
 *
 * Uso:  npx tsx --env-file=.env.local scripts/eval-extraction.ts <carpeta-o-pdf...> [--engine=native]
 *
 * Para cada factura.pdf, si existe factura.expected.json con los valores
 * correctos, compara campo a campo; si no existe, lo crea con lo extraído para
 * que lo corrijas a mano y sirva de referencia en las siguientes ejecuciones.
 * Cada PDF analizado con Azure consume una llamada por página.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractInvoice } from "../src/shared/lib/extraction";
import type { ExtractionEngine, ExtractedInvoice } from "../src/shared/types";

const FIELDS = ["supplierVat", "supplierName", "invoiceNumber", "invoiceDate", "subtotal", "totalTax", "total"] as const;
type Field = (typeof FIELDS)[number];
type Expected = Partial<Record<Field, string | number | null>>;

const args = process.argv.slice(2);
const engine = (args.find((a) => a.startsWith("--engine="))?.split("=")[1] ?? "azure-di") as ExtractionEngine;
const ownTaxIds = (process.env.EVAL_OWN_TAX_IDS ?? "").split(",").filter(Boolean);

function pdfsIn(paths: string[]): string[] {
  return paths.flatMap((p) =>
    statSync(p).isDirectory()
      ? readdirSync(p).filter((f) => f.toLowerCase().endsWith(".pdf")).map((f) => join(p, f))
      : [p]
  );
}

function same(field: Field, got: unknown, want: unknown): boolean {
  if (want == null) return got == null;
  if (typeof want === "number") return typeof got === "number" && Math.abs(got - want) <= 0.01;
  const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(field === "supplierName" ? /[^A-Z0-9]/g : /\s/g, "");
  return norm(got) === norm(want);
}

async function main() {
  const files = pdfsIn(args.filter((a) => !a.startsWith("--")));
  if (files.length === 0) throw new Error("Indica una carpeta o PDF.");
  let hits = 0;
  let total = 0;
  const perField: Record<string, [number, number]> = {};

  for (const file of files) {
    const [inv]: ExtractedInvoice[] = await extractInvoice(readFileSync(file), {
      engine,
      azureDiEndpoint: process.env.AZURE_DI_ENDPOINT,
      azureDiKey: process.env.AZURE_DI_KEY,
      azureDiModelId: process.env.AZURE_DI_MODEL_ID,
      ownTaxIds,
    });
    const expectedPath = file.replace(/\.pdf$/i, ".expected.json");
    console.log(`\n■ ${file}`);
    for (const w of inv.warnings ?? []) console.log(`  ⚠ ${w}`);

    if (!existsSync(expectedPath)) {
      const draft = Object.fromEntries(FIELDS.map((f) => [f, inv[f] ?? null]));
      writeFileSync(expectedPath, JSON.stringify(draft, null, 2) + "\n");
      console.log(`  Creado ${expectedPath}: corrígelo a mano para usarlo como referencia.`);
      console.table(draft);
      continue;
    }
    const expected: Expected = JSON.parse(readFileSync(expectedPath, "utf8"));
    for (const f of FIELDS) {
      if (!(f in expected)) continue;
      const ok = same(f, inv[f], expected[f]);
      perField[f] ??= [0, 0];
      perField[f][0] += ok ? 1 : 0;
      perField[f][1] += 1;
      hits += ok ? 1 : 0;
      total += 1;
      if (!ok) console.log(`  ✗ ${f}: extraído ${JSON.stringify(inv[f])} · esperado ${JSON.stringify(expected[f])}`);
    }
  }

  if (total > 0) {
    console.log("\nAcierto por campo:");
    for (const [f, [ok, n]] of Object.entries(perField)) console.log(`  ${f.padEnd(14)} ${ok}/${n}`);
    console.log(`\nTotal: ${hits}/${total} (${((hits / total) * 100).toFixed(1)}%)`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
