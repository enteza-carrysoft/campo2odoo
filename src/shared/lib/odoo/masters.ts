import type {
  OdooAccount,
  OdooCompany,
  OdooJournal,
  OdooMasters,
  OdooPartner,
  OdooTax,
  OdooVersion,
} from "@/shared/types";
import { OdooClient } from "./client";

const ES = { context: { lang: "es_ES" } };

export async function fetchMasters(client: OdooClient, version: OdooVersion = "18"): Promise<OdooMasters> {
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

  let accounts: OdooAccount[];

  if (version === "15") {
    // Odoo ≤15: account_type doesn't exist; company association is Many2one (company_id).
    // Fetch all accounts in a single pass — no company context needed.
    const raw = await client.searchRead<{
      id: number; code: string; name: string;
      company_id: [number, string] | false;
    }>(
      "account.account",
      [["deprecated", "=", false]],
      ["id", "code", "name", "company_id"],
      { limit: 5000, order: "code asc", ...ES }
    );
    accounts = raw.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      company_ids: a.company_id ? [a.company_id[0]] : [],
    }));
  } else {
    // Odoo ≥16: account_type (char) + company_ids (Many2many).
    // Load per-company so `code` is resolved in the correct company context.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const accountMap = new Map<number, OdooAccount>();
    for (let i = 0; i < companies.length; i++) {
      if (i > 0) await sleep(400);
      const batch = await client.searchRead<OdooAccount>(
        "account.account",
        [["deprecated", "=", false]],
        ["id", "code", "name", "account_type", "company_ids"],
        {
          limit: 5000,
          order: "code asc",
          context: { lang: "es_ES", company_id: companies[i].id, allowed_company_ids: [companies[i].id] },
        }
      );
      batch.forEach((a) => { if (!accountMap.has(a.id)) accountMap.set(a.id, a); });
    }
    accounts = Array.from(accountMap.values()).sort((a, b) =>
      (a.code ?? "").localeCompare(b.code ?? "")
    );
  }

  const taxes = await client.searchRead<OdooTax>(
    "account.tax",
    [
      ["active", "=", true],
      ["type_tax_use", "=", "purchase"],
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
