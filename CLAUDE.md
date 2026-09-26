# Proyecto: Campo2Odoo

## 🎯 Principios de Desarrollo (Context Engineering)

### Design Philosophy
- **KISS**: Keep It Simple, Stupid - Prefiere soluciones simples
- **YAGNI**: You Aren't Gonna Need It - Implementa solo lo necesario  
- **DRY**: Don't Repeat Yourself - Evita duplicación de código
- **SOLID**: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion

### Descripción del Proyecto
Campo2Odoo lee facturas de proveedor en PDF, extrae sus datos y las crea como facturas de proveedor en **borrador** (`move_type: "in_invoice"`) en Odoo. El usuario revisa y corrige los datos en una tabla antes de importar; también hay importación/exportación Excel con una plantilla propia.

## 🏗️ Tech Stack & Architecture

### Core Stack
- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript
- **Estilos**: Tailwind CSS v4 (postcss); clases compartidas en el objeto `cx` de `src/shared/styles.ts`, sin `@apply`
- **Validación**: Zod (`src/shared/schemas/`)
- **Extracción PDF**: pdf-parse (texto nativo) y Azure Document Intelligence (prebuilt-invoice)
- **Odoo**: JSON-RPC con `fetch` nativo, versiones 15 y 18 (`src/shared/lib/odoo/`)
- **Sin base de datos ni autenticación**: la configuración se guarda en `localStorage` y se pre-rellena desde `.env.local` vía `/api/config`
- **Despliegue**: Vercel

### Architecture: Feature-First
```
src/
├── app/                 # Página única (page.tsx) + Route Handlers en app/api/{config,extract,excel,odoo}
├── features/            # UI por funcionalidad: config/, invoices/
└── shared/
    ├── lib/             # excel/, extraction/ (nativa, Azure DI, splitter), odoo/ (cliente, importer, masters, partner-match)
    ├── schemas/         # Esquemas Zod
    ├── types/
    └── styles.ts        # Objeto cx con las clases Tailwind compartidas
```
Lo nuevo va en la feature a la que pertenece; lo que usan varias features, en `shared/`.

## 🛠️ Comandos

- `npm run dev` - Servidor de desarrollo
- `npm run build` - Build de producción
- `npm run typecheck` - Verificación de tipos
- `npm run lint` está roto: usa `next lint`, que Next.js 16 eliminó, y ESLint no está instalado.

## 📝 Convenciones de Código

### File & Function Limits
- **Archivos**: Máximo 500 líneas
- **Funciones**: Máximo 50 líneas
- **Componentes**: Una responsabilidad clara

### Naming Conventions
- **Variables/Functions**: `camelCase`
- **Components**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Files**: `kebab-case.extension`
- **Folders**: `kebab-case`

### TypeScript Guidelines
- **Siempre usar type hints** para function signatures
- **Interfaces** para object shapes
- **Types** para unions y primitives
- **Evitar `any`** - usar `unknown` si es necesario

### Component Patterns
```typescript
// ✅ GOOD: Proper component structure
interface Props {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  onClick: () => void;
}

export function Button({ children, variant = 'primary', onClick }: Props) {
  return (
    <button 
      onClick={onClick}
      className={`btn btn-${variant}`}
    >
      {children}
    </button>
  );
}
```

## Tests

Todavía no hay framework de tests instalado. Si añades tests, propón primero la herramienta (p. ej. Vitest) en vez de asumir Jest. Mientras tanto, la verificación mínima es `npm run typecheck` + `npm run build`.

## Git

Rama principal: `master`. Mensajes en Conventional Commits (`feat(odoo): ...`, `fix(extract): ...`).

## Restricciones

- Sin `any` en TypeScript (usa `unknown`).
- Nada de secretos en el código ni en variables `NEXT_PUBLIC_*`: las claves de Odoo y Azure solo viven en el servidor o en la config local del usuario.
- No registres en logs datos de facturas ni credenciales.

## Referencias

- Especificación original (parcialmente superada por el stack real): `especificacion_nextjs_facturas_odoo18.md`

## Verificar antes de asumir

Comprueba en la documentación o en `node_modules` que la versión de una API o librería existe y se comporta como crees antes de usarla. Tras crear o cambiar un endpoint, pruébalo.

## Manejo de errores

Las llamadas externas (Odoo JSON-RPC, Azure Document Intelligence) deben llevar timeout y, si fallan, devolver un error visible al usuario. Nunca sustituyas un fallo por datos simulados: esta app crea facturas contables, y un valor inventado que llega a Odoo es peor que un error.

## Servidor de desarrollo

`npm run dev` ejecuta `next dev` (puerto 3000 por defecto; Next elige otro si está ocupado). El entorno es Windows: usa `netstat -ano | findstr :3000` y `taskkill /PID <pid> /F` para liberar un puerto.

## Verificación visual

Hay MCPs de Playwright y Chrome DevTools configurados. Tras un cambio de UI, abre la página y comprueba el resultado en el navegador antes de dar la tarea por terminada.

---

*Este archivo es la fuente de verdad para desarrollo en este proyecto. Todas las decisiones de código deben alinearse con estos principios.*