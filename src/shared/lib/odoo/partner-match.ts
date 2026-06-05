/**
 * Emparejamiento robusto entre el proveedor extraído de una factura (OCR/Excel)
 * y los proveedores existentes en Odoo.
 *
 * Punto único de verdad usado por:
 *  - Frontend (auto-selección al extraer)        → page.tsx
 *  - Importador de Excel                          → excel-importer.ts
 *  - Importador a Odoo (última línea de defensa)  → importer.ts
 *
 * Diseñado para tolerar las diferencias habituales que rompían el match exacto:
 *  - Sufijos societarios: "S.L." / "SL" / "S.L.U." / "Sociedad Limitada"
 *  - Tildes y mayúsculas:  "Construcciones Pérez" vs "construcciones perez"
 *  - Puntuación y espacios: "Bar-Pepe , S.A." vs "Bar Pepe SA"
 *  - VAT con prefijo país y formato: "ES B-12345678" vs "B12345678"
 */

export type MatchConfidence = "vat" | "exact" | "strong" | "weak" | "none";

export interface PartnerLike {
  id: number;
  name: string;
  vat?: string | null;
}

export interface PartnerMatch<T extends PartnerLike = PartnerLike> {
  partner: T;
  confidence: MatchConfidence;
  /** Puntuación 0..1 (1 = VAT idéntico). Útil para ordenar / depurar. */
  score: number;
}

export interface PartnerQuery {
  name?: string | null;
  vat?: string | null;
}

// Confianzas que consideramos seguras para auto-asignar sin intervención del usuario.
const AUTO_ASSIGN: ReadonlySet<MatchConfidence> = new Set<MatchConfidence>([
  "vat",
  "exact",
  "strong",
]);

export function isAutoAssignable(confidence: MatchConfidence): boolean {
  return AUTO_ASSIGN.has(confidence);
}

// ── VAT ─────────────────────────────────────────────────────────────────────

// Prefijos de país ISO usados en los VAT intracomunitarios.
const COUNTRY_PREFIXES = new Set([
  "ES", "PT", "FR", "DE", "IT", "GB", "NL", "BE", "IE", "AT", "DK", "FI",
  "SE", "PL", "CZ", "SK", "HU", "RO", "BG", "GR", "EL", "HR", "SI", "LU",
  "LT", "LV", "EE", "CY", "MT", "CH", "NO",
]);

/** Limpia un VAT a solo alfanuméricos en mayúsculas. */
export function normalizeVat(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return v.length > 0 ? v : null;
}

/**
 * Devuelve las claves canónicas comparables de un VAT: la forma normalizada
 * y —si aplica— la misma sin el prefijo de país. Así "ESB12345678" y
 * "B12345678" comparten la clave "B12345678".
 */
export function vatKeys(raw: string | null | undefined): string[] {
  const v = normalizeVat(raw);
  if (!v) return [];
  const keys = new Set<string>([v]);
  const m = v.match(/^([A-Z]{2})([A-Z0-9]{7,})$/);
  if (m && COUNTRY_PREFIXES.has(m[1])) keys.add(m[2]);
  return [...keys];
}

function vatMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = vatKeys(a);
  const kb = vatKeys(b);
  if (ka.length === 0 || kb.length === 0) return false;
  return ka.some((k) => kb.includes(k));
}

// ── Nombre ──────────────────────────────────────────────────────────────────

// Tokens societarios / genéricos que no aportan identidad y se descartan.
const STOP_TOKENS = new Set([
  // España
  "sl", "sa", "slu", "sll", "slp", "sau", "scp", "sc", "cb", "scl", "sccl",
  "aie", "sat", "scoop", "coop", "sociedad", "limitada", "anonima", "laboral",
  "unipersonal", "cooperativa", "civil", "comunidad", "bienes",
  // Internacional
  "ltd", "limited", "llc", "inc", "incorporated", "corp", "corporation",
  "gmbh", "srl", "bv", "nv", "plc", "ag", "spa", "sas", "sarl", "co",
  "company", "the",
]);

/** Quita tildes/diacríticos. */
function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Tokens significativos del nombre: ascii, en minúsculas, sin puntuación,
 * sin sufijos societarios ni iniciales sueltas de sufijo.
 */
export function nameTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const base = stripDiacritics(raw.toString().toLowerCase())
    // "S.L." → "SL", "S.A." → "SA" (juntar iniciales separadas por puntos)
    .replace(/[.,]/g, "")
    // resto de separadores → espacio
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  let tokens = base.split(/\s+/).filter(Boolean).filter((t) => !STOP_TOKENS.has(t));

  // Iniciales sueltas remanentes al final ("s", "a") suelen ser restos de "S. A."
  while (tokens.length > 1 && tokens[tokens.length - 1].length === 1) {
    tokens = tokens.slice(0, -1);
  }
  return tokens;
}

/** Forma canónica del nombre para comparación exacta. */
export function normalizeName(raw: string | null | undefined): string {
  return nameTokens(raw).join(" ");
}

/** Coeficiente de Dice sobre bigramas de caracteres (0..1). */
function diceCoefficient(a: string, b: string): number {
  const ca = a.replace(/\s+/g, "");
  const cb = b.replace(/\s+/g, "");
  if (ca.length < 2 || cb.length < 2) return ca === cb && ca.length > 0 ? 1 : 0;

  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };
  const ma = bigrams(ca);
  const mb = bigrams(cb);
  let overlap = 0;
  for (const [bg, countA] of ma) {
    const countB = mb.get(bg);
    if (countB) overlap += Math.min(countA, countB);
  }
  return (2 * overlap) / (ca.length - 1 + (cb.length - 1));
}

/** ¿Son todos los tokens del más corto un subconjunto del más largo? */
function isTokenSubset(shorter: string[], longer: string[]): boolean {
  if (shorter.length === 0) return false;
  const set = new Set(longer);
  return shorter.every((t) => set.has(t));
}

interface NameScore {
  confidence: Exclude<MatchConfidence, "vat">;
  score: number;
}

/** Evalúa la similitud entre dos nombres ya tokenizados/normalizados. */
function scoreName(queryTokens: string[], partnerTokens: string[]): NameScore {
  if (queryTokens.length === 0 || partnerTokens.length === 0) {
    return { confidence: "none", score: 0 };
  }

  const qCore = queryTokens.join(" ");
  const pCore = partnerTokens.join(" ");

  if (qCore === pCore) return { confidence: "exact", score: 0.97 };

  const [shorter, longer] =
    queryTokens.length <= partnerTokens.length
      ? [queryTokens, partnerTokens]
      : [partnerTokens, queryTokens];

  const dice = diceCoefficient(qCore, pCore);

  // Subconjunto de tokens con al menos un token "fuerte" (>=3 chars).
  const subset =
    isTokenSubset(shorter, longer) && shorter.some((t) => t.length >= 3);
  if (subset) return { confidence: "strong", score: Math.max(0.85, dice) };

  if (dice >= 0.85) return { confidence: "strong", score: dice };
  if (dice >= 0.62) return { confidence: "weak", score: dice };

  return { confidence: "none", score: dice };
}

const CONFIDENCE_RANK: Record<MatchConfidence, number> = {
  none: 0,
  weak: 1,
  strong: 2,
  exact: 3,
  vat: 4,
};

/**
 * Busca el mejor proveedor para la consulta dada.
 * Prioridad: VAT > nombre exacto normalizado > subconjunto/fuzzy fuerte > fuzzy débil.
 * Devuelve `null` si no hay ninguna coincidencia ni siquiera débil.
 */
export function matchPartner<T extends PartnerLike>(
  partners: readonly T[],
  query: PartnerQuery
): PartnerMatch<T> | null {
  if (partners.length === 0) return null;

  const queryVat = query.vat ?? null;
  const queryTokens = nameTokens(query.name);

  // 1) VAT: máxima confianza. Si además coincide el nombre, mejor; si no, sirve igual.
  if (queryVat) {
    let vatHit: T | null = null;
    for (const p of partners) {
      if (vatMatches(queryVat, p.vat)) {
        // Preferimos un VAT-match cuyo nombre también encaje (evita VATs duplicados/erróneos).
        const nameOk = scoreName(queryTokens, nameTokens(p.name)).confidence !== "none";
        if (nameOk) return { partner: p, confidence: "vat", score: 1 };
        if (!vatHit) vatHit = p;
      }
    }
    if (vatHit) return { partner: vatHit, confidence: "vat", score: 0.98 };
  }

  // 2) Nombre: mejor candidato por confianza y score.
  let best: PartnerMatch<T> | null = null;
  for (const p of partners) {
    const { confidence, score } = scoreName(queryTokens, nameTokens(p.name));
    if (confidence === "none") continue;
    if (
      !best ||
      CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[best.confidence] ||
      (CONFIDENCE_RANK[confidence] === CONFIDENCE_RANK[best.confidence] &&
        score > best.score)
    ) {
      best = { partner: p, confidence, score };
    }
  }

  return best;
}
