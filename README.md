# Extracción de documentos PDF — Prueba Técnica Frontend

Aplicación web (React + TypeScript + Vite) para cargar un PDF, enviarlo a un servicio REST de extracción
(modalidad **síncrona** o **asíncrona con polling**) y mostrar el JSON resultante en una interfaz
estructurada (tarjetas, listas de descripción y tablas dinámicas), sin mostrar nunca el JSON crudo.

## Requisitos

- Node.js 18 o superior (probado con Node 22)
- npm 9 o superior

## Instalación y ejecución local

```bash
npm install
cp .env.example .env     # opcional: el modo por defecto es "local"
npm run dev              # http://localhost:5173
```

Otros scripts:

```bash
npm run build            # typecheck + build de producción en /dist
npm run preview          # sirve el build localmente
npm run typecheck        # solo verificación de tipos
```

## Modos de API

Se controla con `VITE_API_MODE` en `.env`:

| Valor  | Comportamiento |
|--------|----------------|
| `local` | (por defecto) **Lee el PDF en el navegador** y extrae la información real (pólizas de automóviles). No requiere backend. Mantiene el mismo flujo: formulario, spinner, polling y resultados. |
| `real` | Llama al backend REST. En desarrollo usa el proxy de Vite (`/api/...` → `VITE_API_PROXY_TARGET`) para evitar CORS. |

Para usar el backend real:

```bash
# .env
VITE_API_MODE=real
VITE_API_PROXY_TARGET=https://finesa-front-demo-1063009710641.us-east4.run.app
```

> En producción (Vercel/Netlify) el proxy de Vite no existe. Hay dos opciones: que el backend habilite CORS
> y poner `VITE_API_BASE_URL=https://...`, o configurar un *rewrite* `/api/*` hacia el backend
> (ver `vercel.json` / `public/_redirects`).

### Extracción local de pólizas

En modo `local` el PDF **no sale del navegador**. Se lee con `pdfjs-dist`, que entrega cada fragmento de
texto con su posición (x, y); con esa posición se reconstruyen los pares "Etiqueta: valor" y las tablas
(coberturas, intermediarios, primas). Está probado con la carátula "Certificado del seguro de Automóviles
Individual Livianos Particulares" (Allianz). Además compara el número de identificación escrito en el
formulario con el del tomador/asegurado de la póliza.

Limitaciones: requiere un PDF con texto seleccionable (un escaneo necesitaría OCR) y el parser conoce el
formato de la carátula de automóviles; para otros formatos devuelve los pares "Etiqueta: valor" que
encuentre, y si no hay ninguno informa que no reconoce el documento.

En modo asíncrono se simulan 6 s de "cola" (`QUEUE_SIMULATION_MS`) para que el polling sea visible.

## Estructura

```
src/
├── api/            Capa de acceso al servicio REST
│   ├── httpClient.ts      fetch + timeout + cancelación + errores tipados (ApiError)
│   ├── extractionApi.ts   contrato (interfaz) + implementación real + FormData
│   ├── normalizers.ts     adapta/valida las respuestas del backend
│   └── index.ts           elige real o local según VITE_API_MODE
├── extractors/     Lectura real del PDF: readPdf.ts (pdf.js) + polizaAuto.ts (parser)
├── local/          localExtractionApi: implementa el contrato usando el extractor
├── hooks/
│   ├── useExtraction.ts   máquina de estados + polling
│   └── useToasts.tsx      notificaciones
├── components/     UploadForm, ProcessingStatus, ResultsView, ErrorPanel
├── utils/          config, validation, format
├── types/          tipos del dominio
└── styles/app.css
docs/EXPLICACION.md Explicación detallada de las APIs y de cómo se aplican
```

## Cumplimiento del enunciado

- **Formulario**: tipo de documento, número de identificación y PDF, con validación en tiempo real.
- **Validación de archivo en cliente**: MIME `application/pdf`, extensión `.pdf`, tamaño máximo (10 MB) y firma binaria `%PDF-`.
- **Subida**: `FormData` (`file`, `doc_type`, `doc_id`).
- **Síncrono**: overlay bloqueante con spinner hasta recibir el JSON.
- **Asíncrono**: recibe `ticket_id`/`correlationId`, muestra "en proceso" con línea de tiempo y tiempo transcurrido, y hace polling cada 4 s (configurable entre 3 y 5 s), con timeout, cancelación y tolerancia a hasta 3 fallos de red consecutivos.
- **Resultados**: tarjetas, listas de descripción y tablas dinámicas (ordenables por columna y con filtro); nunca JSON crudo. Incluye un botón para descargar el resultado como archivo `.json`.
- **Errores**: toasts + panel de error con reintento; manejo de red, timeout, HTTP y respuestas inválidas.

## Organización de resultados (cualquier PDF)

`src/utils/organize.ts` recibe cualquier JSON y lo reparte en bloques, sin depender del tipo de documento:
desenvuelve contenedores (`{ data: {...} }`), crea una tarjeta por cada objeto anidado, una tabla por cada
arreglo de objetos, tarjetas de persona para los objetos con nombre, y agrupa los campos sueltos por tema
(identificación, fechas, valores, contacto…). Las carátulas de póliza conservan su diseño específico.

## Interfaz

- Stepper de progreso (Datos → Procesamiento → Resultados), tema claro/oscuro con interruptor (recuerda la preferencia) y tipografía Inter.
- Iconos SVG propios, foco visible con teclado, atributos ARIA y diseño responsive.

## Despliegue

Compatible con Vercel, Netlify o GitHub Pages: `npm run build` y publicar `dist/`.
