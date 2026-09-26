import type { AppConfig, ExtractedInvoice, InvoiceFile, OdooMasters } from "@/shared/types";
import { matchPartner, isAutoAssignable } from "@/shared/lib/odoo/partner-match";
import { companyForCustomerVat, taxForRate, withholdingTaxFor } from "@/shared/lib/odoo/tax-match";

export function formatSplitName(originalName: string, pageRange?: number[]): string {
  if (!pageRange || pageRange.length === 0) return originalName;
  const extIndex = originalName.lastIndexOf(".");
  const base = extIndex > 0 ? originalName.substring(0, extIndex) : originalName;
  const ext = extIndex > 0 ? originalName.substring(extIndex) : "";
  const min = Math.min(...pageRange);
  const max = Math.max(...pageRange);
  return min === max ? `${base} (Pág. ${min})${ext}` : `${base} (Págs. ${min}-${max})${ext}`;
}

/** NIF de nuestras empresas en Odoo, para que el extractor no los tome por proveedor. */
export function ownTaxIds(masters: OdooMasters | null): string[] {
  return (masters?.companies ?? []).map((c) => c.vat).filter((v): v is string => !!v);
}

function autoPartner(masters: OdooMasters | null, extracted: ExtractedInvoice): number | null {
  if (!masters?.partners?.length || !(extracted.supplierName || extracted.supplierVat)) return null;
  // Solo con confianza alta (VAT / nombre exacto / fuerte); los dudosos los elige el usuario.
  const match = matchPartner(masters.partners, { name: extracted.supplierName, vat: extracted.supplierVat });
  return match && isAutoAssignable(match.confidence) ? match.partner.id : null;
}

/**
 * Convierte una factura extraída en una fila de la tabla: empresa por el NIF del
 * destinatario, proveedor emparejado, diario por empresa e impuestos según el
 * tipo de IVA de cada línea (más la retención de IRPF si se ha detectado).
 */
export function invoiceFromExtraction(params: {
  source: InvoiceFile;
  extracted: ExtractedInvoice;
  dataBase64: string;
  masters: OdooMasters | null;
  config: AppConfig;
}): InvoiceFile {
  const { source, extracted, dataBase64, masters, config } = params;
  const companyId =
    companyForCustomerVat(masters?.companies ?? [], extracted.customerVat) ??
    source.companyId ??
    masters?.companyId ??
    null;
  const cId = String(companyId ?? "");
  const defAccount = config.defaultAccountMap[cId] ?? null;
  const defTax = config.defaultTaxMap[cId] ?? null;
  const taxes = masters?.taxes ?? [];
  const irpfTax = withholdingTaxFor(taxes, companyId, extracted.withholdingRate);

  return {
    id: crypto.randomUUID(),
    name: formatSplitName(source.name, extracted.pageRange),
    size: Math.round((dataBase64.length * 3) / 4),
    dataBase64,
    status: "extracted",
    extracted,
    companyId,
    partnerId: autoPartner(masters, extracted),
    journalId:
      (companyId != null ? config.defaultJournalMap[String(companyId)] : undefined) ??
      source.journalId ??
      config.defaultJournalId,
    lines: extracted.lines.map((line) => {
      const vatTax = line.taxIds.length > 0 ? null : taxForRate(taxes, companyId, line.taxRate, defTax);
      const taxIds = line.taxIds.length > 0 ? line.taxIds : [vatTax, irpfTax].filter((t): t is number => t != null);
      return { ...line, accountId: line.accountId ?? defAccount, taxIds };
    }),
    selectedForImport: true,
    importStatus: "idle",
    noSplit: false,
  };
}
