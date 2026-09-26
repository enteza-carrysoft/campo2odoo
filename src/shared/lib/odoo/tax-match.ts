import type { OdooCompany, OdooTax } from "@/shared/types";
import { taxIdKey } from "@/shared/lib/extraction/tax-id";

// Impuestos de compra con el mismo % pero de uso especial: nunca se eligen solos.
const SPECIAL_TAX = /intracom|inversi[oó]n|isp|importaci|no deducible|exento|extracom|recargo|agrario|reag/i;

const companyOf = (t: OdooTax) => (t.company_id ? t.company_id[0] : null);

function purchaseTaxes(taxes: OdooTax[], companyId: number | null): OdooTax[] {
  return taxes.filter(
    (t) => t.type_tax_use === "purchase" && (companyId == null || companyOf(t) == null || companyOf(t) === companyId)
  );
}

/**
 * Impuesto de compra de Odoo para un tipo de IVA leído de la factura.
 * Prefiere el impuesto por defecto de la empresa si su % coincide; si hay varios
 * candidatos ordinarios con el mismo %, elige el primero (el usuario puede cambiarlo).
 */
export function taxForRate(
  taxes: OdooTax[],
  companyId: number | null,
  rate: number | null,
  defaultTaxId: number | null
): number | null {
  if (rate == null) return defaultTaxId;
  const candidates = purchaseTaxes(taxes, companyId).filter((t) => Math.abs(t.amount - rate) < 0.01);
  if (defaultTaxId != null && candidates.some((t) => t.id === defaultTaxId)) return defaultTaxId;
  const ordinary = candidates.find((t) => !SPECIAL_TAX.test(t.name));
  return ordinary?.id ?? defaultTaxId;
}

/** Impuesto de retención IRPF (en Odoo España tienen % negativo, p. ej. −15). */
export function withholdingTaxFor(taxes: OdooTax[], companyId: number | null, rate: number | null | undefined): number | null {
  if (!rate) return null;
  const match = purchaseTaxes(taxes, companyId).find(
    (t) => Math.abs(t.amount + rate) < 0.01 && /irpf|retenc/i.test(t.name)
  );
  return match?.id ?? null;
}

/** Empresa de Odoo cuyo NIF coincide con el del destinatario de la factura. */
export function companyForCustomerVat(companies: OdooCompany[], customerVat: string | null | undefined): number | null {
  const key = taxIdKey(customerVat);
  if (!key) return null;
  return companies.find((c) => c.vat && taxIdKey(c.vat) === key)?.id ?? null;
}
