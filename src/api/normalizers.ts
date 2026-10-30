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

/**
 * Busca el contenido útil de la respuesta. El backend real entrega el detalle
 * estructurado en "detalle"; si no existe, se usan las otras variantes conocidas.
 */
function pickPayload(raw: JsonObject): JsonObject | undefined {
  const candidate: JsonValue | undefined =
    raw.detalle ?? raw.payload ?? raw.data ?? raw.result ?? raw.extracted_data;
  return isObject(candidate) ? candidate : undefined;
}

/** Normaliza la respuesta de GET /api/extraction/results/{correlationId}. */
export function normalizeResult(raw: unknown): JobResult {
  if (!isObject(raw)) {
    throw new ApiError('Respuesta inesperada al consultar el estado.', 'parse');
  }
  const status = STATUS_MAP[String(raw.status ?? '').toUpperCase()];
  const payload = pickPayload(raw);

  if (status === 'FAILED') {
    const message = raw.error ?? raw.message ?? raw.detail;
    return { status, error: typeof message === 'string' ? message : undefined };
  }

  // El backend real responde 200 con un "status" numérico (p. ej. 101) cuando ya hay datos:
  // si no es un estado conocido pero trae contenido extraído, se considera completado.
  if (status === 'COMPLETED' || (!status && payload)) {
    if (!payload) {
      throw new ApiError('El procesamiento terminó pero no incluye datos extraídos.', 'parse');
    }
    return { status: 'COMPLETED', payload };
  }

  if (status === 'PENDING') return { status };

  throw new ApiError(`Estado de procesamiento desconocido: "${raw.status}".`, 'parse');
}

/** La respuesta síncrona puede venir envuelta ({ detalle, data... }) o directa ({...}). */
export function normalizeSyncPayload(raw: unknown): JsonObject {
  if (!isObject(raw)) {
    throw new ApiError('La respuesta síncrona no contiene un objeto JSON.', 'parse');
  }
  return pickPayload(raw) ?? raw;
}