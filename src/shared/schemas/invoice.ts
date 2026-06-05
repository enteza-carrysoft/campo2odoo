import { z } from "zod";

export const appConfigSchema = z.object({
  odooUrl: z.string().url("URL de Odoo inválida"),
  odooDb: z.string().min(1, "Base de datos requerida"),
  odooUsername: z.string().min(1, "Usuario requerido"),
  odooApiKey: z.string().min(1, "API key requerida"),
  extractionEngine: z.enum(["native", "azure-di", "llm"]),
  azureDiEndpoint: z.string().optional().default(""),
  azureDiKey: z.string().optional().default(""),
  defaultJournalId: z.number().nullable().default(null),
  defaultAccountId: z.number().nullable().default(null),
});

export type AppConfigInput = z.infer<typeof appConfigSchema>;

export const extractRequestSchema = z.object({
  engine: z.enum(["native", "azure-di", "llm"]),
  azureDiEndpoint: z.string().optional(),
  azureDiKey: z.string().optional(),
});

export const odooTestSchema = z.object({
  odooUrl: z.string().url(),
  odooDb: z.string().min(1),
  odooUsername: z.string().min(1),
  odooApiKey: z.string().min(1),
});

export const importInvoiceSchema = z.object({
  odooUrl: z.string().url(),
  odooDb: z.string().min(1),
  odooUsername: z.string().min(1),
  odooApiKey: z.string().min(1),
  companyId: z.number().int().positive(),
  partnerId: z.number().int().nullable().optional(),
  supplierName: z.string().nullable().optional(),
  supplierVat: z.string().nullable().optional(),
  journalId: z.number().int().positive("Diario requerido"),
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  currency: z.string().default("EUR"),
  lines: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      accountId: z.number().int().positive("Cuenta contable requerida"),
      taxIds: z.array(z.number().int()),
    })
  ).min(1, "Al menos una línea requerida"),
  pdfBase64: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
});

export type ImportInvoiceInput = z.infer<typeof importInvoiceSchema>;
