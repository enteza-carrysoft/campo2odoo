import ExcelJS from 'exceljs';
import type { InvoiceFile, OdooMasters } from '@/shared/types';

export async function generateExcelBuffer(
  invoices: InvoiceFile[],
  masters: OdooMasters | null
): Promise<any> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Campo2Odoo';
  workbook.lastModifiedBy = 'Campo2Odoo';
  workbook.created = new Date();
  workbook.modified = new Date();

  // 1. Sheet: FACTURAS
  const wsInvoices = workbook.addWorksheet('Facturas');
  wsInvoices.views = [{ state: 'frozen', ySplit: 1, showGridLines: true }];

  const headers = [
    { header: 'Nombre Proveedor', key: 'supplier_name', width: 25 },
    { header: 'NIF/CIF Proveedor', key: 'supplier_vat', width: 18 },
    { header: 'Nº Factura', key: 'invoice_number', width: 15 },
    { header: 'Fecha Factura', key: 'invoice_date', width: 15 },
    { header: 'Fecha Vencimiento', key: 'due_date', width: 18 },
    { header: 'Concepto / Descripción', key: 'description', width: 35 },
    { header: 'Cantidad', key: 'quantity', width: 10 },
    { header: 'Precio Unitario', key: 'unit_price', width: 15 },
    { header: 'Cuenta Contable', key: 'account_code', width: 16 },
    { header: 'IVA (%)', key: 'tax_rate', width: 10 },
    { header: 'Diario Compras (Código)', key: 'journal_code', width: 22 },
    { header: 'Empresa ID', key: 'company_id', width: 12 }
  ];

  wsInvoices.columns = headers;

  // Style header row
  const headerRow = wsInvoices.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' } // Slate 900
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF334155' } }
    };
  });

  // Flat rows mapping
  for (const inv of invoices) {
    const supplierName = inv.extracted?.supplierName ?? '';
    const supplierVat = inv.extracted?.supplierVat ?? '';
    const invoiceNumber = inv.extracted?.invoiceNumber ?? '';
    const invoiceDate = inv.extracted?.invoiceDate ?? '';
    const dueDate = inv.extracted?.dueDate ?? '';
    const companyId = inv.companyId ?? null;

    // Resolve journal code
    let journalCode = '';
    if (masters && inv.journalId) {
      const journal = masters.journals.find(j => j.id === inv.journalId);
      if (journal) journalCode = journal.name;
    }

    // Process lines
    if (inv.lines.length === 0) {
      // If there are no lines, export a default empty line
      wsInvoices.addRow({
        supplier_name: supplierName,
        supplier_vat: supplierVat,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate,
        description: 'Línea de factura sin concepto',
        quantity: 1,
        unit_price: inv.extracted?.total ?? 0,
        account_code: '',
        tax_rate: null,
        journal_code: journalCode,
        company_id: companyId
      });
    } else {
      for (const line of inv.lines) {
        // Resolve account code
        let accountCode = '';
        if (masters && line.accountId) {
          const account = masters.accounts.find(a => a.id === line.accountId);
          if (account) accountCode = account.code;
        }

        // Resolve tax rate percentage
        let taxRate = line.taxRate;
        if (masters && line.taxIds.length > 0) {
          const tax = masters.taxes.find(t => t.id === line.taxIds[0]);
          if (tax) taxRate = tax.amount;
        }

        wsInvoices.addRow({
          supplier_name: supplierName,
          supplier_vat: supplierVat,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          due_date: dueDate,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          account_code: accountCode,
          tax_rate: taxRate,
          journal_code: journalCode,
          company_id: companyId
        });
      }
    }
  }

  // Format cells
  wsInvoices.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    row.height = 20;

    row.getCell('quantity').numFmt = '#,##0.00';
    row.getCell('unit_price').numFmt = '#,##0.00';
    row.getCell('tax_rate').numFmt = '0';
    row.getCell('company_id').numFmt = '0';

    row.getCell('supplier_vat').alignment = { horizontal: 'center' };
    row.getCell('invoice_number').alignment = { horizontal: 'center' };
    row.getCell('invoice_date').alignment = { horizontal: 'center' };
    row.getCell('due_date').alignment = { horizontal: 'center' };
    row.getCell('tax_rate').alignment = { horizontal: 'center' };
    row.getCell('account_code').alignment = { horizontal: 'center' };
    row.getCell('journal_code').alignment = { horizontal: 'center' };
    row.getCell('company_id').alignment = { horizontal: 'center' };

    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}
