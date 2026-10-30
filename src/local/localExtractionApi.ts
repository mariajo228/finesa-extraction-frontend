import type { ExtractionApi } from '../api/extractionApi';
import { ApiError } from '../api/httpClient';
import type { ExtractionRequest } from '../types/extraction';
import type { AsyncTicket, JobResult, JsonObject } from '../types/extraction';

/**
 * Implementación "local" del contrato: en vez de llamar a un servidor, LEE el PDF en el navegador
 * y devuelve el JSON real extraído. Respeta la misma interfaz que el backend, así que la UI
 * (formulario, spinner, polling, resultados) funciona exactamente igual.
 *
 *  - sync    -> extrae y devuelve el JSON.
 *  - pubsub  -> devuelve un ticket de inmediato y extrae en segundo plano.
 *  - results -> PENDING hasta que termine la extracción y haya pasado el tiempo de cola simulado.
 *
 * El "tiempo de cola" (QUEUE_SIMULATION_MS) es artificial: la lectura local tarda menos de un
 * segundo, pero se espera un poco para que el polling se pueda ver y demostrar en el video.
 */

const QUEUE_SIMULATION_MS = 6000;

interface Job {
  readyAt: number;
  result?: JsonObject;
  error?: string;
}

const jobs = new Map<string, Job>();

/** Carga perezosa: la librería de PDF (pesada) solo se descarga cuando se necesita. */
const extractPolicy = async (input: ExtractionRequest): Promise<JsonObject> => {
  const { extractPolicy: run } = await import('../extractors');
  return run(input);
};

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new ApiError('La operación fue cancelada.', 'aborted'));
      },
      { once: true },
    );
  });

export const localExtractionApi: ExtractionApi = {
  async extractSync(input, signal) {
    const result = await extractPolicy(input);
    if (signal?.aborted) throw new ApiError('La operación fue cancelada.', 'aborted');
    return result;
  },

  async extractAsync(input, signal): Promise<AsyncTicket> {
    await sleep(300, signal);
    const id = newId();
    const job: Job = { readyAt: Date.now() + QUEUE_SIMULATION_MS };
    jobs.set(id, job);

    extractPolicy(input)
      .then((result) => {
        job.result = result;
      })
      .catch((err: unknown) => {
        job.error = err instanceof Error ? err.message : 'No se pudo procesar el documento.';
      });

    return { correlationId: id, status: 'procesando' };
  },

  async getResult(correlationId, signal): Promise<JobResult> {
    await sleep(150, signal);
    const job = jobs.get(correlationId);
    if (!job) {
      throw new ApiError('El recurso solicitado no existe (¿el identificador es correcto?).', 'http', 404);
    }
    const finished = job.result !== undefined || job.error !== undefined;
    if (!finished || Date.now() < job.readyAt) return { status: 'PENDING' };
    if (job.error) return { status: 'FAILED', error: job.error };
    return { status: 'COMPLETED', payload: job.result };
  },
};
