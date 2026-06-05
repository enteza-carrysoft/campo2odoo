import ExcelJS from 'exceljs';
import type { InvoiceFile, OdooMasters, ExtractedLine } from '@/shared/types';
import { randomUUID } from 'crypto';
import { matchPartner, isAutoAssignable, normalizeVat as normalizeVatShared } from '@/shared/lib/odoo/partner-match';

export interface ExcelRowData {
  supplierName: string | null;
  supplierVat: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  accountCode: string | null;
  taxRate: number | null;
  journalCode: string | null;
  companyId: number | null;
}

function normalizeVat(vat: string | null | undefined): string | null {
  return normalizeVatShared(vat);
}

function formatDate(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().split('T')[0];
  }
  const str = val.toString().trim();
  // Try parsing DD/MM/YYYY
  const m = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    const [, d, mth, y] = m;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${mth.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Try parsing YYYY-MM-DD
  const mIso = str.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (mIso) {
    const [, y, mth, d] = mIso;
    return `${y}-${mth.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

export async function parseExcelBuffer(buffer: any): Promise<ExcelRowData[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  // Use worksheet named 'Facturas' or fallback to first sheet
  const sheet = workbook.getWorksheet('Facturas') || workbook.worksheets[0];
  if (!sheet) {
    throw new Error('No se encontró ninguna hoja en el archivo Excel.');
  }

  const rows: ExcelRowData[] = [];
  
  // Headers mapping
  let headerMap: Record<string, number> = {};
  const firstRow = sheet.getRow(1);
  firstRow.eachCell((cell, colNumber) => {
    const txt = cell.text ? cell.text.trim().toLowerCase() : '';
    headerMap[txt] = colNumber;
  });

  const getColIndex = (names: string[]): number | null => {
    for (const name of names) {
      const idx = headerMap[name.toLowerCase()];
      if (idx !== undefined) return idx;
    }
    return null;
  };

  const colIdx = {
    supplierName: getColIndex(['nombre proveedor', 'proveedor', 'nombre_proveedor', 'supplier_name']),
    supplierVat: getColIndex(['nif/cif proveedor', 'nif', 'cif', 'nif/cif', 'supplier_vat']),
    invoiceNumber: getColIndex(['nº factura', 'numero factura', 'nº_factura', 'ref', 'invoice_number', 'numero_factura']),
    invoiceDate: getColIndex(['fecha factura', 'fecha_factura', 'invoice_date', 'fecha']),
    dueDate: getColIndex(['fecha vencimiento', 'vencimiento', 'fecha_vencimiento', 'due_date']),
    description: getColIndex(['concepto / descripción', 'concepto', 'descripcion', 'concepto_descripcion', 'description']),
    quantity: getColIndex(['cantidad', 'quantity', 'cant']),
    unitPrice: getColIndex(['precio unitario', 'precio_unitario', 'unit_price', 'precio']),
    accountCode: getColIndex(['cuenta contable', 'cuenta_contable', 'account_code', 'cuenta']),
    taxRate: getColIndex(['iva (%)', 'iva', 'tax_rate', 'tipo_iva', 'porcentaje_iva']),
    journalCode: getColIndex(['diario compras (código)', 'diario', 'journal_code', 'diario_compras']),
    companyId: getColIndex(['empresa id', 'empresa_id', 'company_id', 'empresa'])
  };

  // Iterate rows starting from row 2
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    // Check if row is mostly empty
    const cellsWithContent = row.values ? (row.values as any[]).filter(v => v !== null && v !== undefined && v !== '').length : 0;
    if (cellsWithContent === 0) return;

    const getValue = (colIdxVal: number | null) => {
      if (colIdxVal === null) return null;
      const cell = row.getCell(colIdxVal);
      // exceljs cell values can be objects (like formula or dates) or primitives
      if (cell.value && typeof cell.value === 'object' && 'result' in cell.value) {
        return cell.value.result;
      }
      return cell.value;
    };

    const supplierName = getValue(colIdx.supplierName)?.toString().trim() ?? null;
    const supplierVat = normalizeVat(getValue(colIdx.supplierVat)?.toString());
    const invoiceNumber = getValue(colIdx.invoiceNumber)?.toString().trim() ?? null;
    const invoiceDate = formatDate(getValue(colIdx.invoiceDate));
    const dueDate = formatDate(getValue(colIdx.dueDate));
    const description = getValue(colIdx.description)?.toString().trim() ?? 'Línea de factura';
    
    // Numbers
    const rawQty = getValue(colIdx.quantity);
    const quantity = rawQty !== null && rawQty !== undefined ? parseFloat(rawQty.toString()) : 1;
    const rawPrice = getValue(colIdx.unitPrice);
    const unitPrice = rawPrice !== null && rawPrice !== undefined ? parseFloat(rawPrice.toString()) : 0;
    
    const accountCode = getValue(colIdx.accountCode)?.toString().trim() ?? null;
    
    const rawTax = getValue(colIdx.taxRate);
    const taxRate = rawTax !== null && rawTax !== undefined ? parseFloat(rawTax.toString()) : null;
    
    const journalCode = getValue(colIdx.journalCode)?.toString().trim() ?? null;
    
    const rawCompany = getValue(colIdx.companyId);
    const companyId = rawCompany !== null && rawCompany !== undefined ? parseInt(rawCompany.toString(), 10) : null;

    rows.push({
      supplierName,
      supplierVat,
      invoiceNumber,
      invoiceDate,
      dueDate,
      description,
      quantity: isNaN(quantity) ? 1 : quantity,
      unitPrice: isNaN(unitPrice) ? 0 : unitPrice,
      accountCode,
      taxRate: isNaN(taxRate ?? NaN) ? null : taxRate,
      journalCode,
      companyId
    });
  });

  return rows;
}

export function buildInvoicesFromExcelRows(
  rows: ExcelRowData[],
  masters: OdooMasters | null
): InvoiceFile[] {
  const invoicesMap: Record<string, InvoiceFile> = {};

  for (const row of rows) {
    // Unique key to group rows into the same invoice
    const groupKey = `${row.supplierVat || 'no-vat'}_${row.invoiceNumber || 'no-num'}`;

    if (!invoicesMap[groupKey]) {
      // Find Odoo company, journal and partner if masters exist
      let companyId = row.companyId ?? masters?.companyId ?? null;
      let partnerId: number | null = null;
      let journalId: number | null = null;

      if (masters) {
        // Emparejado robusto por VAT/nombre (normaliza sufijos, tildes, prefijo país…)
        const match = matchPartner(masters.partners, {
          name: row.supplierName,
          vat: row.supplierVat,
        });
        if (match && isAutoAssignable(match.confidence)) partnerId = match.partner.id;

        // Find journal by code or name
        if (row.journalCode) {
          const match = masters.journals.find(
            j => j.name.toLowerCase().includes(row.journalCode!.toLowerCase())
          );
          if (match) journalId = match.id;
        }
        if (!journalId) {
          // fallback to first purchase journal
          journalId = masters.journals[0]?.id ?? null;
        }
      }

      invoicesMap[groupKey] = {
        id: randomUUID(),
        name: `Excel - ${row.invoiceNumber || 'Sin número'}`,
        size: 0,
        dataBase64: '', // No PDF data
        status: 'extracted',
        companyId,
        partnerId,
        journalId,
        lines: [],
        selectedForImport: true,
        importStatus: 'idle',
        extracted: {
          supplierName: row.supplierName,
          supplierVat: row.supplierVat,
          invoiceNumber: row.invoiceNumber,
          invoiceDate: row.invoiceDate,
          dueDate: row.dueDate,
          currency: 'EUR',
          subtotal: 0,
          totalTax: 0,
          total: 0,
          lines: [],
          confidence: 1.0,
          engine: 'native'
        }
      };
    }

    // Now resolve account and taxes for the line
    let accountId: number | null = null;
    let taxIds: number[] = [];

    if (masters) {
      // Find account by code
      if (row.accountCode) {
        const match = masters.accounts.find(a => a.code === row.accountCode);
        if (match) accountId = match.id;
      }
      
      // Find tax by rate percentage
      if (row.taxRate !== null) {
        const match = masters.taxes.find(
          t => Math.round(t.amount) === Math.round(row.taxRate!)
        );
        if (match) taxIds = [match.id];
      }
    }

    const lineAmount = row.quantity * row.unitPrice;
    const lineId = randomUUID();
    const extractedLine: ExtractedLine = {
      id: lineId,
      description: row.description,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      taxRate: row.taxRate,
      amount: lineAmount,
      accountId,
      taxIds
    };

    const inv = invoicesMap[groupKey];
    inv.lines.push(extractedLine);
    
    // Accumulate totals in header
    if (inv.extracted) {
      const subtotal = (inv.extracted.subtotal || 0) + lineAmount;
      const vatPercent = row.taxRate ?? 0;
      const taxAmount = (inv.extracted.totalTax || 0) + (lineAmount * vatPercent / 100);
      
      inv.extracted.subtotal = Number(subtotal.toFixed(2));
      inv.extracted.totalTax = Number(taxAmount.toFixed(2));
      inv.extracted.total = Number((subtotal + taxAmount).toFixed(2));
      inv.extracted.lines = inv.lines;
    }
  }

  return Object.values(invoicesMap);
}
