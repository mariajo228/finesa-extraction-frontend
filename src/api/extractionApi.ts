import { ENDPOINTS } from '../utils/config';
import type { AsyncTicket, ExtractionRequest, JobResult, JsonObject } from '../types/extraction';
import { request } from './httpClient';
import { normalizeResult, normalizeSyncPayload, normalizeTicket } from './normalizers';

/**
 * Contrato del servicio de extracción. Hay dos implementaciones:
 *  - realExtractionApi: habla con el backend REST
 *  - localExtractionApi: lectura del PDF en el navegador (src/local)
 * La UI solo conoce esta interfaz (inversión de dependencias).
 */
export interface ExtractionApi {
  extractSync(input: ExtractionRequest, signal?: AbortSignal): Promise<JsonObject>;
  extractAsync(input: ExtractionRequest, signal?: AbortSignal): Promise<AsyncTicket>;
  getResult(correlationId: string, signal?: AbortSignal): Promise<JobResult>;
}

/**
 * Los archivos binarios se envían con FormData (multipart/form-data).
 * IMPORTANTE: no se fija el header Content-Type a mano; el navegador lo genera
 * con el "boundary" correcto.
 * Los nombres de campo son los del contrato: file, doc_type, doc_id.
 */
export function buildFormData({ file, docType, docId }: ExtractionRequest): FormData {
  const form = new FormData();
  form.append('files', file, file.name);
  form.append('doc_type', docType);
  form.append('doc_id', docId.trim());
  return form;
}

export const realExtractionApi: ExtractionApi = {
  /** POST /api/extraction/trigger/sync  ->  200 OK con el JSON extraído. */
  async extractSync(input, signal) {
    const { data } = await request<unknown>(ENDPOINTS.sync, {
      method: 'POST',
      body: buildFormData(input),
      signal,
      timeoutMs: 120_000, // la síncrona puede tardar más: se espera la respuesta completa
    });
    return normalizeSyncPayload(data);
  },

  /** POST /api/extraction/trigger/pubsub  ->  202 Accepted con ticket_id. */
  async extractAsync(input, signal) {
    const { data } = await request<unknown>(ENDPOINTS.pubsub, {
      method: 'POST',
      body: buildFormData(input),
      signal,
    });
    return normalizeTicket(data);
  },

  /** GET /api/extraction/results/{correlationId}  ->  PENDING | COMPLETED | FAILED. */
  async getResult(correlationId, signal) {
    const { data } = await request<unknown>(ENDPOINTS.results(correlationId), {
      method: 'GET',
      signal,
      timeoutMs: 20_000,
    });
    return normalizeResult(data);
  },
};
