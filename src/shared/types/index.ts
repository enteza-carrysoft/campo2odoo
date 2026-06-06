export type ExtractionEngine = "native" | "azure-di" | "llm";

export type OdooVersion = "15" | "18";

export interface AppConfig {
  odooUrl: string;
  odooDb: string;
  odooUsername: string;
  odooApiKey: string;
  odooVersion: OdooVersion;
  extractionEngine: ExtractionEngine;
  azureDiEndpoint: string;
  azureDiKey: string;
  defaultJournalId: number | null;
  defaultJournalMap: Record<string, number>; // companyId → journalId
  defaultAccountMap: Record<string, number>; // companyId → accountId
  defaultTaxMap: Record<string, number>;     // companyId → taxId
}

export interface OdooCompany {
  id: number;
  name: string;
}

export interface OdooPartner {
  id: number;
  name: string;
  vat: string | null;
  email: string | null;
  company_id: [number, string] | false;
}

export interface OdooAccount {
  id: number;
  code: string;
  name: string;
  account_type?: string;
  company_ids: number[];
}

export interface OdooTax {
  id: number;
  name: string;
  amount: number;
  type_tax_use: string;
  company_id: [number, string] | false;
}

export interface OdooJournal {
  id: number;
  name: string;
  type: string;
  company_id: [number, string] | false;
}

export interface OdooMasters {
  companies: OdooCompany[];
  partners: OdooPartner[];
  accounts: OdooAccount[];
  taxes: OdooTax[];
  journals: OdooJournal[];
  companyId: number;
  companyName: string;
}

export interface ExtractedLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number | null;
  amount: number;
  // Odoo assignments (set by user in review)
  accountId: number | null;
  taxIds: number[];
}

export interface ExtractedInvoice {
  supplierName: string | null;
  supplierVat: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string;
  subtotal: number | null;
  totalTax: number | null;
  total: number | null;
  lines: ExtractedLine[];
  confidence: number;
  engine: ExtractionEngine;
  rawText?: string;
  pageRange?: number[];
}

export type InvoiceFileStatus =
  | "pending"
  | "extracting"
  | "extracted"
  | "error";

export type ImportStatus = "idle" | "importing" | "success" | "error";

export interface InvoiceFile {
  id: string;
  name: string;
  size: number;
  // Base64 for sending to API
  dataBase64: string;
  status: InvoiceFileStatus;
  errorMessage?: string;
  extracted?: ExtractedInvoice;
  // Odoo assignments (editable by user)
  companyId: number | null;
  partnerId: number | null;
  journalId: number | null;
  lines: ExtractedLine[];
  selectedForImport: boolean;
  importStatus: ImportStatus;
  importResult?: OdooImportResult;
  // When true, the full PDF is sent to Azure DI as-is (no page-by-page split).
  noSplit: boolean;
}

export interface OdooImportResult {
  moveId: number;
  moveName: string;
  url: string;
}
