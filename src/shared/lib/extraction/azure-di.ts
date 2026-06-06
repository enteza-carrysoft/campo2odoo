import {
  AzureKeyCredential,
  DocumentAnalysisClient,
} from "@azure/ai-form-recognizer";
import type { ExtractedInvoice, ExtractedLine } from "@/shared/types";
import { randomUUID } from "crypto";
import { splitPdfPages } from "./pdf-splitter";
import { PDFDocument } from "pdf-lib";

interface CurrencyValue {
  amount?: number;
  currencyCode?: string;
}

interface DocumentField {
  content?: string;
  value?: any;
  valueString?: string;
  valueNumber?: number;
  valueDate?: Date;
  valueCurrency?: CurrencyValue;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties?: Record<string, DocumentField>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  values?: DocumentField[];
  confidence?: number;
}

/**
 * Parsea un número en formato español o inglés desde texto.
 * "1.234,56" → 1234.56 · "1,234.56" → 1234.56 · "2,5" → 2.5 · "3 ud" → 3
 */
function parseLocaleNumber(raw: string): number | null {
  // Conserva solo dígitos, separadores y signo (descarta unidades como "ud", "kg", "€").
  const cleaned = raw.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let parsedStr = cleaned;
  if (lastComma > lastDot) {
    // La coma es el separador decimal → quita puntos de millar.
    parsedStr = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && cleaned.split(".").length > 2) {
    parsedStr = cleaned.replace(/\./g, "");
  } else if (lastDot > lastComma && cleaned.split(".").pop()?.length === 3) {
    parsedStr = cleaned.replace(/\./g, "");
  } else {
    parsedStr = cleaned.replace(/,/g, "");
  }

  const n = parseFloat(parsedStr);
  return isNaN(n) ? null : n;
}

function getAmount(field?: DocumentField): number | null {
  if (!field) return null;
  // Check if value is an object containing amount (standard CurrencyValue in Azure SDK)
  if (field.value && typeof field.value === "object" && "amount" in field.value) {
    return (field.value as any).amount;
  }
  if (field.valueCurrency?.amount != null) return field.valueCurrency.amount;
  if (field.valueNumber != null) return field.valueNumber;
  if (typeof field.value === "number") return field.value;
  const raw = field.content ?? field.valueString;
  if (!raw) return null;
  return parseLocaleNumber(raw);
}

/**
 * Lee un número "plano" (cantidad, etc.). A diferencia de getAmount, Azure DI
 * suele entregar la cantidad en `value`/`content` y NO en `valueNumber`, por lo
 * que mirar solo valueNumber hacía que siempre cayera al fallback (1).
 */
function getNumber(field?: DocumentField): number | null {
  if (!field) return null;
  if (typeof field.value === "number") return field.value;
  if (field.valueNumber != null) return field.valueNumber;
  if (field.value && typeof field.value === "object" && "amount" in field.value) {
    return (field.value as any).amount;
  }
  const raw = field.content ?? field.valueString;
  if (!raw) return null;
  return parseLocaleNumber(raw);
}

function getContent(field?: DocumentField): string | null {
  return field?.content ?? field?.valueString ?? null;
}

function getDate(field?: DocumentField): string | null {
  if (!field) return null;
  if (field.value instanceof Date) {
    const d = field.value;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  // If it's an ISO string from Azure SDK
  if (field.value && typeof field.value === "string" && field.value.includes("T")) {
    return field.value.split("T")[0];
  }
  if (field.valueDate) {
    const d = field.valueDate;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const raw = getContent(field);
  if (!raw) return null;
  // Try to parse common date formats (e.g. DD/MM/YYYY)
  const m = raw.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (!m) return null;
  const [, a, b, c] = m;
  const year = c.length === 2 ? `20${c}` : c;
  return `${year}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
}

/**
 * Convierte los campos de un documento de Azure (una página) en una factura.
 * No decide si la página se conserva o se fusiona: eso lo resuelve el llamador.
 */
function parseInvoiceDoc(
  fields: Record<string, DocumentField>,
  confidence: number,
  pageNum: number
): ExtractedInvoice {
  // Deduce global tax rate if lines are missing it (e.g. 1092 / 5200 = 21%)
  const subtotalAmount = getAmount(fields.SubTotal);
  const totalTaxAmount = getAmount(fields.TotalTax);
  const globalTaxRate = (totalTaxAmount && subtotalAmount && subtotalAmount > 0)
    ? Math.round((totalTaxAmount / subtotalAmount) * 100)
    : null;

  // Extract line items
  const lines: ExtractedLine[] = [];
  const itemsField = fields.Items;
  if (itemsField?.values && itemsField.values.length > 0) {
    for (const item of itemsField.values) {
      const props = item.properties ?? {};
      const amount = getAmount(props.Amount) ?? getAmount(props.UnitPrice);
      // Cantidad: Azure la entrega en value/content (no siempre en valueNumber).
      // Solo cae a 1 cuando de verdad no hay dato; 0 o negativos también se ignoran.
      const parsedQty = getNumber(props.Quantity);
      const qty = parsedQty != null && parsedQty > 0 ? parsedQty : 1;
      const unitPrice = getAmount(props.UnitPrice) ?? (amount != null ? amount / qty : null);
      const taxRateRaw = getContent(props.TaxRate);
      let taxRate = taxRateRaw
        ? parseFloat(taxRateRaw.replace("%", "").trim())
        : null;

      // Fallback to deduced global tax rate if line-level is missing
      if (taxRate === null || isNaN(taxRate)) {
        taxRate = globalTaxRate;
      }

      lines.push({
        id: randomUUID(),
        description: getContent(props.Description) ?? "Línea de factura",
        quantity: qty,
        unitPrice: unitPrice ?? 0,
        taxRate: isNaN(taxRate ?? NaN) ? null : taxRate,
        amount: amount ?? 0,
        accountId: null,
        taxIds: [],
      });
    }
  }

  // Fallback: single global line from totals
  if (lines.length === 0) {
    const totalAmount = getAmount(fields.InvoiceTotal);
    const lineAmount = subtotalAmount ?? totalAmount;
    if (lineAmount != null) {
      lines.push({
        id: randomUUID(),
        description: "Servicios/Productos (revisar detalle)",
        quantity: 1,
        unitPrice: lineAmount,
        taxRate: globalTaxRate,
        amount: lineAmount,
        accountId: null,
        taxIds: [],
      });
    }
  }

  return {
    supplierName: getContent(fields.VendorName),
    supplierVat: getContent(fields.VendorTaxId),
    invoiceNumber: getContent(fields.InvoiceId),
    invoiceDate: getDate(fields.InvoiceDate),
    dueDate: getDate(fields.DueDate),
    currency: fields.InvoiceTotal?.valueCurrency?.currencyCode ?? "EUR",
    subtotal: subtotalAmount,
    totalTax: totalTaxAmount,
    total: getAmount(fields.InvoiceTotal),
    lines,
    confidence,
    engine: "azure-di",
    pageRange: [pageNum], // Tagged with the page number it was split from
  };
}

/**
 * Una página tiene "señal de factura" si trae cabecera o importes propios.
 * Las páginas sin nº, sin importes y sin proveedor+líneas (portadas, anexos,
 * separadores) se descartan en vez de generar facturas vacías.
 */
function hasInvoiceSignal(inv: ExtractedInvoice): boolean {
  return (
    inv.invoiceNumber != null ||
    inv.total != null ||
    inv.subtotal != null ||
    (inv.supplierName != null && inv.lines.length > 0)
  );
}

/**
 * Decide si la página actual es continuación de la factura anterior
 * (factura que ocupa varias páginas dentro del mismo PDF):
 *  - Mismo nº de factura no nulo en ambas, o
 *  - Página sin cabecera propia (sin nº, sin NIF, sin importes) pero con líneas.
 */
function isContinuationOf(inv: ExtractedInvoice, prev: ExtractedInvoice): boolean {
  if (inv.invoiceNumber && prev.invoiceNumber) {
    return inv.invoiceNumber === prev.invoiceNumber;
  }
  return (
    inv.invoiceNumber == null &&
    inv.supplierVat == null &&
    inv.total == null &&
    inv.subtotal == null &&
    inv.lines.length > 0
  );
}

/** Fusiona una página de continuación dentro de la factura previa. */
function mergeContinuation(
  prev: ExtractedInvoice,
  cont: ExtractedInvoice,
  pageNum: number
): void {
  prev.lines.push(...cont.lines);
  prev.pageRange = [...(prev.pageRange ?? []), pageNum];
  // Los totales suelen aparecer en la última página: rellenan los que falten.
  if (prev.total == null && cont.total != null) prev.total = cont.total;
  if (prev.subtotal == null && cont.subtotal != null) prev.subtotal = cont.subtotal;
  if (prev.totalTax == null && cont.totalTax != null) prev.totalTax = cont.totalTax;
  if (prev.dueDate == null && cont.dueDate != null) prev.dueDate = cont.dueDate;
}

export async function extractWithAzureDI(
  pdfBuffer: Buffer,
  endpoint: string,
  apiKey: string,
  noSplit: boolean = false
): Promise<ExtractedInvoice[]> {
  const client = new DocumentAnalysisClient(
    endpoint,
    new AzureKeyCredential(apiKey)
  );

  const invoices: ExtractedInvoice[] = [];
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  if (noSplit) {
    // Modo sin split: envía el PDF completo a Azure DI en una sola llamada.
    // Útil para PDFs con muchas páginas donde la división por página pierde contexto.
    const poller = await client.beginAnalyzeDocument("prebuilt-invoice", pdfBuffer);
    const result = await poller.pollUntilDone();

    for (const doc of result.documents ?? []) {
      const fields = (doc.fields ?? {}) as Record<string, DocumentField>;
      const confidence = doc.confidence ?? 0.85;
      const candidate = parseInvoiceDoc(fields, confidence, 1);
      if (hasInvoiceSignal(candidate)) {
        // pageRange reflects all pages of the PDF
        const srcDoc = await PDFDocument.load(pdfBuffer);
        candidate.pageRange = Array.from({ length: srcDoc.getPageCount() }, (_, i) => i + 1);
        invoices.push(candidate);
      }
    }
  } else {
    // Modo normal (por defecto): página a página.
    // El tier F0 solo analiza las 2 primeras páginas de un documento;
    // enviar cada página como PDF de 1 página cubre PDFs de N facturas.
    const srcDoc = await PDFDocument.load(pdfBuffer);
    const pageCount = srcDoc.getPageCount();

    for (let i = 1; i <= pageCount; i++) {
      try {
        if (i > 1) await sleep(1000);

        const singlePageBuffer = await splitPdfPages(pdfBuffer, [i]);
        const poller = await client.beginAnalyzeDocument("prebuilt-invoice", singlePageBuffer);
        const result = await poller.pollUntilDone();

        for (const doc of result.documents ?? []) {
          const fields = (doc.fields ?? {}) as Record<string, DocumentField>;
          const confidence = doc.confidence ?? 0.85;
          const candidate = parseInvoiceDoc(fields, confidence, i);

          const prev = invoices[invoices.length - 1];
          if (prev && isContinuationOf(candidate, prev)) {
            mergeContinuation(prev, candidate, i);
          } else if (hasInvoiceSignal(candidate)) {
            invoices.push(candidate);
          }
        }
      } catch (pageErr) {
        console.error(`Error processing page ${i} with Azure DI:`, pageErr);
      }
    }
  }

  // Fallback: if no documents were recognized across all pages, return a generic placeholder invoice representing page 1
  if (invoices.length === 0) {
    invoices.push({
      supplierName: null,
      supplierVat: null,
      invoiceNumber: null,
      invoiceDate: null,
      dueDate: null,
      currency: "EUR",
      subtotal: null,
      totalTax: null,
      total: null,
      lines: [],
      confidence: 0.5,
      engine: "azure-di",
      pageRange: [1],
    });
  }

  return invoices;
}
