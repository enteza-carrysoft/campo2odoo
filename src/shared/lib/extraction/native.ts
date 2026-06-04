import type { ExtractedInvoice, ExtractedLine } from "@/shared/types";
import { randomUUID } from "crypto";

// Regex patterns for Spanish invoices
const PATTERNS = {
  vat: /(?:NIF|CIF|VAT|NIF-IVA)[:\s]*([A-Z]{0,2}\d{7,9}[A-Z0-9])/i,
  invoiceNumber:
    /(?:N[uú]mero\s+(?:de\s+)?[Ff]actura|Factura\s+N[uº°]?|Invoice\s+(?:No|Number)?)[:\s#]*([A-Z0-9/\-]+)/i,
  invoiceDate:
    /(?:Fecha\s+(?:de\s+)?[Ff]actura|Invoice\s+Date)[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/i,
  dueDate:
    /(?:Fecha\s+(?:de\s+)?[Vv]encimiento|[Vv]encimiento|Due\s+Date)[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
  total:
    /(?:TOTAL\s+(?:A\s+PAGAR|FACTURA)?|Total\s+[Ii]mporte)[:\s€]*([0-9]+[.,][0-9]{2})/i,
  subtotal:
    /(?:BASE\s+IMPONIBLE|SUBTOTAL|Subtotal|Base\s+Imponible)[:\s€]*([0-9]+[.,][0-9]{2})/i,
  vat21: /(?:IVA\s+21\s*%|21\s*%)[:\s€]*([0-9]+[.,][0-9]{2})/i,
  vat10: /(?:IVA\s+10\s*%|10\s*%)[:\s€]*([0-9]+[.,][0-9]{2})/i,
  vat4: /(?:IVA\s+4\s*%|4\s*%)[:\s€]*([0-9]+[.,][0-9]{2})/i,
};

function normalizeAmount(raw: string): number {
  // Handle Spanish format: 1.234,56 → 1234.56
  const cleaned = raw.replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned);
}

function normalizeDate(raw: string): string | null {
  const parts = raw.split(/[\/\-\.]/);
  if (parts.length !== 3) return null;
  const [a, b, c] = parts.map(Number);
  // Detect format: if first part is 4-digit year → ISO, else dd/mm/yyyy
  if (String(parts[0]).length === 4) {
    return `${a}-${String(b).padStart(2, "0")}-${String(c).padStart(2, "0")}`;
  }
  return `${c}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
}

function extractMatch(text: string, pattern: RegExp): string | null {
  const m = text.match(pattern);
  return m?.[1]?.trim() ?? null;
}

export async function extractWithNative(
  pdfBuffer: Buffer
): Promise<ExtractedInvoice> {
  // pdf-parse v2: class-based API
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: pdfBuffer, verbosity: 0 });
  const result = await parser.getText();
  const text = result.pages.map((p: { text: string }) => p.text).join("\n");

  const rawTotal = extractMatch(text, PATTERNS.total);
  const rawSubtotal = extractMatch(text, PATTERNS.subtotal);
  const rawVat21 = extractMatch(text, PATTERNS.vat21);
  const rawVat10 = extractMatch(text, PATTERNS.vat10);
  const rawVat4 = extractMatch(text, PATTERNS.vat4);

  const total = rawTotal ? normalizeAmount(rawTotal) : null;
  const subtotal = rawSubtotal ? normalizeAmount(rawSubtotal) : null;
  const vatAmount =
    rawVat21
      ? normalizeAmount(rawVat21)
      : rawVat10
      ? normalizeAmount(rawVat10)
      : rawVat4
      ? normalizeAmount(rawVat4)
      : null;

  const taxRate = rawVat21 ? 21 : rawVat10 ? 10 : rawVat4 ? 4 : null;

  const rawInvoiceDate = extractMatch(text, PATTERNS.invoiceDate);
  const rawDueDate = extractMatch(text, PATTERNS.dueDate);

  // Build a single global line if we can't parse individual lines
  const lineAmount = subtotal ?? total;
  const lines: ExtractedLine[] = lineAmount
    ? [
        {
          id: randomUUID(),
          description: "Servicios/Productos (revisar detalle)",
          quantity: 1,
          unitPrice: lineAmount,
          taxRate,
          amount: lineAmount,
          accountId: null,
          taxIds: [],
        },
      ]
    : [];

  // Supplier name heuristic: first line of text that looks like a company name
  const firstLines = text
    .split("\n")
    .map((l: string) => l.trim())
    .filter((l: string) => l.length > 3 && l.length < 80);
  const supplierName = firstLines[0] ?? null;

  return {
    supplierName,
    supplierVat: extractMatch(text, PATTERNS.vat),
    invoiceNumber: extractMatch(text, PATTERNS.invoiceNumber),
    invoiceDate: rawInvoiceDate ? normalizeDate(rawInvoiceDate) : null,
    dueDate: rawDueDate ? normalizeDate(rawDueDate) : null,
    currency: "EUR",
    subtotal,
    totalTax: vatAmount,
    total,
    lines,
    confidence: 0.5,
    engine: "native",
    rawText: text,
  };
}
