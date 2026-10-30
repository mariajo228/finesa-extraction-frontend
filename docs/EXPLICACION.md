# Explicación del proyecto y de las APIs

## 1. ¿Qué hace la aplicación?

El usuario escoge un **tipo de documento** (CC, CE, NI), escribe su **número de identificación** y adjunta un
**PDF**. La app envía esos tres datos a un servicio REST que extrae información del documento y devuelve un
JSON. La app muestra ese JSON en tarjetas y tablas. El servicio puede usarse de dos formas:

- **Síncrona**: se envía el PDF y la misma petición devuelve el resultado.
- **Asíncrona**: se envía el PDF, el servidor responde de inmediato con un identificador y el cliente
  consulta periódicamente hasta que el resultado esté listo.

## 2. El contrato de la API (sección 4 del enunciado)

Base: `https://finesa-front-demo-1063009710641.us-east4.run.app/`

| # | Endpoint | Método | Modalidad | Entrada | Respuesta |
|---|----------|--------|-----------|---------|-----------|
| 1 | `/api/extraction/trigger/sync` | POST | Síncrona | `file`, `doc_type`, `doc_id` | **200 OK** con el JSON extraído |
| 2 | `/api/extraction/trigger/pubsub` | POST | Asíncrona | `file`, `doc_type`, `doc_id` | **202 Accepted** con `ticket_id` y estado "procesando" |
| 3 | `/api/extraction/results/{correlationId}` | GET | Consulta de estado | el id en la URL | `PENDING`, `COMPLETED` (con `payload`) o `FAILED` |

Los endpoints 1 y 2 reciben un `multipart/form-data`, no JSON, porque llevan un archivo binario.

## 3. Cómo se aplica cada endpoint en el proyecto

### 3.1 Envío del archivo: `FormData` (`src/api/extractionApi.ts`)

```ts
export function buildFormData({ file, docType, docId }) {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('doc_type', docType);
  form.append('doc_id', docId.trim());
  return form;
}
```

Los nombres de campo son exactamente los del contrato. **No se escribe el header `Content-Type`**: el navegador
lo genera solo con el `boundary` que necesita el multipart; si se pusiera a mano, el servidor no podría leer el archivo.

### 3.2 Endpoint 1 — Síncrono (`POST /trigger/sync`)

```ts
async extractSync(input, signal) {
  const { data } = await request(ENDPOINTS.sync, {
    method: 'POST', body: buildFormData(input), signal, timeoutMs: 120_000,
  });
  return normalizeSyncPayload(data);
}
```

Flujo en la interfaz (`useExtraction.ts`, rama `mode === 'sync'`):

1. El estado pasa a `submitting` y se muestra un **overlay bloqueante con spinner** (`ProcessingStatus`).
2. La app hace **una sola petición** y espera (con `await`) hasta que llega el 200.
3. Con la respuesta, el estado pasa a `success` y se muestra `ResultsView`.
4. Si falla (red, timeout, 4xx/5xx), el estado pasa a `error`.

El timeout es mayor (120 s) porque esta modalidad mantiene la conexión abierta mientras el servidor procesa.

### 3.3 Endpoint 2 — Asíncrono, iniciar (`POST /trigger/pubsub`)

```ts
async extractAsync(input, signal) {
  const { data } = await request(ENDPOINTS.pubsub, {
    method: 'POST', body: buildFormData(input), signal,
  });
  return normalizeTicket(data);   // -> { correlationId, status }
}
```

El servidor responde **202 Accepted**: "recibí tu archivo, lo estoy procesando". El cuerpo trae un `ticket_id`.
Ese valor es el **`correlationId`** del enunciado (el documento usa ambos nombres para el mismo concepto), por eso
`normalizeTicket` acepta `ticket_id`, `ticketId`, `correlationId`, `correlation_id` o `id`.

### 3.4 Endpoint 3 — Asíncrono, consultar (`GET /results/{correlationId}`)

```ts
async getResult(correlationId, signal) {
  const { data } = await request(ENDPOINTS.results(correlationId), { method: 'GET', signal, timeoutMs: 20_000 });
  return normalizeResult(data);   // -> { status, payload? , error? }
}
```

Este endpoint se llama **repetidamente** (polling). Se usa `encodeURIComponent` en el id para que sea seguro dentro de la URL.

### 3.5 El polling (`src/hooks/useExtraction.ts`)

```
POST pubsub ──► 202 + correlationId
      │
      ▼
 ┌─► GET results/{id}
 │        │
 │   PENDING ──► esperar 4 s ──┐
 └───────────────────────────────┘
          COMPLETED ──► mostrar resultados
          FAILED    ──► mostrar error
          (pasó el tiempo máximo) ──► error de timeout
```

Detalles importantes:

- **Intervalo**: 4 s por defecto; `config.ts` lo limita al rango **3 000–5 000 ms** que pide el enunciado.
- **Mientras tanto** el usuario ve "Tu archivo está en proceso", el `correlationId`, el estado `PENDING` y el número de consultas.
- **Timeout global** (120 s por defecto): si nunca llega `COMPLETED`, se corta el ciclo y se informa, para no consultar eternamente.
- **Cancelación**: un `AbortController` cancela la petición en curso y el temporizador si el usuario pulsa "Cancelar" o el componente se desmonta. Así no quedan consultas "huérfanas".
- Se usa `async/await` con un bucle y `sleep` cancelable, en lugar de `setInterval`, para que **nunca se solapen dos consultas**.

## 4. Capas del código (separación de responsabilidades)

| Capa | Archivo | Responsabilidad |
|------|---------|-----------------|
| Transporte | `api/httpClient.ts` | `fetch`, URL base, timeout, cancelación y errores tipados (`ApiError`: network, timeout, http, parse, aborted) con mensajes amigables |
| Contrato | `api/extractionApi.ts` | Interfaz `ExtractionApi` + implementación real de los 3 endpoints |
| Adaptación | `api/normalizers.ts` | Valida y normaliza las respuestas (tolera `ticket_id`/`correlationId`, `payload`/`data`/`result`, estados equivalentes) |
| Extracción local | `local/localExtractionApi.ts` + `extractors/` | Misma interfaz, pero lee el PDF en el navegador |
| Selección | `api/index.ts` | Elige real o local con `VITE_API_MODE` |
| Lógica | `hooks/useExtraction.ts` | Máquina de estados y polling |
| Vista | `components/*` | Formulario, estado de proceso, resultados, error |

La UI depende de la **interfaz** `ExtractionApi`, no de una implementación concreta. Por eso cambiar de extracción local a backend real
no toca ningún componente.

## 5. Estados de la interfaz

```
idle ─► submitting ─┬─(sync)──────────────────► success
                    └─(async)─► polling ─┬────► success
                                         └────► error
        error ─► reintentar (repite la última petición) / volver al formulario
```

## 6. Validaciones en el cliente

- **Tipo de documento**: obligatorio y dentro de la lista.
- **Número de identificación**: solo dígitos (NI admite guion con dígito de verificación); se valida en cada pulsación.
- **Archivo** (`utils/validation.ts`): `file.type === 'application/pdf'`, extensión `.pdf`, no vacío, ≤ 10 MB,
  y además se leen los primeros 5 bytes para comprobar la firma `%PDF-` (así se rechaza un archivo renombrado a `.pdf`).
- El botón "Extraer información" solo se habilita si todo es válido.

## 7. Visualización de resultados (`components/ResultsView.tsx`)

Como el esquema del JSON no está definido en el enunciado, el renderizado es **dinámico** y nunca usa `JSON.stringify`:

| Forma del dato | Cómo se muestra |
|----------------|-----------------|
| Objeto con valores simples | Tarjeta con lista de descripción (etiqueta / valor) |
| Arreglo de objetos | Tabla dinámica (las columnas salen de las claves) |
| Arreglo de textos | Chips |
| Objeto anidado | Sub-sección dentro de la tarjeta |

Además se humanizan las claves (`fecha_nacimiento` → "Fecha nacimiento"), las fechas ISO se formatean en español,
los booleanos se muestran como "Sí/No" y los montos con separador de miles.

## 8. Manejo de errores

| Situación | Resultado para el usuario |
|-----------|---------------------------|
| Sin conexión | "No se pudo conectar con el servidor…" |
| Timeout | "El servidor tardó demasiado en responder." |
| HTTP 400/422, 404, 413, 429, 5xx | Mensaje específico por código |
| Respuesta que no es JSON válido | "La respuesta del servidor no tiene un formato JSON válido." |
| Estado `FAILED` en polling | Mensaje del servidor o uno genérico |
| Polling sin terminar a tiempo | Mensaje de espera excedida |

Cada error aparece como **toast** y como **panel** con botón *Reintentar*.

## 9. Supuestos y puntos a verificar con el backend real

El enunciado define el contrato solo de forma "teórica", por lo que algunos detalles se resolvieron de forma tolerante:

1. El nombre del campo con los datos en `COMPLETED` se acepta como `payload`, `data`, `result` o `extracted_data`.
2. El identificador se acepta como `ticket_id` o `correlationId`.
3. CORS: si el backend no lo habilita, en desarrollo se usa el proxy de Vite y en producción un *rewrite*
   (`vercel.json` / `public/_redirects`).
4. El modo local sirve para desarrollar y grabar el video sin depender del servidor, y extrae información real del PDF.

Si el backend real usa otros nombres, solo hay que ajustar `api/normalizers.ts`.

## 10. Extracción real del PDF (modo local)

El modo `mock` anterior devolvía datos fijos. Ahora `local` lee el PDF de verdad:

1. `extractors/readPdf.ts` abre el PDF con `pdfjs-dist` y obtiene cada fragmento de texto con su posición (x, y).
   Si no hay texto (PDF escaneado) lanza un error claro.
2. `extractors/polizaAuto.ts` (función pura) agrupa los fragmentos en líneas por coordenada Y, corta el documento en
   secciones por sus títulos ("Datos del Vehículo", "Coberturas", "Liquidación de Primas"…) y dentro de cada una:
   - empareja `Etiqueta:` con el valor que está a su derecha en la misma línea (vehículo, antecedentes);
   - agrupa bloques verticales y los asigna a su etiqueta (tomador, asegurado, beneficiario);
   - lee tablas por columnas usando la posición X (coberturas: amparo / valor asegurado / deducible);
   - usa expresiones regulares para póliza, vigencia, fecha de expedición y recibo.
3. Los montos en formato colombiano (`84.231.000,00`) se convierten a número; las fechas a ISO.
4. Se agrega `verificacion`: compara el documento escrito en el formulario con el del tomador/asegurado.
5. `local/localExtractionApi.ts` expone todo con la misma interfaz que el backend (sync, pubsub, results).

El resultado pasa por el mismo `ResultsView`, que lo muestra en tarjetas y tablas con etiquetas en español
(`FIELD_LABELS` en `utils/format.ts`).

Con el backend real (`VITE_API_MODE=real`) la extracción la hace el servidor y esta parte no se usa.
