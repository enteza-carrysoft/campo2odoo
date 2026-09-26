import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtractedInvoice, ExtractedLine } from "@/shared/types";
import { findSpanishTaxIds, isValidSpanishTaxId, normalizeTaxId } from "./tax-id";
import { snapVatRate, validateInvoice } from "./validate";

const OWN = "B12345674"; // CIF válido de "nuestra" empresa
const SUPPLIER = "A58818501"; // CIF válido del proveedor

function line(amount: number, taxRate: number | null = null): ExtractedLine {
  return { id: crypto.randomUUID(), description: "x", quantity: 1, unitPrice: amount, taxRate, amount, accountId: null, taxIds: [] };
}

function invoice(overrides: Partial<ExtractedInvoice> = {}): ExtractedInvoice {
  return {
    supplierName: "Proveedor SL",
    supplierVat: SUPPLIER,
    invoiceNumber: "F-001",
    invoiceDate: "2026-05-10",
    dueDate: null,
    currency: "EUR",
    subtotal: 100,
    totalTax: 21,
    total: 121,
    lines: [line(100)],
    confidence: 0.9,
    engine: "azure-di",
    ...overrides,
  };
}

const today = new Date("2026-06-01");

test("valida DNI, NIE y CIF por dígito de control", () => {
  assert.ok(isValidSpanishTaxId("12345678Z"));
  assert.ok(isValidSpanishTaxId("X1234567L"));
  assert.ok(isValidSpanishTaxId(OWN));
  assert.ok(isValidSpanishTaxId(SUPPLIER));
  assert.ok(!isValidSpanishTaxId("B12345675"));
});

test("normaliza el NIF al formato de Odoo", () => {
  assert.deepEqual(normalizeTaxId("NIF: es b-1234567.4"), { value: `ES${OWN}`, country: "ES", checksumValid: true });
  assert.equal(normalizeTaxId("DE123456789")?.value, "DE123456789");
  assert.equal(normalizeTaxId("B12345675")?.checksumValid, false);
  assert.equal(normalizeTaxId("Tel 912345"), null);
});

test("encuentra NIF válidos en el texto e ignora los inválidos", () => {
  assert.deepEqual(findSpanishTaxIds(`CIF: B-12345675 · NIF A58818501 · cliente ${OWN}`), [`ES${SUPPLIER}`, `ES${OWN}`]);
});

test("ajusta el tipo de IVA al tipo legal más cercano", () => {
  assert.equal(snapVatRate(20.99), 21);
  assert.equal(snapVatRate(9.8), 10);
  assert.equal(snapVatRate(7.5), 7.5);
});

test("corrige proveedor y cliente intercambiados", () => {
  const out = validateInvoice(
    invoice({ supplierVat: OWN, supplierName: "Nosotros SA", customerVat: SUPPLIER, customerName: "Proveedor SL" }),
    { ownTaxIds: [`ES${OWN}`], today }
  );
  assert.equal(out.supplierVat, `ES${SUPPLIER}`);
  assert.equal(out.supplierName, "Proveedor SL");
  assert.equal(out.customerVat, `ES${OWN}`);
});

test("deduce el NIF del proveedor del texto cuando falta, sin usar el propio", () => {
  const out = validateInvoice(invoice({ supplierVat: null }), {
    ownTaxIds: [OWN],
    text: `Cliente: ${OWN}\nEmisor CIF ${SUPPLIER}`,
    today,
  });
  assert.equal(out.supplierVat, `ES${SUPPLIER}`);
  assert.ok(out.warnings?.some((w) => w.includes("deducido")));
});

test("detecta la retención de IRPF cuando el total no cuadra", () => {
  const out = validateInvoice(invoice({ subtotal: 1000, totalTax: 210, total: 1060, lines: [line(1000)] }), { today });
  assert.equal(out.withholdingRate, 15);
});

test("convierte líneas con IVA incluido a base imponible", () => {
  const out = validateInvoice(invoice({ lines: [line(60.5), line(60.5)] }), { today });
  assert.deepEqual(out.lines.map((l) => l.amount), [50, 50]);
  assert.ok(out.warnings?.some((w) => w.includes("incluían IVA")));
});

test("asigna tipos de IVA por línea a partir del desglose", () => {
  const out = validateInvoice(
    invoice({
      subtotal: 150,
      totalTax: 26,
      total: 176,
      taxBreakdown: [{ rate: 21, base: 100, amount: 21 }, { rate: 10, base: 50, amount: 5 }],
      lines: [line(50), line(100)],
    }),
    { today }
  );
  assert.deepEqual(out.lines.map((l) => l.taxRate), [10, 21]);
  assert.deepEqual(out.warnings, []);
});

test("sin líneas, crea una por cada tipo del desglose", () => {
  const out = validateInvoice(
    invoice({ subtotal: 150, totalTax: 26, total: 176, lines: [], taxBreakdown: [{ rate: 21, base: 100, amount: 21 }, { rate: 10, base: 50, amount: 5 }] }),
    { today }
  );
  assert.deepEqual(out.lines.map((l) => [l.amount, l.taxRate]), [[100, 21], [50, 10]]);
});

test("limpia el número de factura y descarta vencimientos imposibles", () => {
  const out = validateInvoice(invoice({ invoiceNumber: " Nº: 2026/0042 ", dueDate: "2026-01-01" }), { today });
  assert.equal(out.invoiceNumber, "2026/0042");
  assert.equal(out.dueDate, null);
});

test("una factura correcta no genera avisos", () => {
  assert.deepEqual(validateInvoice(invoice(), { today }).warnings, []);
});
