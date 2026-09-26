/**
 * Identificadores fiscales: validación de NIF/NIE/CIF españoles (dígito de control),
 * normalización al formato que espera Odoo y búsqueda de candidatos en texto libre.
 */

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const CIF_CONTROL_LETTERS = "JABCDEFGHI";

function isValidDni(id: string): boolean {
  const m = id.match(/^(\d{8})([A-Z])$/);
  return !!m && DNI_LETTERS[Number(m[1]) % 23] === m[2];
}

function isValidNie(id: string): boolean {
  const m = id.match(/^([XYZ])(\d{7})([A-Z])$/);
  if (!m) return false;
  const num = Number(`${"XYZ".indexOf(m[1])}${m[2]}`);
  return DNI_LETTERS[num % 23] === m[3];
}

function isValidCif(id: string): boolean {
  const m = id.match(/^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/);
  if (!m) return false;
  const [, letter, digits, control] = m;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    if (i % 2 === 0) {
      const doubled = d * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += d;
    }
  }
  const controlDigit = (10 - (sum % 10)) % 10;
  const controlLetter = CIF_CONTROL_LETTERS[controlDigit];
  if ("PQRSNW".includes(letter)) return control === controlLetter;
  if ("ABEH".includes(letter)) return control === String(controlDigit);
  return control === String(controlDigit) || control === controlLetter;
}

/** Valida un NIF/NIE/CIF español sin prefijo de país. */
export function isValidSpanishTaxId(id: string): boolean {
  return isValidDni(id) || isValidNie(id) || isValidCif(id);
}

export interface NormalizedTaxId {
  /** Forma para Odoo: "ESB12345678" en España, "DE123456789" en la UE. */
  value: string;
  country: string | null;
  /** true si superó el dígito de control (solo verificable en España). */
  checksumValid: boolean;
}

const EU_VAT = /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|GR|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)[0-9A-Z]{2,13}$/;

/**
 * Normaliza un identificador fiscal leído de una factura.
 * Devuelve null si no parece un identificador fiscal.
 */
export function normalizeTaxId(raw: string | null | undefined): NormalizedTaxId | null {
  if (!raw) return null;
  const cleaned = raw
    .toUpperCase()
    .replace(/^(NIF|CIF|NIE|VAT|N\.?I\.?F\.?|C\.?I\.?F\.?)[\s:.-]*/, "")
    .replace(/[^A-Z0-9]/g, "");
  if (cleaned.length < 8) return null;

  const local = cleaned.startsWith("ES") ? cleaned.slice(2) : cleaned;
  if (isValidSpanishTaxId(local)) {
    return { value: `ES${local}`, country: "ES", checksumValid: true };
  }
  if (EU_VAT.test(cleaned) && !cleaned.startsWith("ES")) {
    return { value: cleaned, country: cleaned.slice(0, 2), checksumValid: false };
  }
  // Parece español pero el control no cuadra: se conserva para que el usuario lo revise.
  if (/^([A-Z]\d{7}[0-9A-Z]|\d{8}[A-Z])$/.test(local)) {
    return { value: `ES${local}`, country: "ES", checksumValid: false };
  }
  return null;
}

/** Clave comparable sin prefijo de país (ESB12345678 → B12345678). */
export function taxIdKey(raw: string | null | undefined): string | null {
  const n = normalizeTaxId(raw);
  if (!n) return null;
  return n.country === "ES" ? n.value.slice(2) : n.value;
}

const CANDIDATE_RE =
  /\b(?:ES[\s.-]?)?(?:[A-HJNPQRSUVW][\s.-]?\d{2}[\s.]?\d{3}[\s.]?\d{2}[\s.-]?[0-9A-J]|\d{8}[\s.-]?[A-Z]|[XYZ][\s.-]?\d{7}[\s.-]?[A-Z])\b/g;

/** Identificadores fiscales españoles válidos que aparecen en un texto, en orden de aparición. */
export function findSpanishTaxIds(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const m of text.toUpperCase().matchAll(CANDIDATE_RE)) {
    const n = normalizeTaxId(m[0]);
    if (n?.checksumValid && !found.includes(n.value)) found.push(n.value);
  }
  return found;
}
