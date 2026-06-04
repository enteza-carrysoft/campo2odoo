import {
  AzureKeyCredential,
  DocumentAnalysisClient,
} from "@azure/ai-form-recognizer";
import type { ExtractedInvoice, ExtractedLine } from "@/shared/types";
import { randomUUID } from "crypto";

interface CurrencyValue {
  amount?: number;
  currencyCode?: string;
}

interface DocumentField {
  content?: string;
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

function getAmount(field?: DocumentField): number | null {
  if (!field) return null;
  if (field.valueCurrency?.amount != null) return field.valueCurrency.amount;
  if (field.valueNumber != null) return field.valueNumber;
  const raw = field.content ?? field.valueString;
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function getContent(field?: DocumentField): string | null {
  return field?.content ?? field?.valueString ?? null;
}

function getDate(field?: DocumentField): string | null {
  if (!field) return null;
  if (field.valueDate) {
    const d = field.valueDate;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const raw = getContent(field);
  if (!raw) return null;
  // Try to parse common date formats
  const m = raw.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (!m) return null;
  const [, a, b, c] = m;
  const year = c.length === 2 ? `20${c}` : c;
  return `${year}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
}

export async function extractWithAzureDI(
  pdfBuffer: Buffer,
  endpoint: string,
  apiKey: string
): Promise<ExtractedInvoice> {
  const client = new DocumentAnalysisClient(
    endpoint,
    new AzureKeyCredential(apiKey)
  );

  const poller = await client.beginAnalyzeDocument(
    "prebuilt-invoice",
    pdfBuffer
  );
  const result = await poller.pollUntilDone();

  const doc = result.documents?.[0];
  const fields = (doc?.fields ?? {}) as Record<string, DocumentField>;

  // Extract line items
  const lines: ExtractedLine[] = [];
  const itemsField = fields.Items;
  if (itemsField?.values && itemsField.values.length > 0) {
    for (const item of itemsField.values) {
      const props = item.properties ?? {};
      const amount = getAmount(props.Amount) ?? getAmount(props.UnitPrice);
      const qty = props.Quantity?.valueNumber ?? 1;
      const unitPrice = getAmount(props.UnitPrice) ?? (amount != null ? amount / qty : null);
      const taxRateRaw = getContent(props.TaxRate);
      const taxRate = taxRateRaw
        ? parseFloat(taxRateRaw.replace("%", "").trim())
        : null;

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
    const subtotalAmount = getAmount(fields.SubTotal);
    const totalAmount = getAmount(fields.InvoiceTotal);
    const lineAmount = subtotalAmount ?? totalAmount;
    if (lineAmount != null) {
      lines.push({
        id: randomUUID(),
        description: "Servicios/Productos (revisar detalle)",
        quantity: 1,
        unitPrice: lineAmount,
        taxRate: null,
        amount: lineAmount,
        accountId: null,
        taxIds: [],
      });
    }
  }

  const confidence = doc?.confidence ?? 0.85;

  return {
    supplierName: getContent(fields.VendorName),
    supplierVat: getContent(fields.VendorTaxId),
    invoiceNumber: getContent(fields.InvoiceId),
    invoiceDate: getDate(fields.InvoiceDate),
    dueDate: getDate(fields.DueDate),
    currency:
      fields.InvoiceTotal?.valueCurrency?.currencyCode ?? "EUR",
    subtotal: getAmount(fields.SubTotal),
    totalTax: getAmount(fields.TotalTax),
    total: getAmount(fields.InvoiceTotal),
    lines,
    confidence,
    engine: "azure-di",
  };
}
