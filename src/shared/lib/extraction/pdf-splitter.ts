import { PDFDocument } from 'pdf-lib';

/**
 * Extrae un rango de páginas específico de un archivo PDF y devuelve el nuevo PDF como Buffer.
 * @param pdfBuffer El Buffer del archivo PDF original.
 * @param pages Array con los números de página a extraer (1-indexado, ej: [1, 2]).
 */
export async function splitPdfPages(pdfBuffer: Buffer, pages: number[]): Promise<Buffer> {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const subDoc = await PDFDocument.create();

  // En pdf-lib las páginas son 0-indexadas, mapeamos las páginas de 1-indexado a 0-indexado
  const pageIndices = pages.map(p => p - 1).filter(idx => idx >= 0 && idx < srcDoc.getPageCount());

  if (pageIndices.length === 0) {
    throw new Error(`Rango de páginas inválido para extraer: ${pages.join(', ')}`);
  }

  const copiedPages = await subDoc.copyPages(srcDoc, pageIndices);
  copiedPages.forEach(p => subDoc.addPage(p));

  const pdfBytes = await subDoc.save();
  return Buffer.from(pdfBytes);
}
