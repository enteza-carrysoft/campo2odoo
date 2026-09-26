/**
 * Validación y corrección de facturas extraídas, independiente del motor.
 *
 * Los motores (Azure DI, texto nativo) aciertan la mayoría de campos pero fallan
 * de formas predecibles: confunden emisor y receptor, leen importes de línea con
 * IVA incluido, omiten el tipo de IVA o no ven la retención de IRPF. Aquí se
 * corrige lo que se puede demostrar con la propia factura (dígitos de control,
 * cuadre de importes) y se avisa de lo demás, sin inventar nunca un valor.
 */
import type { ExtractedInvoice, ExtractedLine, TaxBreakdownItem } from "@/shared/types";
import { findSpanishTaxIds, normalizeTaxId, taxIdKey } from "./tax-id";

export interface ValidationContext {
  /** NIF de nuestras empresas en Odoo: nunca pueden ser el proveedor. */
  ownTaxIds?: string[];
  /** Texto completo del documento, para buscar un NIF cuando el motor no lo ve. */
  text?: string | null;
  /** Fecha de referencia (inyectable en tests). */
  today?: Date;
}

// Tipos de IVA vigentes en España (general, reducido, superreducido y temporales).
const KNOWN_VAT_RATES = [21, 10, 5, 4, 2, 0];
const WITHHOLDING_RATES = [15, 7, 19, 1, 2];

export const round2 = (n: number) => Math.round(n * 100) / 100;

function tolerance(lineCount: number): number {
  return 0.02 + 0.005 * lineCount;
}

/** Ajusta un tipo leído (20.99, "21,0") al tipo legal más cercano. */
export function snapVatRate(rate: number | null | undefined): number | null {
  if (rate == null || isNaN(rate)) return null;
  const nearest = KNOWN_VAT_RATES.reduce((a, b) => (Math.abs(b - rate) < Math.abs(a - rate) ? b : a));
  return Math.abs(nearest - rate) <= 0.6 ? nearest : round2(rate);
}

export function validateInvoice(input: ExtractedInvoice, ctx: ValidationContext = {}): ExtractedInvoice {
  const inv: ExtractedInvoice = {
    ...input,
    lines: input.lines.map((l) => ({ ...l })),
    warnings: [...(input.warnings ?? [])],
  };
  const warn = (msg: string) => {
    if (!inv.warnings!.includes(msg)) inv.warnings!.push(msg);
  };

  fixParties(inv, ctx, warn);
  fixInvoiceNumber(inv, warn);
  fixDates(inv, ctx.today ?? new Date(), warn);
  fixTotals(inv, warn);
  fixLines(inv, warn);
  return inv;
}

// ── Emisor / receptor ───────────────────────────────────────────────────────

function fixParties(inv: ExtractedInvoice, ctx: ValidationContext, warn: (m: string) => void): void {
  const own = new Set((ctx.ownTaxIds ?? []).map(taxIdKey).filter((k): k is string => !!k));
  let supplier = normalizeTaxId(inv.supplierVat);
  let customer = normalizeTaxId(inv.customerVat);
  const isOwn = (id: typeof supplier) => !!id && own.has(taxIdKey(id.value)!);

  // El motor tomó a nuestra empresa como proveedor: los datos del emisor están en "cliente".
  if (isOwn(supplier)) {
    if (customer && !isOwn(customer)) {
      [supplier, customer] = [customer, supplier];
      [inv.supplierName, inv.customerName] = [inv.customerName ?? null, inv.supplierName];
      warn("Proveedor y cliente venían intercambiados; se han corregido.");
    } else {
      supplier = null;
    }
  }

  if (!supplier || (supplier.country === "ES" && !supplier.checksumValid)) {
    const excluded = new Set([...own, taxIdKey(customer?.value)].filter(Boolean));
    const candidate = findSpanishTaxIds(ctx.text).find((id) => !excluded.has(taxIdKey(id)));
    if (candidate) {
      if (supplier) warn(`El NIF leído (${supplier.value}) no era válido; se ha usado ${candidate}, encontrado en el documento.`);
      else warn("NIF del proveedor deducido del texto del documento: revísalo.");
      supplier = normalizeTaxId(candidate);
    } else if (supplier) {
      warn(`El NIF del proveedor (${supplier.value}) no supera la validación.`);
    } else {
      warn("No se ha encontrado el NIF del proveedor.");
    }
  }

  inv.supplierVat = supplier?.value ?? null;
  inv.customerVat = customer?.value ?? inv.customerVat ?? null;
  inv.supplierName = cleanText(inv.supplierName);
  inv.customerName = cleanText(inv.customerName);
  if (!inv.supplierName) warn("Falta el nombre del proveedor.");
}

function cleanText(s: string | null | undefined): string | null {
  const v = s?.replace(/\s+/g, " ").trim();
  return v ? v : null;
}

// ── Número y fechas ─────────────────────────────────────────────────────────

function fixInvoiceNumber(inv: ExtractedInvoice, warn: (m: string) => void): void {
  const n = cleanText(inv.invoiceNumber)
    ?.replace(/^(factura|invoice|fra\.?)\s*/i, "")
    .replace(/^(n[º°o]\.?|num\.?|número|no\.?|#)\s*[:.]?\s*/i, "")
    .trim();
  inv.invoiceNumber = n ? n : null;
  if (!inv.invoiceNumber) warn("Falta el número de factura.");
}

function fixDates(inv: ExtractedInvoice, today: Date, warn: (m: string) => void): void {
  const valid = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) ? d : null);
  inv.invoiceDate = valid(inv.invoiceDate);
  inv.dueDate = valid(inv.dueDate);

  if (!inv.invoiceDate) {
    warn("Falta la fecha de factura.");
  } else {
    const t = Date.parse(inv.invoiceDate);
    if (t > today.getTime() + 7 * 86_400_000) warn(`La fecha de factura (${inv.invoiceDate}) es futura.`);
    if (t < Date.parse("2000-01-01")) warn(`La fecha de factura (${inv.invoiceDate}) parece incorrecta.`);
  }
  if (inv.invoiceDate && inv.dueDate && inv.dueDate < inv.invoiceDate) {
    warn(`El vencimiento leído (${inv.dueDate}) era anterior a la fecha de factura; se ha descartado.`);
    inv.dueDate = null;
  }
}

// ── Totales ─────────────────────────────────────────────────────────────────

function sumBreakdown(items: TaxBreakdownItem[] | undefined, key: "base" | "amount"): number | null {
  if (!items?.length || items.some((i) => i[key] == null)) return null;
  return round2(items.reduce((s, i) => s + (i[key] ?? 0), 0));
}

function fixTotals(inv: ExtractedInvoice, warn: (m: string) => void): void {
  inv.subtotal ??= sumBreakdown(inv.taxBreakdown, "base");
  inv.totalTax ??= sumBreakdown(inv.taxBreakdown, "amount");
  const { subtotal: sub, totalTax: tax, total } = inv;

  if (total == null && sub != null && tax != null) inv.total = round2(sub + tax);
  if (sub == null && total != null && tax != null) inv.subtotal = round2(total - tax);
  if (tax == null && total != null && sub != null && total >= sub) inv.totalTax = round2(total - sub);
  if (inv.total == null) warn("Falta el importe total.");
  if (inv.subtotal == null || inv.totalTax == null || inv.total == null) return;

  const diff = round2(inv.subtotal + inv.totalTax - inv.total);
  const tol = tolerance(inv.lines.length);
  if (Math.abs(diff) <= tol) return;

  const withholding = WITHHOLDING_RATES.find((r) => Math.abs(diff - (inv.subtotal! * r) / 100) <= tol);
  if (withholding != null) {
    inv.withholdingRate = withholding;
    warn(`Retención de IRPF del ${withholding}% detectada: comprueba el impuesto de retención en las líneas.`);
  } else {
    warn(`Base + IVA (${round2(inv.subtotal + inv.totalTax)}) no cuadra con el total (${inv.total}).`);
  }
}

// ── Líneas ──────────────────────────────────────────────────────────────────

function fixLines(inv: ExtractedInvoice, warn: (m: string) => void): void {
  const meaningful = inv.lines.filter((l) => l.amount !== 0 || l.unitPrice !== 0);
  if (meaningful.length > 0) inv.lines = meaningful;
  if (inv.lines.length === 0) inv.lines = fallbackLines(inv);

  const effectiveRate = inv.subtotal && inv.totalTax != null ? snapVatRate((inv.totalTax / inv.subtotal) * 100) : null;
  const breakdownRates = [...new Set((inv.taxBreakdown ?? []).map((b) => snapVatRate(b.rate)).filter((r): r is number => r != null))];
  const singleRate = breakdownRates.length === 1 ? breakdownRates[0] : breakdownRates.length === 0 ? effectiveRate : null;

  for (const line of inv.lines) {
    line.taxRate = snapVatRate(line.taxRate) ?? singleRate;
  }
  if (inv.lines.some((l) => l.taxRate == null) && breakdownRates.length > 1) {
    assignRatesByBreakdown(inv.lines, inv.taxBreakdown ?? [], tolerance(inv.lines.length));
  }
  if (inv.lines.some((l) => l.taxRate == null)) warn("Hay líneas sin tipo de IVA.");

  convertGrossLines(inv, warn);
  checkLinesSum(inv, warn);
}

function fallbackLines(inv: ExtractedInvoice): ExtractedLine[] {
  const base = (inv.taxBreakdown ?? []).filter((b) => b.base != null && b.base !== 0);
  const make = (amount: number, taxRate: number | null, description: string): ExtractedLine => ({
    id: crypto.randomUUID(),
    description,
    quantity: 1,
    unitPrice: amount,
    taxRate,
    amount,
    accountId: null,
    taxIds: [],
  });
  if (base.length > 1) {
    return base.map((b) => make(b.base!, snapVatRate(b.rate), `Base imponible al ${snapVatRate(b.rate) ?? "?"}% (revisar detalle)`));
  }
  const amount = inv.subtotal ?? inv.total;
  return amount != null ? [make(amount, null, "Servicios/Productos (revisar detalle)")] : [];
}

/**
 * Con dos o más tipos de IVA y líneas sin tipo, busca qué líneas suman la base
 * de cada tipo (suma de subconjuntos; se limita a 16 líneas por coste).
 */
function assignRatesByBreakdown(lines: ExtractedLine[], breakdown: TaxBreakdownItem[], tol: number): void {
  const open = lines.filter((l) => l.taxRate == null);
  if (open.length > 16) return;
  for (const item of breakdown) {
    const rate = snapVatRate(item.rate);
    if (rate == null || item.base == null) continue;
    const pending = open.filter((l) => l.taxRate == null);
    const target = round2(item.base - lines.filter((l) => l.taxRate === rate).reduce((s, l) => s + l.amount, 0));
    for (let mask = 1; mask < 1 << pending.length; mask++) {
      const chosen = pending.filter((_, i) => mask & (1 << i));
      if (Math.abs(chosen.reduce((s, l) => s + l.amount, 0) - target) <= tol) {
        chosen.forEach((l) => (l.taxRate = rate));
        break;
      }
    }
  }
}

/** Si las líneas suman el total (con IVA) en vez de la base, las pasa a base imponible. */
function convertGrossLines(inv: ExtractedInvoice, warn: (m: string) => void): void {
  const { subtotal, total, totalTax } = inv;
  if (subtotal == null || total == null || !totalTax || inv.lines.some((l) => l.taxRate == null)) return;
  const tol = tolerance(inv.lines.length);
  const sum = inv.lines.reduce((s, l) => s + l.amount, 0);
  if (Math.abs(sum - subtotal) <= tol || Math.abs(sum - total) > tol) return;

  for (const l of inv.lines) {
    const factor = 1 + (l.taxRate ?? 0) / 100;
    l.amount = round2(l.amount / factor);
    l.unitPrice = Math.round((l.unitPrice / factor) * 10_000) / 10_000;
  }
  warn("Los importes de línea incluían IVA; se han convertido a base imponible.");
}

function checkLinesSum(inv: ExtractedInvoice, warn: (m: string) => void): void {
  if (inv.subtotal == null || inv.lines.length === 0) return;
  const sum = round2(inv.lines.reduce((s, l) => s + l.amount, 0));
  if (Math.abs(sum - inv.subtotal) > tolerance(inv.lines.length)) {
    warn(`Las líneas suman ${sum} y la base imponible es ${inv.subtotal}.`);
  }
}
