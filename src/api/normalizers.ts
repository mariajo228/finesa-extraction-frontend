import type { AsyncTicket, JobResult, JobStatus, JsonObject, JsonValue } from '../types/extraction';
import { ApiError } from './httpClient';

const isObject = (v: unknown): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * El enunciado menciona el identificador como "ticket_id" (respuesta 202) y como
 * "correlationId" (ruta de consulta). Se aceptan ambas variantes para ser tolerante
 * con el backend real.
 */
export function normalizeTicket(raw: unknown): AsyncTicket {
  if (!isObject(raw)) {
    throw new ApiError('Respuesta inesperada al iniciar el procesamiento asíncrono.', 'parse');
  }
  const id = raw.ticket_id ?? raw.ticketId ?? raw.correlationId ?? raw.correlation_id ?? raw.id;
  if (typeof id !== 'string' && typeof id !== 'number') {
    throw new ApiError('El servidor no devolvió un identificador de seguimiento (ticket_id).', 'parse');
  }
  return {
    correlationId: String(id),
    status: typeof raw.status === 'string' ? raw.status : 'procesando',
  };
}

const STATUS_MAP: Record<string, JobStatus> = {
  PENDING: 'PENDING',
  PROCESSING: 'PENDING',
  PROCESANDO: 'PENDING',
  IN_PROGRESS: 'PENDING',
  COMPLETED: 'COMPLETED',
  DONE: 'COMPLETED',
  SUCCESS: 'COMPLETED',
  FAILED: 'FAILED',
  ERROR: 'FAILED',
};

/** Normaliza la respuesta de GET /api/extraction/results/{correlationId}. */
export function normalizeResult(raw: unknown): JobResult {
  if (!isObject(raw)) {
    throw new ApiError('Respuesta inesperada al consultar el estado.', 'parse');
  }
  const rawStatus = String(raw.status ?? '').toUpperCase();
  const status = STATUS_MAP[rawStatus];
  if (!status) {
    throw new ApiError(`Estado de procesamiento desconocido: "${raw.status}".`, 'parse');
  }

  if (status === 'COMPLETED') {
    const payload = raw.payload ?? raw.data ?? raw.result ?? raw.extracted_data;
    if (!isObject(payload)) {
      throw new ApiError('El procesamiento terminó pero no incluye datos extraídos.', 'parse');
    }
    return { status, payload };
  }

  if (status === 'FAILED') {
    const message = raw.error ?? raw.message ?? raw.detail;
    return { status, error: typeof message === 'string' ? message : undefined };
  }

  return { status };
}

/** La respuesta síncrona puede venir envuelta ({ data: {...} }) o directa ({...}). */
export function normalizeSyncPayload(raw: unknown): JsonObject {
  if (!isObject(raw)) {
    throw new ApiError('La respuesta síncrona no contiene un objeto JSON.', 'parse');
  }
  const inner: JsonValue | undefined = raw.payload ?? raw.data ?? raw.result;
  return isObject(inner) ? inner : raw;
}
