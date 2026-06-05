const fs = require('fs');
const path = require('path');
const { DocumentAnalysisClient, AzureKeyCredential } = require("@azure/ai-form-recognizer");

// Simple helper to parse .env.local
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('No se encontró el archivo .env.local en la raíz del proyecto.');
  }
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split('=');
    const key = parts[0].trim();
    const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
    env[key] = value;
  });
  return env;
}

// Helper functions matching azure-di.ts
function getAmount(field) {
  if (!field) return null;
  // Check if value is an object containing amount (standard CurrencyValue in Azure SDK)
  if (field.value && typeof field.value === "object" && "amount" in field.value) {
    return field.value.amount;
  }
  if (field.valueCurrency?.amount != null) return field.valueCurrency.amount;
  if (field.valueNumber != null) return field.valueNumber;
  const raw = field.content ?? field.valueString;
  if (!raw) return null;
  
  // Robust Spanish and English number parsing
  const cleaned = raw.replace(/\s/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let parsedStr = cleaned;
  if (lastComma > lastDot) {
    parsedStr = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && cleaned.split(".").length > 2) {
    parsedStr = cleaned.replace(/\./g, "");
  } else if (lastDot > lastComma && cleaned.split(".").pop()?.length === 3) {
    parsedStr = cleaned.replace(/\./g, "");
  } else {
    parsedStr = cleaned.replace(/,/g, "");
  }
  
  const n = parseFloat(parsedStr);
  return isNaN(n) ? null : n;
}

function getContent(field) {
  return field?.content ?? field?.valueString ?? null;
}

function getDate(field) {
  if (!field) return null;
  if (field.value instanceof Date) {
    const d = field.value;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  // If it's an ISO string from Azure SDK
  if (field.value && typeof field.value === "string" && field.value.includes("T")) {
    return field.value.split("T")[0];
  }
  if (field.valueDate) {
    const d = new Date(field.valueDate);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const raw = getContent(field);
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (!m) return null;
  const [, a, b, c] = m;
  const year = c.length === 2 ? `20${c}` : c;
  return `${year}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Uso: node scripts/test-azure-di.js <ruta-del-pdf>');
    process.exit(1);
  }

  const pdfPath = path.resolve(args[0]);
  if (!fs.existsSync(pdfPath)) {
    console.error(`Error: El archivo no existe en la ruta: ${pdfPath}`);
    process.exit(1);
  }

  console.log('1. Cargando credenciales de .env.local...');
  const env = loadEnv();
  const endpoint = env.AZURE_DI_ENDPOINT;
  const apiKey = env.AZURE_DI_KEY;

  if (!endpoint || !apiKey) {
    console.error('Error: AZURE_DI_ENDPOINT o AZURE_DI_KEY no están definidos en .env.local.');
    process.exit(1);
  }

  console.log(`Endpoint: ${endpoint}`);
  console.log(`API Key: ${apiKey.substring(0, 5)}... (oculta)`);
  console.log(`Archivo PDF a analizar: ${pdfPath}\n`);

  console.log('2. Conectando con Azure Document Intelligence...');
  const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey));
  
  console.log('3. Subiendo PDF y ejecutando análisis (prebuilt-invoice)...');
  const fileBuffer = fs.readFileSync(pdfPath);
  const poller = await client.beginAnalyzeDocument("prebuilt-invoice", fileBuffer);
  
  console.log('4. Esperando a que el servicio termine de procesar...');
  const result = await poller.pollUntilDone();

  const doc = result.documents?.[0];
  if (!doc) {
    console.error('Error: Azure no devolvió ningún documento parseado.');
    fs.writeFileSync('azure_raw_full_result.json', JSON.stringify(result, null, 2));
    console.log('Se ha guardado el resultado completo sin filtrar en: azure_raw_full_result.json');
    process.exit(1);
  }

  const fields = doc.fields || {};

  // Save RAW Fields to file
  const rawFieldsPath = path.join(__dirname, '..', 'azure_raw_result.json');
  fs.writeFileSync(rawFieldsPath, JSON.stringify(fields, null, 2));
  console.log(`✓ Guardado resultado RAW de Azure en: ${rawFieldsPath}`);

  // Perform Mapping
  console.log('\n5. Mapeando campos según la lógica de la aplicación...');
  const lines = [];
  const itemsField = fields.Items;
  if (itemsField?.values && itemsField.values.length > 0) {
    for (const item of itemsField.values) {
      const props = item.properties || {};
      const amount = getAmount(props.Amount) ?? getAmount(props.UnitPrice);
      const qty = props.Quantity?.valueNumber ?? 1;
      const unitPrice = getAmount(props.UnitPrice) ?? (amount != null ? amount / qty : null);
      const taxRateRaw = getContent(props.TaxRate);
      const taxRate = taxRateRaw ? parseFloat(taxRateRaw.replace("%", "").trim()) : null;

      lines.push({
        description: getContent(props.Description) ?? "Línea de factura",
        quantity: qty,
        unitPrice: unitPrice ?? 0,
        taxRate: isNaN(taxRate ?? NaN) ? null : taxRate,
        amount: amount ?? 0
      });
    }
  }

  const mappedResult = {
    supplierName: getContent(fields.VendorName),
    supplierVat: getContent(fields.VendorTaxId),
    invoiceNumber: getContent(fields.InvoiceId),
    invoiceDate: getDate(fields.InvoiceDate),
    dueDate: getDate(fields.DueDate),
    currency: fields.InvoiceTotal?.valueCurrency?.currencyCode ?? "EUR",
    subtotal: getAmount(fields.SubTotal),
    totalTax: getAmount(fields.TotalTax),
    total: getAmount(fields.InvoiceTotal),
    lines: lines
  };

  // Save Mapped fields to file
  const mappedPath = path.join(__dirname, '..', 'azure_mapped_result.json');
  fs.writeFileSync(mappedPath, JSON.stringify(mappedResult, null, 2));
  console.log(`✓ Guardado resultado mapeado en: ${mappedPath}\n`);

  console.log('--- RESUMEN MAPEADO ---');
  console.log(`Proveedor:   ${mappedResult.supplierName} (${mappedResult.supplierVat})`);
  console.log(`Factura Nº:  ${mappedResult.invoiceNumber}`);
  console.log(`Fecha:       ${mappedResult.invoiceDate}`);
  console.log(`Subtotal:    ${mappedResult.subtotal} EUR`);
  console.log(`Impuestos:   ${mappedResult.totalTax} EUR`);
  console.log(`Total:       ${mappedResult.total} EUR`);
  console.log(`Líneas extraídas: ${lines.length}`);
  console.log('-----------------------');
}

main().catch(err => {
  console.error('Error durante la ejecución del script:', err);
});
