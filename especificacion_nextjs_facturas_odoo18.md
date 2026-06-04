# Especificación funcional y técnica — Campo2Odoo: aplicación Next.js para lectura de facturas PDF y registro de facturas de proveedor en Odoo 18 Enterprise

**Fecha:** 2026-06-04
**Versión:** 2.0 (migración del stack Streamlit/Python → Next.js/TypeScript)
**Destino del documento:** IA/codificador encargado de construir, probar y dejar operativa la aplicación.
**Rol asumido:** Analista funcional y técnico senior.
**Stack objetivo:** Next.js 16 (App Router) + TypeScript + Neon (Postgres serverless, vía Drizzle ORM) + MinIO/S3 (almacenamiento de PDFs) + Auth.js (autenticación) + pipeline de extracción híbrido (texto nativo + reglas → OCR local Tesseract.js → LLM Vision opt-in) + Excel revisable (ExcelJS) + integración con Odoo 18 Enterprise vía API externa (XML-RPC/JSON-RPC). Despliegue self-hosted en Docker con worker de procesamiento en segundo plano.

> **Nota de versión.** Este documento sustituye a `especificacion_streamlit_facturas_odoo18.md`, que se conserva como referencia funcional. Toda la lógica contable, validaciones, idempotencia y trazabilidad del documento original se mantienen sin recortes; lo que cambia es la **tecnología de implementación**, no los **principios de seguridad contable**.

---

## 0. Decisiones de arquitectura confirmadas

| Decisión | Elección | Implicación |
|---|---|---|
| **Motor de extracción** | Híbrido configurable | Base determinista (texto nativo + reglas/regex). OCR local (Tesseract.js) para escaneados. LLM Vision **opt-in y desactivable** respetando el principio §22. |
| **Runtime / despliegue** | Next.js self-hosted en Docker | Node long-running, binarios nativos disponibles, procesos largos y cola de trabajos en proceso (worker). Encaja con un Odoo on-premise o cloud. |
| **Persistencia** | Neon (Postgres serverless) + MinIO/S3 + Auth.js | **Neon** (Postgres + Drizzle ORM) para auditoría/reglas/importaciones; **MinIO/S3** para PDFs; **Auth.js** para autenticación multiusuario. Sustituye a SQLite + filesystem del spec original. |

---

## 1. Objetivo del proyecto

Desarrollar una aplicación web en **Next.js 16** que permita:

1. Subir uno o varios archivos PDF que contienen facturas de gastos o compras.
2. Detectar si cada PDF contiene texto embebido o si es una factura escaneada.
3. Extraer texto mediante lectura nativa o mediante OCR.
4. Interpretar el contenido de la factura y convertirlo en datos estructurados.
5. Generar una vista revisable (web) y un Excel exportable con:
   - Cabecera de factura.
   - Líneas de factura.
   - Proveedor.
   - Bases imponibles.
   - Impuestos.
   - Cuentas contables.
   - Posición fiscal si procede.
   - Distribución analítica si procede.
   - Estado de validación.
   - Errores o advertencias.
6. Permitir la revisión/corrección de datos desde la UI web y/o desde Excel.
7. Registrar en Odoo 18 Enterprise las facturas de proveedor como **borradores**, adjuntando el PDF original y dejando trazabilidad de todo el proceso.
8. Evitar duplicados, controlar errores, aplicar reintentos cuando proceda y dejar un log/auditoría completa.

El objetivo principal no es solo leer PDFs, sino **crear facturas de proveedor fiables en Odoo**, con detalle de líneas, cuentas, impuestos y evidencias, minimizando errores contables.

---

## 2. Principios de diseño

> Estos principios son **idénticos** al spec original y tienen **prioridad sobre cualquier decisión técnica**. La migración a Next.js no relaja ninguna validación contable.

### 2.1. Principio de seguridad contable

La aplicación **no debe contabilizar automáticamente** facturas en Odoo salvo que el usuario active expresamente esa opción y todas las validaciones críticas estén en verde.

Por defecto:

- Se crearán facturas de proveedor en estado **borrador** (`draft`).
- Se adjuntará el PDF original.
- Se guardará una referencia interna de importación.
- Se permitirá revisar en Odoo antes de confirmar.

### 2.2. Principio de revisión humana

- Cada campo extraído tendrá, cuando sea posible, un indicador de confianza.
- Los campos críticos se validarán contra totales e información maestra de Odoo.
- La aplicación debe facilitar la revisión antes del envío a Odoo.
- Ninguna factura con errores críticos debe importarse.

### 2.3. Principio de idempotencia

La aplicación debe poder reintentarse sin duplicar facturas. Estrategia combinada:

- Hash SHA-256 del PDF.
- NIF/VAT del proveedor.
- Número de factura del proveedor.
- Fecha de factura.
- Importe total.
- Registro de importaciones en Postgres (Neon).
- Búsqueda previa en Odoo por `move_type`, `partner_id`, `ref`, `invoice_date`, `amount_total` y `company_id`.

Si es posible añadir un campo personalizado en Odoo, se recomienda `x_import_uuid` o `x_source_file_hash` en `account.move`. Si no se puede personalizar Odoo, mantener la trazabilidad en la tabla `invoice_imports` de Neon (Postgres).

### 2.4. Principio de configuración explícita

No se deben inventar cuentas contables. La aplicación debe permitir configurar reglas de asignación por: proveedor, NIF/VAT, palabra clave, producto, familia de gasto, porcentaje de IVA, diario, empresa y cuenta analítica.

Si no existe regla suficiente, la factura debe quedar en estado `REQUIERE_REVISION`.

### 2.5. Principio de privacidad de datos (refuerzo §22.9–22.10)

- El pipeline funciona **sin enviar datos a IA externa por defecto**.
- El uso de **LLM Vision** (Claude/GPT/Mistral) es **opt-in por configuración**, con aviso explícito en la UI y opción de anonimización.
- El OCR por defecto es **local** (Tesseract.js) y no sale de la red del despliegue.

---

## 3. Información técnica contrastada que condiciona el diseño

### 3.1. Odoo 18 Enterprise

Odoo 18 permite integración externa mediante **API externa XML-RPC** y también **JSON-RPC**. Para Odoo Online los usuarios no tienen contraseña local por defecto, por lo que es necesario usar **API key** (sustituye a la contraseña en las llamadas y debe tratarse con la misma protección).

- Autenticación: `xmlrpc/2/common` → `authenticate`.
- Llamadas a modelos: `xmlrpc/2/object` → `execute_kw`.
- Alternativa moderna: endpoint JSON-RPC `/jsonrpc` (un solo transporte HTTP/JSON, más natural desde Node/`fetch`).
- Creación con `create`, consulta con `search`, `read` o `search_read`.

Odoo 18 Enterprise dispone de digitalización OCR/IA propia (servicio IAP que consume créditos). **No sustituye** las validaciones, reglas contables y control local de esta app; su uso queda como integración **opcional** (fase 2).

### 3.2. Frontend / Framework (sustituye a Streamlit)

| Streamlit (v1) | Next.js 16 (v2) |
|---|---|
| `st.file_uploader` | Componente de subida (drag&drop) → `FormData` a Route Handler / Server Action, almacenamiento en MinIO/S3 |
| `st.session_state` | Estado cliente con **Zustand** + estado servidor con **TanStack Query** |
| `st.data_editor` | Tabla editable con **TanStack Table** + inputs controlados (shadcn/ui) |
| `st.download_button` | Descarga vía Route Handler que devuelve el `.xlsx`/log como `Blob` |
| Reruns de Streamlit | React Server Components + revalidación / mutaciones |

- **UI:** React 19 + Tailwind CSS + **shadcn/ui**.
- **Estado global:** Zustand. **Estado servidor/caché:** TanStack Query.
- **Validación de esquemas:** **Zod** (sustituye a Pydantic, frontera única de validación cliente+servidor).
- **Formularios:** React Hook Form + `@hookform/resolvers/zod`.

### 3.3. Extracción PDF y OCR (sustituye al pipeline Python)

Pipeline híbrido en TypeScript/Node:

1. **Texto nativo:** `unpdf` (basado en pdf.js, sin binarios) o `pdfjs-dist` para extraer texto y detectar páginas con texto suficiente. Para extracción de tablas/coordenadas en PDFs nativos complejos, usar `pdfjs-dist` con análisis de posición de items de texto.
2. **Render a imagen** (para OCR de escaneados): `pdf-to-img` (pdf.js) o `@napi-rs/canvas`; alternativa con binario: `pdftoppm` (Poppler) vía `node-poppler`. DPI configurable.
3. **Preprocesado de imagen:** **sharp** (escala de grises, normalización de contraste, threshold, resize/upscale, deskew básico). Sustituye a OpenCV/Pillow.
4. **OCR local:** **Tesseract.js** con `traineddata` `spa` + `eng`. Sustituye a Tesseract/pytesseract. Devuelve texto y `confidence` por palabra/bloque.
5. **OCR cloud opcional (opt-in):** adaptador para Azure Document Intelligence / Mistral OCR / Google Document AI.
6. **LLM Vision opcional (opt-in):** ver §12.2.

> El binario de Tesseract **no es necesario** con Tesseract.js (WASM), pero el contenedor Docker incluirá `poppler-utils` y fuentes para el render robusto de PDFs. Los `traineddata` `spa`/`eng` se empaquetan en la imagen para no descargarlos en runtime.

### 3.4. Excel (sustituye a pandas/openpyxl)

La salida Excel se genera con **ExcelJS**: soporta múltiples hojas, estilos, negrita, filtros (`autoFilter`), `views.frozen` (freeze panes), anchos de columna, colores condicionales y **data validations** (listas desplegables) — equivalente funcional completo de openpyxl.

### 3.5. Integración con Odoo desde Node (sustituye a `xmlrpc.client`)

- **XML-RPC:** librería `xmlrpc` (Node) para hablar con `xmlrpc/2/common` y `xmlrpc/2/object`.
- **JSON-RPC (recomendado):** cliente propio sobre `fetch`/`undici` contra `/jsonrpc` (`service: "object"`, `method: "execute_kw"`). Más simple de tipar y de mockear en tests.
- Se implementará una **interfaz `OdooClient` agnóstica del transporte** (`authenticate`, `executeKw`, `searchRead`, `create`, `write`, `callMethod`) con dos adaptadores (XML-RPC / JSON-RPC) seleccionables por configuración.

### 3.6. Procesamiento en segundo plano (lotes pesados)

El OCR de 20+ PDFs excede cualquier ventana de request síncrona. Arquitectura:

- **Cola de trabajos:** **BullMQ** sobre **Redis** (incluido en el `docker-compose`). Cada PDF es un job.
- **Worker** dedicado (mismo monorepo, entrypoint distinto) que ejecuta el pipeline y actualiza estado/progreso en Postgres.
- La UI consulta progreso vía polling (TanStack Query) o **SSE** (endpoint Server-Sent Events alimentado por `LISTEN/NOTIFY` de Postgres sobre la tabla de jobs/estado).
- Alternativa ligera sin Redis: tabla `jobs` en Postgres + worker con `pg-boss`. **Por defecto: BullMQ + Redis.**

### 3.7. Equivalencias de librerías (mapa Python → TypeScript)

| Función | Python (v1) | TypeScript/Node (v2) |
|---|---|---|
| Validación de esquemas | Pydantic | **Zod** |
| Texto PDF nativo | PyMuPDF / pdfplumber | **unpdf** / **pdfjs-dist** |
| Render PDF→imagen | PyMuPDF / pdf2image | **pdf-to-img** / `node-poppler` |
| Preprocesado imagen | OpenCV / Pillow | **sharp** |
| OCR | pytesseract + Tesseract | **tesseract.js** |
| Excel | pandas + openpyxl | **ExcelJS** |
| Fuzzy matching | RapidFuzz | **fastest-levenshtein** / **Fuse.js** |
| Reintentos | tenacity | **p-retry** + **p-queue** |
| Fechas | python-dateutil | **date-fns** / **Luxon** |
| Odoo API | xmlrpc.client | **xmlrpc** (Node) / JSON-RPC sobre `fetch` |
| Persistencia | SQLite | **Neon Postgres** (`@neondatabase/serverless` + **Drizzle ORM** + drizzle-kit) |
| Almacenamiento PDF | filesystem | **MinIO / S3** (`@aws-sdk/client-s3` + URLs prefirmadas) |
| Autenticación | — | **Auth.js (NextAuth v5)** con adaptador Drizzle/Neon |
| LLM estructurado | openai/instructor | **Vercel AI SDK** (`generateObject` + Zod) + **OpenRouter** |
| Logging | logging (JSON) | **pino** (JSON estructurado) |
| Cola/jobs | — | **BullMQ + Redis** |
| Tests | pytest | **Vitest** + **Playwright** (e2e) |

---

## 4. Alcance propuesto

### 4.1. MVP obligatorio

1. Subida múltiple de PDFs.
2. Identificación de PDF nativo frente a PDF escaneado.
3. OCR local en español (Tesseract.js, `spa+eng`).
4. Extracción estructurada de cabecera y líneas (reglas; LLM opt-in).
5. Vista de revisión web.
6. Exportación a Excel (ExcelJS).
7. Lectura de Excel revisado.
8. Validación de proveedores, impuestos, cuentas y totales.
9. Conexión con Odoo 18.
10. Creación de facturas de proveedor en borrador.
11. Adjuntar PDF original a la factura.
12. Registro de auditoría (Neon Postgres).
13. Control de duplicados.
14. Reintentos ante errores transitorios.
15. Informe de errores por factura.

### 4.2. Funcionalidades fase 2

1. Aprendizaje de reglas por proveedor.
2. Sugerencia automática de cuenta contable según historial de Odoo.
3. Sugerencia automática de impuesto según proveedor/producto/cuenta.
4. Validación de NIF/VAT (algoritmo de dígito de control español + VIES opcional).
5. Soporte para XML embebido o adjunto (Facturae / factura electrónica).
6. División de PDFs con varias facturas.
7. Detección de facturas rectificativas/abonos.
8. Conciliación con pedidos de compra.
9. Lectura desde buzón de correo (IMAP/Graph) como fuente de PDFs.
10. Modo lote con cola de procesamiento (ya base en MVP con BullMQ).
11. Panel de métricas de calidad OCR.
12. Integración opcional con el servicio nativo de digitalización de Odoo (IAP).
13. OCR cloud especializado (Azure/Mistral/Google Doc AI) como motor seleccionable.

---

## 5. Arquitectura funcional

```mermaid
flowchart TD
    A[Usuario sube PDFs] --> B[MinIO/S3 + registro processed_files en Neon]
    B --> C[Calculo hash SHA-256 y deteccion duplicados]
    C --> D[Encolar job BullMQ por PDF]
    D --> E[Worker: clasificacion nativo / escaneado]
    E --> F[Extraccion texto nativa unpdf/pdfjs]
    E --> G[Render + sharp + OCR Tesseract.js]
    F --> H[Normalizacion texto]
    G --> H
    H --> I[Extraccion estructurada: reglas + LLM opt-in]
    I --> J[Validacion contable y fiscal Zod]
    J --> K[Revision web TanStack Table]
    K --> L[Exportacion Excel ExcelJS]
    L --> M[Reimportacion Excel revisado]
    M --> N[Validacion final + dry-run]
    N --> O[Creacion factura borrador en Odoo]
    O --> P[Adjuntar PDF ir.attachment]
    P --> Q[Log auditoria y resultado en Neon]
```

---

## 6. Arquitectura técnica propuesta (estructura del proyecto)

Monorepo Next.js con worker integrado. Se respeta la **arquitectura Feature-First** del proyecto (ver `CLAUDE.md`).

```text
campo2odoo/
├── src/
│   ├── app/                              # Next.js App Router
│   │   ├── (auth)/                        # Login (Auth.js / NextAuth v5)
│   │   ├── (main)/
│   │   │   ├── configuracion/page.tsx     # Pagina 1
│   │   │   ├── procesar/page.tsx          # Pagina 2
│   │   │   ├── revision/page.tsx          # Pagina 3
│   │   │   ├── excel/page.tsx             # Pagina 4
│   │   │   ├── importar-odoo/page.tsx     # Pagina 5
│   │   │   └── auditoria/page.tsx         # Pagina 6
│   │   ├── api/                           # Route Handlers
│   │   │   ├── upload/route.ts
│   │   │   ├── process/route.ts           # encola jobs
│   │   │   ├── jobs/[id]/route.ts         # estado/progreso
│   │   │   ├── excel/export/route.ts
│   │   │   ├── excel/import/route.ts
│   │   │   ├── odoo/test-connection/route.ts
│   │   │   ├── odoo/sync-masters/route.ts
│   │   │   ├── odoo/dry-run/route.ts
│   │   │   └── odoo/import/route.ts
│   │   ├── layout.tsx
│   │   └── page.tsx
│   │
│   ├── features/
│   │   ├── upload/                        # subida + hash + duplicados
│   │   ├── extraction/                    # pipeline PDF/OCR/LLM
│   │   │   ├── components/
│   │   │   ├── services/
│   │   │   │   ├── pdf-classifier.ts
│   │   │   │   ├── pdf-text-extractor.ts
│   │   │   │   ├── pdf-renderer.ts
│   │   │   │   ├── image-preprocessor.ts  # sharp
│   │   │   │   ├── ocr-engine.ts          # tesseract.js
│   │   │   │   ├── llm-extractor.ts       # AI SDK + Zod (opt-in)
│   │   │   │   ├── rule-extractor.ts      # regex/heuristicas
│   │   │   │   ├── normalizer.ts
│   │   │   │   └── result-merger.ts
│   │   │   └── types/
│   │   ├── validation/                    # validador contable
│   │   ├── mapping/                       # partner/tax/account matchers
│   │   │   └── services/
│   │   │       ├── partner-matcher.ts
│   │   │       ├── tax-mapper.ts
│   │   │       └── account-mapper.ts
│   │   ├── review/                        # tabla editable revision
│   │   ├── excel/                         # exporter/importer (ExcelJS)
│   │   ├── odoo/                          # cliente + importador
│   │   │   └── services/
│   │   │       ├── odoo-client.ts         # interfaz agnostica
│   │   │       ├── odoo-xmlrpc.ts
│   │   │       ├── odoo-jsonrpc.ts
│   │   │       ├── odoo-importer.ts
│   │   │       ├── attachment-service.ts
│   │   │       └── duplicate-checker.ts
│   │   └── audit/                         # consultas auditoria
│   │
│   ├── shared/
│   │   ├── components/                    # shadcn/ui + genericos
│   │   ├── hooks/
│   │   ├── stores/                        # Zustand
│   │   ├── lib/
│   │   │   ├── db/                        # Neon client + Drizzle (schema, queries)
│   │   │   ├── storage/                   # cliente S3/MinIO + URLs prefirmadas
│   │   │   ├── auth/                      # Auth.js (NextAuth v5) config
│   │   │   ├── queue/                     # BullMQ config
│   │   │   ├── logger.ts                  # pino
│   │   │   └── ai/                        # OpenRouter/AI SDK config
│   │   ├── schemas/                       # Zod (frontera de validacion)
│   │   │   ├── invoice.schema.ts
│   │   │   ├── invoice-line.schema.ts
│   │   │   ├── odoo.schema.ts
│   │   │   ├── validation.schema.ts
│   │   │   └── excel.schema.ts
│   │   ├── constants/                     # umbrales, regex, codigos
│   │   ├── errors/                        # clases de error de dominio
│   │   └── utils/
│   │
│   └── worker/                            # proceso worker (BullMQ)
│       ├── index.ts                       # entrypoint
│       ├── processors/
│       │   └── invoice.processor.ts
│       └── concurrency.ts
│
├── drizzle/
│   ├── migrations/                        # SQL versionado (drizzle-kit)
│   ├── schema.ts                          # esquema Drizzle (fuente de migraciones)
│   └── seed.ts
├── scripts/
│   ├── check-ocr.ts                       # valida traineddata/poppler
│   ├── sync-odoo-masters.ts
│   ├── create-custom-fields-odoo.ts
│   └── smoke-test-odoo.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── fixtures/                          # PDFs de prueba
│   └── e2e/                               # Playwright
├── public/
├── docker/
│   ├── Dockerfile                         # app
│   ├── Dockerfile.worker                  # worker
│   └── docker-compose.yml                 # app + worker + redis + minio (Neon es gestionado/externo)
├── .env.example
├── next.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

---

## 7. Configuración de entorno

### 7.1. Dependencias principales (npm)

```jsonc
// Núcleo
"next": "^16",
"react": "^19",
"typescript": "^5",
"zod": "^3",
"@neondatabase/serverless": "^0.10",
"drizzle-orm": "^0.36",
"drizzle-kit": "^0.28",
"pg": "^8",
"@aws-sdk/client-s3": "^3",
"@aws-sdk/s3-request-presigner": "^3",
"next-auth": "^5",
"@auth/drizzle-adapter": "^1",
"zustand": "^5",
"@tanstack/react-query": "^5",
"@tanstack/react-table": "^8",
"react-hook-form": "^7",
"@hookform/resolvers": "^3",
"tailwindcss": "^4",

// PDF / OCR / imagen
"unpdf": "^0",
"pdfjs-dist": "^4",
"pdf-to-img": "^4",
"tesseract.js": "^5",
"sharp": "^0.33",

// Excel
"exceljs": "^4",

// Odoo / red / utilidades
"xmlrpc": "^1",
"undici": "^6",
"p-retry": "^6",
"p-queue": "^8",
"fastest-levenshtein": "^1",
"fuse.js": "^7",
"date-fns": "^4",
"pino": "^9",

// Cola / jobs
"bullmq": "^5",
"ioredis": "^5",

// LLM (opt-in)
"ai": "^4",
"@openrouter/ai-sdk-provider": "^0",

// Dev / test
"vitest": "^2",
"@playwright/test": "^1",
"@vitejs/plugin-react": "^4"
```

> Versiones orientativas; fijar exactas en `package.json` y verificar disponibilidad antes de instalar (ver protocolo §35 / Pre-Development Validation de `CLAUDE.md`).

### 7.2. Dependencias del sistema (contenedor Docker)

La imagen base `node:22-bookworm-slim` + paquetes para render PDF robusto y `sharp`:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    libvips \
    fonts-liberation \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*
```

- **Tesseract NO se instala como binario**: se usa `tesseract.js` (WASM). Los `traineddata` `spa.traineddata` y `eng.traineddata` se copian a `public/tessdata/` (o se montan) para evitar descargas en runtime y permitir red restringida.
- `poppler-utils` da `pdftoppm` como render de respaldo robusto.

### 7.3. Variables de entorno

`.env.example`:

```bash
# App
APP_ENV=dev
APP_BASE_URL=http://localhost:3000

# Neon (Postgres serverless) — solo server/worker
DATABASE_URL=postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/campo2odoo?sslmode=require
DATABASE_URL_UNPOOLED=             # conexión directa (migraciones drizzle-kit)

# Auth.js (NextAuth v5)
AUTH_SECRET=                       # openssl rand -base64 32
AUTH_URL=http://localhost:3000

# Almacenamiento de PDFs (MinIO / S3) — solo server/worker
S3_ENDPOINT=http://localhost:9000  # MinIO local; vacío si AWS S3 real
S3_REGION=us-east-1
S3_BUCKET=campo2odoo-invoices
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=true           # true para MinIO

# Redis / cola
REDIS_URL=redis://localhost:6379

# Odoo
ODOO_URL=https://miempresa.odoo.com
ODOO_DB=miempresa
ODOO_USERNAME=usuario@empresa.com
ODOO_API_KEY=CAMBIAR
ODOO_TRANSPORT=jsonrpc             # jsonrpc | xmlrpc
ODOO_DEFAULT_COMPANY_ID=1
ODOO_DEFAULT_PURCHASE_JOURNAL_ID=1

# Politicas
ALLOW_AUTO_POST=false
ALLOW_CREATE_PARTNER=false
DUPLICATE_POLICY=strict            # strict | warn

# Extraccion
OCR_MODE=local                     # local | cloud | off
OCR_LANG=spa+eng
OCR_DPI=300
LLM_EXTRACTION_ENABLED=false       # opt-in (principio §2.5)
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=
LLM_MODEL=anthropic/claude-sonnet-4-6
LLM_ANONYMIZE=false

# Umbrales
MIN_OCR_CONFIDENCE=0.75
MIN_PARTNER_MATCH_SCORE=90
MAX_ROUNDING_DIFF=0.03
```

Reglas de seguridad:

- `DATABASE_URL`, `AUTH_SECRET`, `S3_SECRET_ACCESS_KEY`, `ODOO_API_KEY` y `OPENROUTER_API_KEY` **solo** en el servidor/worker (nunca con prefijo `NEXT_PUBLIC_`).
- No subir `.env` real. Los secretos en despliegue van por gestor de secretos / variables del orquestador.

---

## 8. Modelo de datos interno (Zod — sustituye a Pydantic)

La validación es la **única frontera** compartida cliente/servidor. Los `type` se infieren de los esquemas Zod (`z.infer`).

### 8.1. Factura extraída

```typescript
// shared/schemas/invoice.schema.ts
import { z } from "zod";
import { invoiceLineSchema } from "./invoice-line.schema";
import { validationMessageSchema } from "./validation.schema";

export const validationStatusSchema = z.enum([
  "OK",
  "WARNING",
  "ERROR",
  "REQUIRES_REVIEW",
]);

export const extractedInvoiceSchema = z.object({
  importUuid: z.string().uuid(),
  sourceFileName: z.string(),
  sourceFileHash: z.string().length(64), // SHA-256 hex
  documentType: z.enum(["vendor_bill", "vendor_refund", "unknown"]),

  supplierName: z.string().nullable(),
  supplierVat: z.string().nullable(),
  supplierAddress: z.string().nullable(),
  supplierIban: z.string().nullable(),

  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().date().nullable(),   // ISO YYYY-MM-DD
  dueDate: z.string().date().nullable(),

  currency: z.string().default("EUR"),
  untaxedAmount: z.string().nullable(),        // decimal como string (precisión)
  taxAmount: z.string().nullable(),
  totalAmount: z.string().nullable(),

  lines: z.array(invoiceLineSchema),

  rawText: z.string(),
  extractionConfidence: z.number().min(0).max(1),
  validationStatus: validationStatusSchema,
  validationMessages: z.array(validationMessageSchema),
});

export type ExtractedInvoice = z.infer<typeof extractedInvoiceSchema>;
```

> **Decimales:** se representan como `string` y se operan con una librería de decimales (`decimal.js` o `dinero.js`) para evitar errores de coma flotante en importes contables. **Nunca** usar `number` para bases/cuotas/totales en cálculos.

### 8.2. Línea de factura

```typescript
// shared/schemas/invoice-line.schema.ts
import { z } from "zod";
import { validationMessageSchema } from "./validation.schema";

export const invoiceLineSchema = z.object({
  lineUuid: z.string().uuid(),
  description: z.string(),
  quantity: z.string().default("1"),
  unitPrice: z.string().nullable(),
  discount: z.string().default("0"),
  subtotal: z.string().nullable(),
  taxRate: z.string().nullable(),

  suggestedProductId: z.number().int().nullable(),
  suggestedAccountId: z.number().int().nullable(),
  suggestedTaxIds: z.array(z.number().int()).default([]),
  analyticDistribution: z.record(z.string(), z.number()).nullable(),

  confidence: z.number().min(0).max(1),
  validationStatus: z.enum(["OK", "WARNING", "ERROR", "REQUIRES_REVIEW"]),
  validationMessages: z.array(validationMessageSchema),
});

export type ExtractedInvoiceLine = z.infer<typeof invoiceLineSchema>;
```

### 8.3. Resultado de importación a Odoo

```typescript
// shared/schemas/odoo.schema.ts
export const odooImportResultSchema = z.object({
  importUuid: z.string().uuid(),
  sourceFileHash: z.string().length(64),
  status: z.enum(["CREATED", "SKIPPED_DUPLICATE", "ERROR", "POSTED"]),
  odooMoveId: z.number().int().nullable(),
  odooMoveName: z.string().nullable(),
  odooDisplayUrl: z.string().url().nullable(),
  errorType: z.string().nullable(),
  errorMessage: z.string().nullable(),
  attempts: z.number().int(),
});

export type OdooImportResult = z.infer<typeof odooImportResultSchema>;
```

### 8.4. Mensaje de validación

```typescript
// shared/schemas/validation.schema.ts
export const validationMessageSchema = z.object({
  level: z.enum(["INFO", "WARNING", "ERROR"]),
  field: z.string().nullable(),
  code: z.string(),
  message: z.string(),
  suggestedAction: z.string().nullable(),
});
```

---

## 9. Hojas del Excel generado (ExcelJS)

Igual que el spec original: documento de trabajo y auditoría, no una simple tabla. Se generan con **ExcelJS**.

### 9.1. Hoja `01_FACTURAS`

Una fila por factura.

| Columna | Descripción | Obligatoria |
|---|---|---|
| `import_uuid` | Identificador interno | Sí |
| `source_file_name` | Nombre PDF | Sí |
| `source_file_hash` | SHA-256 | Sí |
| `document_type` | vendor_bill/vendor_refund | Sí |
| `supplier_name` | Nombre proveedor | Sí |
| `supplier_vat` | NIF/VAT proveedor | Recomendado |
| `odoo_partner_id` | ID proveedor en Odoo | Sí antes de importar |
| `invoice_number` | Número factura proveedor | Sí |
| `invoice_date` | Fecha factura | Sí |
| `due_date` | Vencimiento | No |
| `currency` | Moneda | Sí |
| `journal_id` | Diario de compras | Sí |
| `fiscal_position_id` | Posición fiscal | No |
| `untaxed_amount` | Base imponible total | Sí |
| `tax_amount` | Cuota total | Sí |
| `total_amount` | Total factura | Sí |
| `validation_status` | OK/WARNING/ERROR | Sí |
| `selected_for_import` | TRUE/FALSE | Sí |
| `odoo_move_id` | Resultado importación | No |
| `odoo_status` | CREATED/ERROR/etc. | No |
| `notes` | Observaciones | No |

### 9.2. Hoja `02_LINEAS`

Una fila por línea: `import_uuid`, `line_uuid`, `description`, `quantity`, `unit_price`, `discount`, `subtotal`, `tax_rate`, `odoo_product_id`, `odoo_account_id`, `odoo_tax_ids` (IDs separados por coma), `analytic_distribution` (JSON), `validation_status`, `validation_messages`.

### 9.3. Hoja `03_ERRORES`

`import_uuid`, `source_file_name`, `level`, `field`, `message`, `suggested_action`.

### 9.4. Hoja `04_MAESTROS_ODOO`

Datos descargados de Odoo: proveedores, cuentas de gasto, impuestos de compra activos, diarios de compra, monedas, productos, cuentas analíticas, posiciones fiscales.

### 9.5. Hoja `05_AUDITORIA`

Usuario, fecha de procesamiento, hash archivo, motor de extracción (native/ocr/llm/cloud), idioma OCR, tiempo de proceso, confianza media, intentos de importación, resultado.

### 9.6. Estilos Excel (ExcelJS)

- Cabecera en negrita (`font.bold`).
- Filtros: `worksheet.autoFilter`.
- Freeze panes: `worksheet.views = [{ state: "frozen", ySplit: 1 }]`.
- Ajuste de ancho de columnas.
- **Data validations** (listas) para `selected_for_import`, `document_type`, `validation_status` (`dataValidation` tipo `list`).
- Colores condicionales por celda (`fill`): verde OK, amarillo WARNING, rojo ERROR.
- Protección opcional de columnas técnicas (`protection.locked`), dejando editables las columnas de revisión.

---

## 10. Interfaz web (Next.js — sustituye a las páginas Streamlit)

Seis vistas en `app/(main)/`. Navegación por sidebar. Componentes shadcn/ui.

### 10.1. Página 1 — Configuración (`/configuracion`)
Probar conexión Odoo; sincronizar maestros; ver empresa activa, diario por defecto, impuestos, cuentas de gasto, proveedores; configurar modo OCR, idiomas, umbral de confianza, política de creación de proveedores, política de auto-post, política de duplicados, activar/desactivar LLM.

### 10.2. Página 2 — Procesar PDFs (`/procesar`)
Subida múltiple (drag&drop). Tabla de archivos: nombre, tamaño, hash, estado, tipo detectado, páginas, duplicado sí/no. Botón `Procesar` (encola jobs BullMQ). **Barra de progreso por archivo en tiempo real** (SSE vía `LISTEN/NOTIFY` o polling con TanStack Query). Log visible.

### 10.3. Página 3 — Revisión (`/revision`)
Panel izquierdo: lista de facturas con estado. Panel derecho: vista previa del PDF (visor embebido), texto extraído, cabecera editable, líneas editables (TanStack Table + inputs), errores/advertencias, totales recalculados en vivo. Marcar/desmarcar `selected_for_import`.

### 10.4. Página 4 — Exportar/Importar Excel (`/excel`)
Descargar Excel completo (Route Handler → `.xlsx`). Subir Excel revisado. Validar estructura (Zod sobre filas parseadas). Comparar datos anteriores vs revisados y mostrar diferencias (diff).

### 10.5. Página 5 — Importar a Odoo (`/importar-odoo`)
Validación final; **dry-run** (§27); importación real; resultado por factura; enlace a la factura creada (`/odoo/web#id=<id>&model=account.move&view_type=form`); exportar log final.

### 10.6. Página 6 — Auditoría (`/auditoria`)
Consultar importaciones anteriores; ver PDFs procesados; ver errores; reintentar fallidos; ver duplicados detectados; exportar auditoría.

---

## 11. Pipeline de extracción (worker)

Cada PDF se procesa como un **job BullMQ** en el worker. Pasos:

### 11.1. Paso 1 — Guardado seguro
1. Subir a MinIO/S3 (bucket `campo2odoo-invoices`) con clave `uploads/<fecha>/<uuid>_<filename>.pdf` (ruta interna basada en UUID, **no** en el nombre original → evita path traversal).
2. Calcular SHA-256 (Node `crypto`), tamaño, número de páginas.
3. Registrar en tabla `processed_files`.

### 11.2. Paso 2 — Clasificación
- Abrir con `unpdf`/`pdfjs-dist`, extraer texto de primeras páginas.
- Texto suficiente → `native`; texto insuficiente o imágenes con texto residual bajo → `scanned`; PDF cifrado → error `PDF_PASSWORD_PROTECTED`.

```typescript
export const MIN_TEXT_CHARS_PER_PAGE = 50;
export const MIN_TOTAL_TEXT_CHARS = 150;
```

### 11.3. Paso 3 — Extracción nativa
`unpdf`/`pdfjs-dist` para texto general. Para tablas/coordenadas, analizar `textContent.items` (posiciones x/y) de pdf.js y reconstruir filas de líneas de factura.

### 11.4. Paso 4 — OCR (escaneados)
1. Render de cada página a imagen (`pdf-to-img` o `pdftoppm`) con DPI configurable.
2. Preprocesado con **sharp**: escala de grises, normalización de contraste, threshold adaptativo, upscale/resize, deskew básico.
3. OCR con **Tesseract.js** (`spa+eng`), guardando texto y `confidence` por página/bloque.
4. Guardar texto OCR por página y (opcional) imagen preprocesada para depuración.

```typescript
export const OCR_DPI = 300;
export const OCR_LANG = "spa+eng";
// Tesseract.js: parametros equivalentes a --psm via setParameters
// tessedit_pageseg_mode: probar PSM.SINGLE_BLOCK(6), AUTO(3), SPARSE_TEXT(11)
```

### 11.5. Paso 5 — Normalización
- Importes españoles: `1.234,56` → `1234.56`; detectar formato anglosajón si procede.
- Fechas: `dd/mm/yyyy`, `dd-mm-yyyy`, `dd.mm.yyyy`, `yyyy-mm-dd` → ISO (date-fns/Luxon).
- Limpieza OCR: `O`→`0` y `l`→`1` en NIF/importes cuando sea evidente; espacios duplicados.
- NIF/VAT: quitar espacios/guiones, mayúsculas, prefijo `ES` opcional.

---

## 12. Extracción estructurada (híbrida)

Enfoque híbrido **determinista primero**, LLM como refuerzo opt-in.

### 12.1. Extractor por reglas (base, siempre activo)
Regex y heurísticas para: NIF/CIF/VAT, nombre proveedor, número de factura, fecha, base imponible, IVA, total, IBAN, vencimiento. Determinista, testeable, rápido, sin dependencias externas.

### 12.2. Extractor con LLM estructurado (opt-in, `LLM_EXTRACTION_ENABLED=true`)

Cuando las reglas no bastan **y** el usuario lo ha habilitado. Implementación con **Vercel AI SDK** `generateObject` + esquema Zod (salida garantizada y validada) sobre **OpenRouter**:

```typescript
import { generateObject } from "ai";
import { extractedInvoiceLlmSchema } from "@/shared/schemas/invoice.schema";

const { object } = await generateObject({
  model: openrouter(process.env.LLM_MODEL!),
  schema: extractedInvoiceLlmSchema, // subconjunto sin campos internos
  system: INVOICE_EXTRACTION_SYSTEM_PROMPT,
  prompt: anonymizeIfEnabled(ocrText),
});
```

- Modo **texto** (envía el texto OCR) o modo **vision** (envía la imagen de la página) según configuración.
- El LLM **nunca** decide la cuenta contable definitiva si no hay regla; solo **sugiere** con motivo y confianza.
- Aviso explícito en UI cuando el LLM está activo; opción de anonimización (enmascarar NIF/IBAN antes de enviar).

**System prompt base** (idéntico en intención al original):

```text
Eres un extractor contable. Recibiras texto OCR (o imagen) de una factura de
proveedor española. Devuelve exclusivamente datos conformes al esquema.
Reglas:
- No inventes datos. Si un dato no aparece claramente, usa null.
- Si solo hay una linea global de factura, crea una linea con la descripcion
  mas representativa.
- Respeta importes con decimales.
- Distingue base imponible, cuota de IVA y total.
- No confundas numero de pedido, albaran o presupuesto con numero de factura.
- document_type: vendor_bill | vendor_refund | unknown.
```

### 12.3. Combinación de resultados (`result-merger.ts`)
1. Aplicar reglas. 2. Aplicar LLM si hay campos vacíos/baja confianza **y** está habilitado. 3. Fusionar: coincidencia reglas+LLM → ↑confianza; discrepancia → WARNING; total no cuadra → ERROR. 4. Validar con Zod (`safeParse`); errores de esquema → `REQUIRES_REVIEW`.

---

## 13. Validaciones

### 13.1. Críticas (bloquean importación)
Falta proveedor/`partner_id`; falta nº factura; falta fecha; falta total; falta cuenta en alguna línea; falta impuesto donde sea necesario; suma de líneas ≠ base imponible; base + impuestos ≠ total; ya existe factura equivalente en Odoo; PDF ya importado; archivo ilegible; moneda inexistente en Odoo; diario inexistente o de otra compañía.

### 13.2. Advertencia (permiten importar, se muestran)
Baja confianza OCR; proveedor por similitud (no por NIF); vencimiento ausente; IBAN ausente; línea global creada por falta de detalle; descuento no confirmado; impuesto inferido por porcentaje; cuenta inferida por regla genérica; diferencia de redondeo ≤ umbral.

### 13.3. Umbrales (configurables)

```typescript
export const MAX_ROUNDING_DIFF = "0.03";   // decimal.js
export const MIN_OCR_CONFIDENCE = 0.75;
export const MIN_PARTNER_MATCH_SCORE = 90;
export const MIN_TEXT_EXTRACTION_CHARS = 150;
```

Cálculos contables con **decimal.js** (no `number`).

---

## 14. Mapeo de proveedores

### 14.1. Búsqueda principal (`partner-matcher.ts`)
1. `res.partner` por `vat`. 2. Por nombre exacto normalizado. 3. Por IBAN (`res.partner.bank`) si disponible. 4. Por similitud con **Fuse.js / fastest-levenshtein** (score ≥ `MIN_PARTNER_MATCH_SCORE`). 5. Sin coincidencia → crear solo si `ALLOW_CREATE_PARTNER=true`; si no, `REQUIRES_REVIEW`.

Campos en Odoo: `vat`, `name`, `commercial_partner_id`, `supplier_rank`, datos bancarios si se sincroniza `res.partner.bank`.

### 14.2. Creación de proveedor
No automática en MVP salvo autorización expresa. Si se permite: `name`, `vat`, `supplier_rank=1`, `company_type="company"`, dirección si confianza suficiente.

---

## 15. Mapeo de impuestos

### 15.1. Sincronización (`account.tax`)
Campos: `id`, `name`, `amount`, `amount_type`, `type_tax_use`, `active`, `company_id`, `tax_scope`, `description`, `price_include`. Filtrar `type_tax_use in ("purchase","none")`, `active=true`, compañía correcta. Se cachea en tabla `odoo_masters` (Neon) con TTL.

### 15.2. Reglas de asignación
1. ID explícito (Excel/revisión). 2. Regla por proveedor. 3. Por cuenta. 4. Por porcentaje detectado. 5. Por posición fiscal. 6. Manual. Porcentajes habituales: 21/10/4/0 %, exento/no sujeto, retenciones según localización. **No crear impuestos desde la app**; deben existir en Odoo.

---

## 16. Mapeo de cuentas contables

### 16.1. Sincronización (`account.account`)
Campos: `id`, `code`, `name`, `account_type`, `deprecated`, `company_ids`/`company_id`, `tax_ids`. Filtrar no obsoletas y tipos de gasto (`expense`, `expense_direct_cost`, `expense_depreciation`, otros por config).

### 16.2. Fuentes de asignación (orden)
1. `odoo_account_id` revisado. 2. Producto Odoo. 3. Cuenta por defecto del producto/categoría. 4. Regla proveedor + palabra clave. 5. Regla proveedor. 6. Regla por palabra clave. 7. Cuenta genérica de revisión. 8. Error si no hay cuenta.

### 16.3. Tabla de reglas (Postgres `account_mapping_rules`)
`rule_id`, `supplier_vat`, `supplier_name_pattern`, `description_pattern`, `tax_rate`, `account_id`, `product_id`, `analytic_distribution` (JSONB), `priority`, `active`.

---

## 17. Posición fiscal y analítica

### 17.1. Posición fiscal
Usar la del proveedor si existe; si no, sugerir por país/VAT y permitir selección manual; no aplicar sin reglas claras. Respetar las reglas de localización de Odoo (no duplicarlas).

### 17.2. Distribución analítica
Sincronizar `account.analytic.account`. Configurar modelos por proveedor/cuenta/palabra clave. Guardar `analytic_distribution` como JSON Odoo, p. ej. `{"12": 100.0}` (ID de cuenta analítica → porcentaje).

---

## 18. Integración con Odoo 18 (cliente Node)

### 18.1. Interfaz `OdooClient` (agnóstica de transporte)

```typescript
export interface OdooClient {
  authenticate(): Promise<number>;                 // devuelve uid
  executeKw<T>(model: string, method: string,
    args?: unknown[], kwargs?: Record<string, unknown>): Promise<T>;
  searchRead<T>(model: string, domain: unknown[],
    fields: string[], opts?: { limit?: number; offset?: number }): Promise<T[]>;
  create(model: string, vals: Record<string, unknown>): Promise<number>;
  callMethod<T>(model: string, method: string, ids: number[]): Promise<T>;
}
```

Dos adaptadores: `odoo-jsonrpc.ts` (recomendado, sobre `fetch`/`undici` contra `/jsonrpc`) y `odoo-xmlrpc.ts` (librería `xmlrpc`). Selección por `ODOO_TRANSPORT`.

JSON-RPC (esquema de llamada):

```jsonc
POST /jsonrpc
{
  "jsonrpc": "2.0", "method": "call",
  "params": {
    "service": "object", "method": "execute_kw",
    "args": [db, uid, apiKey, model, method, args, kwargs]
  }, "id": 1
}
```

### 18.2. Modelos implicados
`account.move`, `account.move.line`, `res.partner`, `account.tax`, `account.account`, `account.journal`, `res.currency`, `ir.attachment`, `product.product`, `account.fiscal.position`, `account.analytic.account`.

### 18.3. Creación de factura de proveedor

```typescript
const vals = {
  move_type: "in_invoice",
  partner_id: partnerId,
  invoice_date: "2026-06-04",
  date: "2026-06-04",
  invoice_date_due: "2026-07-04",
  ref: "FRA-2026-001",
  journal_id: purchaseJournalId,
  currency_id: currencyId,
  invoice_line_ids: [
    [0, 0, {
      name: "Descripción línea",
      quantity: 1.0,
      price_unit: 100.0,
      discount: 0.0,
      account_id: expenseAccountId,
      // product_id solo si existe; si no, omitir o false
      tax_ids: [[6, 0, [taxId]]],
      // analytic_distribution solo si hay analitica
      analytic_distribution: { "12": 100.0 },
    }],
  ],
};
const moveId = await odoo.create("account.move", vals);
```

Notas: comandos Odoo `(0,0,{...})` y `(6,0,[...])` se envían como **arrays** desde JS. Si no hay producto, omitir `product_id`. Si no hay analítica, omitir `analytic_distribution`. Rectificativa → `move_type: "in_refund"`.

### 18.4. Recalcular impuestos
Tras crear, releer `amount_untaxed`, `amount_tax`, `amount_total`, `invoice_line_ids`, `state`, `payment_state` y comparar con lo esperado (decimal.js, tolerancia `MAX_ROUNDING_DIFF`).

### 18.5. Adjuntar PDF original

```typescript
await odoo.create("ir.attachment", {
  name: originalFilename,
  type: "binary",
  datas: base64Pdf,              // Buffer.toString("base64")
  res_model: "account.move",
  res_id: moveId,
  mimetype: "application/pdf",
});
```

### 18.6. Publicar/confirmar (por defecto NO)
Solo si `ALLOW_AUTO_POST=true`, validaciones críticas OK, usuario marcó `post_after_import`, sin bloqueo de fecha, diario/secuencia/totales correctos:

```typescript
await odoo.callMethod("account.move", "action_post", [moveId]);
```

### 18.7. URL de acceso
`{ODOO_URL}/web#id={moveId}&model=account.move&view_type=form`.

---

## 19. Control de duplicados

### 19.1. Local (Postgres)
Buscar por `source_file_hash`, `import_uuid`, y `invoice_number + supplier_vat + total_amount`.

### 19.2. Odoo (`duplicate-checker.ts`)
Antes de crear, `search_read` en `account.move`:

```typescript
const domain = [
  ["move_type", "in", ["in_invoice", "in_refund"]],
  ["partner_id", "=", partnerId],
  ["ref", "=", invoiceNumber],
  ["company_id", "=", companyId],
  ["state", "!=", "cancel"],
];
```

Si hay coincidencias, comparar `invoice_date`/`amount_total`. Coincidencia nº + proveedor → duplicado aunque el importe difiera ligeramente. Política según `DUPLICATE_POLICY` (`strict` bloquea, `warn` avisa).

---

## 20. Errores y reintentos

### 20.1. Clases de error de dominio (`shared/errors`)

```typescript
export class AppError extends Error {}
export class PdfReadError extends AppError {}
export class OcrError extends AppError {}
export class ExtractionError extends AppError {}
export class InvoiceValidationError extends AppError {}
export class OdooConnectionError extends AppError {}
export class OdooAuthenticationError extends AppError {}
export class OdooPermissionError extends AppError {}
export class OdooValidationError extends AppError {}
export class DuplicateInvoiceError extends AppError {}
```

### 20.2. No reintentables
PDF corrupto/protegido; falta proveedor/cuenta/impuesto; duplicado; validación contable fallida; permiso denegado; error funcional de Odoo por datos.

### 20.3. Reintentables (con `p-retry`, backoff exponencial)
Timeout de red; error HTTP temporal; reinicio de Odoo; `ProtocolError` temporal; `ECONNRESET`; `ETIMEDOUT`.

```typescript
import pRetry from "p-retry";

await pRetry(() => odoo.create("account.move", vals), {
  retries: 3,
  minTimeout: 2000,
  maxTimeout: 30000,
  factor: 2,
  shouldRetry: (e) => isTransient(e),
});
```

BullMQ además aporta reintentos a nivel de job (`attempts`, `backoff`) — usar ambos niveles con criterio (transitorios de red en `p-retry`; fallo de job completo en BullMQ).

### 20.4. Registro de intentos (tabla `import_attempts`)
Nº intento, fecha/hora, método Odoo, modelo, `import_uuid`, mensaje de error, resultado.

---

## 21. Auditoría y trazabilidad (Neon Postgres + Drizzle)

Esquema definido en `drizzle/schema.ts`; migraciones generadas con `drizzle-kit` en `drizzle/migrations/`. Autorización a nivel de aplicación (sesión Auth.js + consultas con filtro por usuario/organización); RLS de Postgres opcional como defensa en profundidad. El worker accede con conexión de servicio (sin contexto de usuario).

### `processed_files`
`id`, `source_file_name`, `storage_path`, `source_file_hash` (unique), `upload_datetime`, `processed_datetime`, `pdf_type`, `page_count`, `extraction_engine`, `ocr_confidence`, `status`.

### `invoice_imports`
`import_uuid` (pk), `source_file_hash`, `supplier_vat`, `supplier_name`, `invoice_number`, `invoice_date`, `total_amount`, `validation_status`, `selected_for_import`, `odoo_move_id`, `odoo_status`, `created_at`, `updated_at`.

### `import_attempts`
`id`, `import_uuid`, `attempt_number`, `operation`, `status`, `error_type`, `error_message`, `timestamp`.

### `account_mapping_rules`
Ver §16.3.

### `odoo_masters`
Caché de maestros sincronizados (`model`, `record_id`, `payload` JSONB, `synced_at`, `company_id`).

### `jobs`
Espejo del estado de cola (`job_id`, `import_uuid`, `status`, `progress`, `error`, `updated_at`) para alimentar la UI vía SSE (`LISTEN/NOTIFY`) o polling. Un trigger Postgres emite `NOTIFY` en cada `UPDATE` para empujar el progreso por SSE.

---

## 22. Seguridad

1. API keys/secretos **solo** en servidor/worker; nunca en bundle cliente (`NEXT_PUBLIC_*` solo para lo público).
2. Variables de entorno / gestor de secretos; nada en el repo.
3. No mostrar contraseñas/API keys en UI ni logs (pino con redacción de campos sensibles).
4. PDFs en MinIO/S3 con bucket **privado** (sin ACL pública) y acceso solo mediante URLs prefirmadas de corta duración.
5. Limpieza/retención configurable de temporales.
6. Auth de la app con **Auth.js (NextAuth v5)**; registrar autor de cada proceso.
7. Multiusuario: autorización por sesión + filtro por usuario/organización en todas las consultas (Drizzle); RLS de Postgres opcional; aislamiento de objetos S3 por prefijo de usuario/organización.
8. Acceso de red a Odoo restringido (allowlist / red interna en Docker).
9. **No enviar facturas a IA externa sin `LLM_EXTRACTION_ENABLED=true`** (principio §2.5); aviso + anonimización + desactivable.
10. Validar en subida: tamaño máximo, extensión y **MIME real** (no solo extensión); rechazar no-PDF.
11. Rutas internas por UUID → evitar path traversal.
12. Logs sin datos excesivamente sensibles cuando sea posible.
13. Cabeceras de seguridad (CSP, etc.) en `next.config.ts`.

---

## 23. Estrategia de pruebas

### 23.1. Unitarias (Vitest)
Normalización de importes; de fechas; detección NIF/VAT (incl. dígito de control español); clasificación PDF; extracción por reglas; validación de totales (decimal.js); mapeo de impuestos; de cuentas; detección de duplicados; generación Excel; lectura Excel; construcción del payload Odoo.

### 23.2. Integración (mocks de Odoo)
Mock del transporte (interceptar `fetch` JSON-RPC con MSW, o stub del adaptador): autenticación OK/KO; búsqueda proveedor; creación `account.move`; adjuntar PDF; error de permisos; reintento ante timeout; duplicado Odoo.

### 23.3. End-to-end (Playwright)
Con base Odoo de pruebas: subir PDF nativo y escaneado; revisar; exportar Excel; reimportar; crear borrador; comprobar proveedor, líneas, cuenta, impuesto, totales, PDF adjunto y no duplicación al repetir. Playwright también cubre el flujo de UI (las 6 páginas).

### 23.4. Fixtures (`tests/fixtures/`)
Factura simple 1 línea; varias líneas; IVA 21/10 %; varios IVA; sin detalle; escaneada baja calidad; duplicada; rectificativa; PDF corrupto; PDF protegido; PDF con varias facturas.

---

## 24. Criterios de aceptación

1. Subir ≥20 PDFs en lote (cola BullMQ con progreso).
2. Procesar PDFs nativos y escaneados.
3. Generar Excel con cabecera, líneas, errores y auditoría.
4. Corregir datos desde la UI web.
5. Reimportar Excel revisado.
6. Validar proveedores, cuentas, impuestos y totales.
7. Detectar duplicados locales y en Odoo.
8. Crear facturas de proveedor en borrador en Odoo 18.
9. Adjuntar el PDF original a cada factura.
10. No crear facturas con errores críticos.
11. Registrar logs e intentos.
12. Reintentar fallos transitorios sin duplicar.
13. Pruebas unitarias e integración automatizadas (Vitest) + e2e (Playwright).
14. Documentar instalación (Docker), configuración y uso.

---

## 25. Flujo detallado de usuario

### 25.1. Preparación
Configura conexión Odoo → `Probar conexión` → la app autentica y muestra usuario, compañías, diarios, impuestos, cuentas → sincroniza maestros → configura reglas contables iniciales.

### 25.2. Procesamiento
Sube PDFs → hash + duplicados → clasificación → texto/OCR → extracción de campos → sugerencias (proveedor, cuenta, impuesto, analítica) → validación de totales → estado.

### 25.3. Revisión
Revisa cabecera y líneas → corrige proveedor/cuenta/impuesto → marca para importar → (opcional) descarga Excel.

### 25.4. Importación
Validación final → dry-run → informe de importables → `Crear borradores en Odoo` → crea facturas → adjunta PDFs → relee totales → enlaces a Odoo → guarda auditoría.

---

## 26. Recomendaciones específicas Odoo 18 Enterprise

1. Usuario técnico específico para la integración.
2. Permisos mínimos: lectura de proveedores/cuentas/impuestos/diarios/productos; creación de facturas proveedor y adjuntos; sin administración.
3. Usar API key.
4. Diario de compras específico o existente.
5. Campos personalizados opcionales: `x_import_uuid`, `x_source_file_hash`, `x_import_source = "campo2odoo"`.
6. No confirmar facturas automáticamente en producción al inicio.
7. Probar primero en base de pruebas/duplicado.
8. Revisar localización española: IVA, retenciones, intracomunitario, posiciones fiscales, PGC.
9. No forzar creación contra PO en MVP; sugerir coincidencias.
10. Respetar configuración contable existente del proveedor.

---

## 27. Modo dry-run

Simulación que **no crea nada en Odoo**: comprueba conexión, existencia de proveedor, impuestos, cuentas, duplicados; construye el payload; devuelve el resultado previsto. Debe ejecutarse antes de la importación real (botón dedicado en página 5).

---

## 28. Gestión de estados

**Por archivo:** `UPLOADED`, `DUPLICATE_LOCAL`, `PDF_CLASSIFIED`, `TEXT_EXTRACTED`, `OCR_DONE`, `EXTRACTED`, `VALIDATED_OK`, `VALIDATED_WITH_WARNINGS`, `VALIDATION_ERROR`, `READY_FOR_IMPORT`, `IMPORTING`, `IMPORTED`, `IMPORT_ERROR`, `SKIPPED`.

**Por factura:** `DRAFT_LOCAL`, `REQUIRES_REVIEW`, `READY`, `CREATED_IN_ODOO`, `POSTED_IN_ODOO`, `ERROR`, `DUPLICATE`.

Modelados como enums Zod + columnas Postgres; transiciones gestionadas por el worker y reflejadas vía Realtime.

---

## 29. Reglas de calidad de OCR

Indicadores en UI: páginas con bajo texto; confianza media; campos críticos no detectados; posibles errores OCR (NIF ilegible, nº ambiguo, total dudoso). Sugerencias: re-escanear, aumentar DPI, revisar manualmente, probar preprocesado alternativo (sharp) o activar OCR cloud/LLM (opt-in).

---

## 30. PDFs con varias facturas

**MVP:** detectar indicios (varias ocurrencias de "Factura nº", varios NIF, reinicio de numeración) → marcar advertencia y pedir revisión; no dividir automáticamente. **Fase 2:** dividir por páginas, previsualización, guardar cada factura como documento independiente.

---

## 31. Rectificativas y abonos

Detectar: `factura rectificativa`, `abono`, `rectificación`, importes negativos, referencia a factura anterior → `document_type = vendor_refund`, Odoo `move_type = "in_refund"`, revisión obligatoria en MVP.

---

## 32. Importación desde Excel revisado

Leer hojas obligatorias → validar columnas y tipos con Zod → validar `import_uuid` → comparar con datos originales (diff) → validación final → permitir importación. Si faltan hojas/columnas, error claro. Parseo con ExcelJS (lectura) + Zod (validación de cada fila).

---

## 33. Logs (pino, JSON estructurado)

```jsonc
{
  "timestamp": "2026-06-04T10:00:00.000Z",
  "level": "info",
  "event": "odoo_invoice_created",
  "importUuid": "...",
  "sourceFileHash": "...",
  "odooMoveId": 123,
  "elapsedMs": 850
}
```

Niveles: `debug`, `info`, `warn`, `error`, `fatal`. Redacción automática de campos sensibles (`apiKey`, `datas`, `password`). Logs de app y worker correlacionados por `importUuid`/`jobId`.

---

## 34. Mensajes de error orientados a usuario

- `No se ha podido leer el PDF. Puede estar corrupto o protegido con contraseña.`
- `No se ha encontrado proveedor en Odoo para el NIF ESXXXXXXXXX. Revise el proveedor o permita su creación.`
- `La suma de líneas no coincide con la base imponible. Diferencia: 1,24 €.`
- `La factura parece duplicada: ya existe en Odoo una del mismo proveedor con la misma referencia.`
- `No hay cuenta contable asignada en la línea 3. Seleccione una cuenta antes de importar.`
- `Error temporal de conexión con Odoo. Se ha reintentado 3 veces sin éxito.`

---

## 35. Implementación incremental recomendada

### Sprint 1 — Base técnica
Estructura Next.js + Feature-First; Docker (`app` + `worker` + `redis` + `minio`); Neon + Drizzle (esquema y migraciones); Auth.js (login); cliente S3/MinIO; logging pino; subida de PDFs; cálculo de hash; guardado en MinIO/S3; registro `processed_files`.

### Sprint 2 — Lectura PDF/OCR
Clasificador (unpdf/pdfjs); extractor nativo; render (pdf-to-img/poppler); preprocesado sharp; OCR Tesseract.js; métricas OCR; worker BullMQ + progreso Realtime; tests.

### Sprint 3 — Extracción contable
Normalizador; extractor por reglas; esquemas Zod; extractor LLM opt-in (AI SDK + OpenRouter); fusión de resultados; validaciones básicas (decimal.js).

### Sprint 4 — Odoo maestros
`OdooClient` (JSON-RPC + XML-RPC); autenticación; descarga de proveedores/impuestos/cuentas/diarios; caché `odoo_masters`; tests con mocks (MSW).

### Sprint 5 — Mapeo y revisión
Partner/tax/account matchers; editor web (TanStack Table); estados y mensajes; reglas de mapeo (`account_mapping_rules`).

### Sprint 6 — Excel
Exportar (ExcelJS, estilos, validaciones, freeze, filtros); importar Excel revisado; comparar cambios (diff).

### Sprint 7 — Importación Odoo
Dry-run; detección de duplicados Odoo; crear factura borrador; adjuntar PDF; releer resultado; logs/auditoría; reintentos (p-retry + BullMQ).

### Sprint 8 — End-to-end
Pruebas con facturas reales anonimizadas; ajuste de reglas OCR/contables; prueba de lote; documentación de usuario; checklist de producción; e2e Playwright.

---

## 36. Checklist antes de producción

- [ ] Usuario técnico Odoo creado.
- [ ] API key creada y guardada como secreto.
- [ ] Base de pruebas validada.
- [ ] Diarios de compra identificados.
- [ ] Impuestos de compra sincronizados.
- [ ] Cuentas de gasto sincronizadas.
- [ ] Reglas contables iniciales cargadas.
- [ ] PDFs de prueba procesados.
- [ ] Duplicados probados.
- [ ] Adjuntos PDF comprobados.
- [ ] Logs revisados.
- [ ] Backups de Odoo disponibles.
- [ ] Auto-post desactivado inicialmente.
- [ ] Imagen Docker con `traineddata` y `poppler` verificada.
- [ ] Redis y worker operativos; cola con métricas.
- [ ] Proyecto Neon creado; `DATABASE_URL` (pooled) y `DATABASE_URL_UNPOOLED` configuradas; migraciones Drizzle aplicadas.
- [ ] Bucket MinIO/S3 privado creado; credenciales solo en servidor/worker.
- [ ] Auth.js configurado (`AUTH_SECRET`); autorización por usuario/organización verificada.
- [ ] LLM desactivado por defecto (o autorizado explícitamente).
- [ ] Manual de usuario preparado.

---

## 37. Decisiones pendientes configurables

URL/DB Odoo; transporte (JSON-RPC/XML-RPC); compañía por defecto; diario por defecto; política de creación de proveedores; política de auto-post; cuentas por defecto por tipo de gasto; reglas por proveedor; tratamiento de retenciones; uso o no de LLM (y proveedor/modelo); uso o no del OCR nativo de Odoo; OCR local vs cloud; retención de PDFs y logs; concurrencia del worker.

---

## 38. Referencias técnicas

**Odoo 18**
- External API: https://www.odoo.com/documentation/18.0/developer/reference/external_api.html
- Extract API: https://www.odoo.com/documentation/18.0/developer/reference/extract_api.html
- Document Digitization: https://www.odoo.com/documentation/18.0/applications/finance/accounting/vendor_bills/invoice_digitization.html
- Vendor Bill Sequence: https://www.odoo.com/documentation/18.0/applications/finance/accounting/vendor_bills/sequence.html
- Analytic Accounting: https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/analytic_accounting.html
- Fiscal Positions: https://www.odoo.com/documentation/18.0/applications/finance/accounting/taxes/fiscal_positions.html
- `account.tax`: https://www.odoo.com/documentation/18.0/developer/reference/standard_modules/account/account_tax.html
- `account.account`: https://www.odoo.com/documentation/18.0/developer/reference/standard_modules/account/account_account.html

**Stack Next.js**
- Next.js: https://nextjs.org/docs
- Neon (Postgres serverless): https://neon.tech/docs
- Drizzle ORM: https://orm.drizzle.team/docs/overview
- Auth.js (NextAuth v5): https://authjs.dev
- MinIO (S3 self-hosted): https://min.io/docs/minio/linux/index.html
- AWS SDK v3 S3 (presigned URLs): https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/
- Zod: https://zod.dev
- TanStack Query: https://tanstack.com/query / Table: https://tanstack.com/table
- Zustand: https://zustand.docs.pmnd.rs
- Vercel AI SDK (`generateObject`): https://sdk.vercel.ai/docs
- OpenRouter: https://openrouter.ai/docs
- ExcelJS: https://github.com/exceljs/exceljs
- BullMQ: https://docs.bullmq.io
- Tesseract.js: https://github.com/naptha/tesseract.js
- unpdf: https://github.com/unjs/unpdf
- pdf.js: https://mozilla.github.io/pdf.js/
- sharp: https://sharp.pixelplumbing.com
- p-retry: https://github.com/sindresorhus/p-retry
- Playwright: https://playwright.dev
- Vitest: https://vitest.dev

---

## 39. Instrucción final para la IA codificadora

Construir la aplicación siguiendo esta especificación con stack **Next.js 16 + TypeScript + Neon (Postgres/Drizzle) + MinIO/S3 + Auth.js + Docker**.

Prioridades (inalteradas respecto a la v1):

1. Fiabilidad contable.
2. No duplicar facturas.
3. No contabilizar automáticamente por defecto.
4. Trazabilidad completa.
5. Validaciones antes de Odoo.
6. Código modular y testeable (Feature-First, archivos ≤500 líneas, funciones ≤50 líneas).
7. Configuración por secretos (env / gestor de secretos).
8. Soporte para revisión humana.
9. Registro del PDF original como adjunto.
10. Pruebas unitarias e integración (Vitest) + e2e (Playwright).

Restricciones absolutas:

- No simplificar el modelo eliminando validaciones críticas.
- No crear facturas en Odoo si hay errores críticos.
- No inventar cuentas contables, impuestos ni proveedores.
- **No enviar datos a IA externa sin configuración explícita** (`LLM_EXTRACTION_ENABLED=true`).
- Decimales contables con `decimal.js`, nunca `number`.
- Secretos del servidor jamás en el bundle cliente.
