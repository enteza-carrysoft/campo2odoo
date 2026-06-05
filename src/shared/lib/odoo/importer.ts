import type { OdooImportResult } from "@/shared/types";
import type { ImportInvoiceInput } from "@/shared/schemas/invoice";
import { OdooClient } from "./client";
import { matchPartner, isAutoAssignable } from "./partner-match";

export async function importInvoiceToOdoo(
  client: OdooClient,
  data: ImportInvoiceInput
): Promise<OdooImportResult> {
  // Build invoice line commands (Odoo ORM command 0 = create)
  const invoiceLineIds = data.lines.map((line) => [
    0,
    0,
    {
      name: line.description,
      quantity: line.quantity,
      price_unit: line.unitPrice,
      account_id: line.accountId,
      tax_ids: line.taxIds.length > 0 ? [[6, 0, line.taxIds]] : [[6, 0, []]],
    },
  ]);

  let partnerId = data.partnerId;

  // Resolve or create partner if not provided.
  // El frontend ya resuelve la mayoría de casos; esto es la última línea de defensa
  // (p. ej. importación masiva). Cargamos los proveedores y emparejamos con la misma
  // lógica normalizada que el resto de la app, para NO crear duplicados por
  // diferencias menores (sufijos societarios, tildes, prefijo país en el VAT…).
  if (!partnerId && (data.supplierVat || data.supplierName)) {
    const candidates = await client.searchRead<{
      id: number;
      name: string;
      vat: string | false;
    }>(
      "res.partner",
      [["supplier_rank", ">", 0]],
      ["id", "name", "vat"],
      { limit: 2000, order: "name asc" }
    );

    const match = matchPartner(
      candidates.map((c) => ({ id: c.id, name: c.name, vat: c.vat || null })),
      { name: data.supplierName, vat: data.supplierVat }
    );

    if (match && isAutoAssignable(match.confidence)) {
      partnerId = match.partner.id;
    }
  }

  if (!partnerId) {
    if (!data.supplierName) {
      throw new Error(
        "No se puede registrar la factura en Odoo: proveedor desconocido y sin nombre para poder darlo de alta."
      );
    }
    partnerId = await client.create("res.partner", {
      name: data.supplierName,
      vat: data.supplierVat || false,
      supplier_rank: 1,
      company_type: "company",
    });
  }

  const moveVals: Record<string, unknown> = {
    move_type: "in_invoice",
    company_id: data.companyId,
    partner_id: partnerId,
    journal_id: data.journalId,
    invoice_line_ids: invoiceLineIds,
  };

  if (data.invoiceNumber) moveVals.ref = data.invoiceNumber;
  if (data.invoiceDate) {
    moveVals.invoice_date = data.invoiceDate;
    moveVals.date = data.invoiceDate;
  }
  if (data.dueDate) moveVals.invoice_date_due = data.dueDate;

  // Create draft invoice
  const moveId = await client.create("account.move", moveVals);

  // Attach original PDF if present
  if (data.pdfBase64) {
    await client.create("ir.attachment", {
      name: data.fileName || "factura.pdf",
      type: "binary",
      datas: data.pdfBase64,
      res_model: "account.move",
      res_id: moveId,
      mimetype: "application/pdf",
    });
  }

  // Read back the assigned sequence name
  const [move] = await client.searchRead<{ id: number; name: string }>(
    "account.move",
    [["id", "=", moveId]],
    ["id", "name"]
  );

  const moveName = move?.name ?? `ID ${moveId}`;
  const baseUrl = data.odooUrl.replace(/\/$/, "");
  // Odoo 18 path-based routing. The /odoo/vendor-bills/{id} route requires the
  // Purchase module (adds purchase_order_name to the form view).
  // With Accounting-only, the correct route is /odoo/accounting/vendor-bills/{id}.
  const url = `${baseUrl}/odoo/accounting/vendor-bills/${moveId}`;

  return { moveId, moveName, url };
}
