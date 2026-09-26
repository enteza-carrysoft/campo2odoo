import { randomUUID } from "crypto";
import { PDFDocument } from "pdf-lib";
import type { ConfidenceField, ExtractedInvoice, ExtractedLine, TaxBreakdownItem } from "@/shared/types";
import { analyzeDocument, type DIAnalyzeResult, type DIField } from "./azure-client";
import { splitPdfPages } from "./pdf-splitter";
import { round2 } from "./validate";

// Páginas analizadas en paralelo: los 429 del tier gratuito se reintentan solos.
const PAGE_CONCURRENCY = 2;

/**
 * Parsea un número en formato español o inglés desde texto.
 * "1.234,56" → 1234.56 · "1,234.56" → 1234.56 · "2,5" → 2.5 · "3 ud" → 3
 */
export function parseLocaleNumber(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let parsed: string;
  if (lastComma > lastDot) {
    parsed = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && (cleaned.split(".").length > 2 || cleaned.split(".").pop()?.length === 3)) {
    parsed = cleaned.replace(/\./g, "");
  } else {
    parsed = cleaned.replace(/,/g, "");
  }
  const n = parseFloat(parsed);
  return isNaN(n) ? null : n;
}

const str = (f?: DIField) => f?.valueString ?? f?.content ?? null;

function amount(f?: DIField): number | null {
  if (!f) return null;
  if (f.valueCurrency?.amount != null) return f.valueCurrency.amount;
  if (f.valueNumber != null) return f.valueNumber;
  return f.content ? parseLocaleNumber(f.content) : null;
}

function num(f?: DIField): number | null {
  if (!f) return null;
  return f.valueNumber ?? f.valueInteger ?? (f.content ? parseLocaleNumber(f.content) : null);
}

function date(f?: DIField): string | null {
  if (!f) return null;
  if (f.valueDate) return f.valueDate.slice(0, 10);
  const m = f.content?.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function rate(f?: DIField): number | null {
  if (!f) return null;
  if (f.valueNumber != null) return f.valueNumber <= 1 && f.valueNumber > 0 ? f.valueNumber * 100 : f.valueNumber;
  const raw = f.valueString ?? f.content;
  return raw ? parseLocaleNumber(raw) : null;
}

function parseLine(item: DIField): ExtractedLine | null {
  const p = item.valueObject ?? {};
  const quantity = (num(p.Quantity) ?? 0) > 0 ? num(p.Quantity)! : 1;
  let lineAmount = amount(p.Amount);
  let unitPrice = amount(p.UnitPrice);

  if (lineAmount == null && unitPrice != null) lineAmount = round2(unitPrice * quantity);
  if (lineAmount == null) return null;
  // Si precio × cantidad no da el importe hay descuento: el importe de línea manda.
  if (unitPrice == null || Math.abs(unitPrice * quantity - lineAmount) > 0.02) {
    unitPrice = Math.round((lineAmount / quantity) * 10_000) / 10_000;
  }

  const code = str(p.ProductCode);
  const description = str(p.Description)?.replace(/\s+/g, " ").trim() || code || "Línea de factura";
  return {
    id: randomUUID(),
    description: code && !description.includes(code) ? `[${code}] ${description}` : description,
    quantity,
    unitPrice,
    taxRate: rate(p.TaxRate),
    amount: lineAmount,
    accountId: null,
    taxIds: [],
  };
}

function parseTaxDetails(f?: DIField): TaxBreakdownItem[] {
  return (f?.valueArray ?? [])
    .map((d) => d.valueObject ?? {})
    .map((o) => ({ rate: rate(o.Rate), base: amount(o.NetAmount), amount: amount(o.Amount) }))
    .filter((t) => t.base != null || t.amount != null);
}

/** Convierte un documento de Azure (una página o el PDF completo) en factura, sin validar. */
function parseInvoiceDoc(fields: Record<string, DIField>, confidence: number, pages: number[], text: string): ExtractedInvoice {
  const fieldConfidence: Partial<Record<ConfidenceField, number>> = {};
  const map: Record<ConfidenceField, string> = {
    supplierName: "VendorName", supplierVat: "VendorTaxId", invoiceNumber: "InvoiceId",
    invoiceDate: "InvoiceDate", total: "InvoiceTotal",
  };
  for (const [key, azureKey] of Object.entries(map) as [ConfidenceField, string][]) {
    const c = fields[azureKey]?.confidence;
    if (c != null) fieldConfidence[key] = c;
  }

  return {
    supplierName: str(fields.VendorName),
    supplierVat: str(fields.VendorTaxId),
    customerName: str(fields.CustomerName),
    customerVat: str(fields.CustomerTaxId),
    invoiceNumber: str(fields.InvoiceId),
    invoiceDate: date(fields.InvoiceDate),
    dueDate: date(fields.DueDate),
    currency: fields.InvoiceTotal?.valueCurrency?.currencyCode ?? "EUR",
    subtotal: amount(fields.SubTotal),
    totalTax: amount(fields.TotalTax),
    total: amount(fields.InvoiceTotal),
    taxBreakdown: parseTaxDetails(fields.TaxDetails),
    lines: (fields.Items?.valueArray ?? []).map(parseLine).filter((l): l is ExtractedLine => l !== null),
    confidence,
    fieldConfidence,
    engine: "azure-di",
    pageRange: pages,
    rawText: text,
  };
}

/** Páginas sin nº, sin importes y sin proveedor+líneas (portadas, anexos) se descartan. */
function hasInvoiceSignal(inv: ExtractedInvoice): boolean {
  return inv.invoiceNumber != null || inv.total != null || inv.subtotal != null || (inv.supplierName != null && inv.lines.length > 0);
}

/** ¿Es esta página continuación de la factura anterior dentro del mismo PDF? */
function isContinuationOf(inv: ExtractedInvoice, prev: ExtractedInvoice): boolean {
  if (inv.invoiceNumber && prev.invoiceNumber) return inv.invoiceNumber === prev.invoiceNumber;
  return inv.invoiceNumber == null && inv.supplierVat == null && inv.total == null && inv.subtotal == null && inv.lines.length > 0;
}

function mergeContinuation(prev: ExtractedInvoice, cont: ExtractedInvoice): void {
  prev.lines.push(...cont.lines);
  prev.pageRange = [...(prev.pageRange ?? []), ...(cont.pageRange ?? [])];
  prev.rawText = `${prev.rawText ?? ""}\n${cont.rawText ?? ""}`;
  // Los totales suelen estar en la última página: rellenan los que falten.
  prev.total ??= cont.total;
  prev.subtotal ??= cont.subtotal;
  prev.totalTax ??= cont.totalTax;
  prev.dueDate ??= cont.dueDate;
  if (!prev.taxBreakdown?.length) prev.taxBreakdown = cont.taxBreakdown;
}

function documentsOf(result: DIAnalyzeResult, pages: number[]): ExtractedInvoice[] {
  return (result.documents ?? []).map((doc) =>
    parseInvoiceDoc(doc.fields ?? {}, doc.confidence ?? 0.85, pages, result.content ?? "")
  );
}

async function analyzePages(pdf: Buffer, pageCount: number, analyze: (b: Buffer) => Promise<DIAnalyzeResult>) {
  const results: (DIAnalyzeResult | null)[] = new Array(pageCount).fill(null);
  let next = 0;
  async function worker() {
    while (next < pageCount) {
      const i = next++;
      try {
        results[i] = await analyze(await splitPdfPages(pdf, [i + 1]));
      } catch (err) {
        console.error(`Azure DI: error en la página ${i + 1}:`, err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pageCount) }, worker));
  return results;
}

/**
 * Modo normal: página a página (el tier F0 solo analiza 2 páginas por documento
 * y así un PDF con N facturas se separa solo). Las páginas de continuación se
 * fusionan con la factura anterior. Con noSplit se envía el PDF completo.
 */
export async function extractWithAzureDI(
  pdfBuffer: Buffer,
  endpoint: string,
  apiKey: string,
  noSplit = false,
  modelId?: string
): Promise<ExtractedInvoice[]> {
  const analyze = (b: Buffer) => analyzeDocument(b, endpoint, apiKey, modelId);
  const pageCount = (await PDFDocument.load(pdfBuffer)).getPageCount();
  const allPages = Array.from({ length: pageCount }, (_, i) => i + 1);
  const invoices: ExtractedInvoice[] = [];

  if (noSplit) {
    invoices.push(...documentsOf(await analyze(pdfBuffer), allPages).filter(hasInvoiceSignal));
  } else {
    const results = await analyzePages(pdfBuffer, pageCount, analyze);
    if (results.every((r) => r === null)) {
      throw new Error("Azure DI no pudo analizar ninguna página. Revisa el endpoint y la clave.");
    }
    results.forEach((result, i) => {
      for (const candidate of result ? documentsOf(result, [i + 1]) : []) {
        const prev = invoices[invoices.length - 1];
        if (prev && isContinuationOf(candidate, prev)) mergeContinuation(prev, candidate);
        else if (hasInvoiceSignal(candidate)) invoices.push(candidate);
      }
    });
  }

  if (invoices.length === 0) {
    invoices.push({
      supplierName: null, supplierVat: null, invoiceNumber: null, invoiceDate: null, dueDate: null,
      currency: "EUR", subtotal: null, totalTax: null, total: null, lines: [],
      confidence: 0, engine: "azure-di", pageRange: allPages,
      warnings: ["Azure no ha reconocido ninguna factura en el documento: rellena los datos a mano."],
    });
  }
  return invoices;
}
