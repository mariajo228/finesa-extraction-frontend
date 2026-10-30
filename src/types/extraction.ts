/** Tipos de documento aceptados por el formulario. */
export const DOC_TYPES = [
  { value: 'CC', label: 'Cédula de Ciudadanía (CC)' },
  { value: 'CE', label: 'Cédula de Extranjería (CE)' },
  { value: 'NI', label: 'NIT (NI)' },
] as const;

export type DocType = (typeof DOC_TYPES)[number]['value'];

/** Modalidad de procesamiento elegida por el usuario. */
export type ProcessingMode = 'sync' | 'async';

/** Datos que recoge el formulario y se envían como multipart/form-data. */
export interface ExtractionRequest {
  file: File;
  docType: DocType;
  docId: string;
}

/** JSON arbitrario devuelto por el backend (la forma exacta no está fijada por el contrato). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** Estados del procesamiento asíncrono según el contrato. */
export type JobStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

/** Respuesta 202 de POST /api/extraction/trigger/pubsub. */
export interface AsyncTicket {
  /** Identificador para consultar el estado (el contrato lo llama ticket_id / correlationId). */
  correlationId: string;
  /** Estado inicial, normalmente "procesando". */
  status: string;
}

/** Respuesta normalizada de GET /api/extraction/results/{correlationId}. */
export interface JobResult {
  status: JobStatus;
  payload?: JsonObject;
  error?: string;
}

/** Máquina de estados de la interfaz. */
export type UiPhase =
  | { name: 'idle' }
  | { name: 'submitting'; mode: ProcessingMode }
  | { name: 'polling'; correlationId: string; attempt: number; elapsedMs: number }
  | { name: 'success'; data: JsonObject; mode: ProcessingMode }
  | { name: 'error'; message: string; canRetry: boolean };
