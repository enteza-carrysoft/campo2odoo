const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

async function generateTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Campo2Odoo';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Facturas');
  ws.views = [{ state: 'frozen', ySplit: 1, showGridLines: true }];

  const headers = [
    { header: 'Nombre Proveedor', key: 'supplier_name', width: 28 },
    { header: 'NIF/CIF Proveedor', key: 'supplier_vat', width: 20 },
    { header: 'Nº Factura', key: 'invoice_number', width: 18 },
    { header: 'Fecha Factura', key: 'invoice_date', width: 16 },
    { header: 'Fecha Vencimiento', key: 'due_date', width: 20 },
    { header: 'Concepto / Descripción', key: 'description', width: 40 },
    { header: 'Cantidad', key: 'quantity', width: 12 },
    { header: 'Precio Unitario', key: 'unit_price', width: 16 },
    { header: 'Cuenta Contable', key: 'account_code', width: 18 },
    { header: 'IVA (%)', key: 'tax_rate', width: 12 },
    { header: 'Diario Compras (Código)', key: 'journal_code', width: 26 },
    { header: 'Empresa ID', key: 'company_id', width: 14 }
  ];

  ws.columns = headers;

  // Header style
  const headerRow = ws.getRow(1);
  headerRow.height = 32;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A5F' }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF334155' } }
    };
  });

  // Example rows
  const examples = [
    {
      supplier_name: 'Proveedor Ejemplo S.L.',
      supplier_vat: 'B12345678',
      invoice_number: 'FRA-2026-001',
      invoice_date: '06/06/2026',
      due_date: '06/07/2026',
      description: 'Servicios de consultoría técnica',
      quantity: 10,
      unit_price: 150.00,
      account_code: '623000',
      tax_rate: 21,
      journal_code: 'Compras',
      company_id: 1
    },
    {
      supplier_name: 'Proveedor Ejemplo S.L.',
      supplier_vat: 'B12345678',
      invoice_number: 'FRA-2026-001',
      invoice_date: '06/06/2026',
      due_date: '06/07/2026',
      description: 'Desplazamiento y dietas',
      quantity: 1,
      unit_price: 250.00,
      account_code: '629100',
      tax_rate: 21,
      journal_code: 'Compras',
      company_id: 1
    },
    {
      supplier_name: 'Suministros Industriales SA',
      supplier_vat: 'A87654321',
      invoice_number: '2026-4521',
      invoice_date: '01/06/2026',
      due_date: '15/07/2026',
      description: 'Material de oficina',
      quantity: 50,
      unit_price: 12.50,
      account_code: '600000',
      tax_rate: 21,
      journal_code: 'Compras',
      company_id: 1
    }
  ];

  for (const ex of examples) {
    const row = ws.addRow(ex);
    row.height = 22;
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
  }

  // Add a note row
  const noteRow = ws.addRow({
    description: '>>> Nota: cada línea de esta hoja genera una línea de factura. Las líneas con mismo proveedor + NIF + nº factura se agrupan en una misma factura.'
  });
  noteRow.height = 28;
  noteRow.getCell('description').font = { italic: true, color: { argb: 'FF64748B' }, size: 10 };
  noteRow.getCell('description').alignment = { wrapText: true };

  // Add auto filter
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length }
  };

  const outputPath = path.join(__dirname, 'plantilla_facturas.xlsx');
  await workbook.xlsx.writeFile(outputPath);
  console.log('Plantilla generada en:', outputPath);
}

generateTemplate().catch((err) => {
  console.error('Error generando plantilla:', err);
  process.exit(1);
});
