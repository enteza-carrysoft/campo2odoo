import type {
  OdooAccount,
  OdooCompany,
  OdooJournal,
  OdooMasters,
  OdooPartner,
  OdooTax,
} from "@/shared/types";
import { OdooClient } from "./client";

const ES = { context: { lang: "es_ES" } };

export async function fetchMasters(client: OdooClient): Promise<OdooMasters> {
  // 1. Detect the authenticated user's default company
  const uid = await client.authenticate();
  const [user] = await client.searchRead<{
    id: number;
    company_id: [number, string];
  }>("res.users", [["id", "=", uid]], ["id", "company_id"]);

  if (!user?.company_id) {
    throw new Error("No se pudo determinar la empresa del usuario autenticado.");
  }

  const companyId = user.company_id[0];
  const companyName = user.company_id[1];

  // 2. Fetch masters sequentially (avoids HTTP 429).
  //    All queries use lang=es_ES so translatable names come in Spanish.

  const companies = await client.searchRead<OdooCompany>(
    "res.company",
    [],
    ["id", "name"],
    { order: "name asc", ...ES }
  );

  const partners = await client.searchRead<OdooPartner>(
    "res.partner",
    [["supplier_rank", ">", 0]],
    ["id", "name", "vat", "email", "company_id"],
    { limit: 1000, order: "name asc", ...ES }
  );

  // account.account uses company_ids (Many2many) in Odoo 17+.
  // Limit 5000 to load the full chart of accounts.
  const accounts = await client.searchRead<OdooAccount>(
    "account.account",
    [["deprecated", "=", false]],
    ["id", "code", "name", "account_type", "company_ids"],
    { limit: 5000, order: "code asc", ...ES }
  );

  const taxes = await client.searchRead<OdooTax>(
    "account.tax",
    [
      ["active", "=", true],
      ["type_tax_use", "in", ["purchase", "none"]],
    ],
    ["id", "name", "amount", "type_tax_use", "company_id"],
    { order: "amount desc", ...ES }
  );

  const journals = await client.searchRead<OdooJournal>(
    "account.journal",
    [["type", "=", "purchase"]],
    ["id", "name", "type", "company_id"],
    { order: "name asc", ...ES }
  );

  return { companies, partners, accounts, taxes, journals, companyId, companyName };
}
