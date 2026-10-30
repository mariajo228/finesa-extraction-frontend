import { ApiError } from '../api/httpClient';
import type { ExtractionRequest, JsonObject } from '../types/extraction';
import { parseGenericPairs, parsePolizaAuto } from './polizaAuto';
import { readPdfItems } from './readPdf';

/**
 * Extracción real del contenido del PDF, en el navegador:
 *   PDF -> fragmentos de texto con posición -> parser de póliza -> JSON
 */
export async function extractPolicy({ file, docType, docId }: ExtractionRequest): Promise<JsonObject> {
  const { items, pages } = await readPdfItems(file);
  const ctx = { fileName: file.name, pages, docType, docId };

  const policy = parsePolizaAuto(items, ctx);
  if (policy) return policy;

  const generic = parseGenericPairs(items, ctx);
  if (generic) return generic;

  throw new ApiError(
    'No se reconoció el formato del documento. Por ahora se soportan carátulas de póliza de automóviles con texto seleccionable.',
    'parse',
  );
}
