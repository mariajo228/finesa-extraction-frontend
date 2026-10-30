import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, extractionApi } from '../api';
import type { ExtractionRequest, JobResult, ProcessingMode, UiPhase } from '../types/extraction';
import { config } from '../utils/config';

/** Fallos de consulta consecutivos que se toleran antes de dar el proceso por fallido. */
const MAX_POLL_FAILURES = 3;

/** Errores pasajeros (red, timeout, 5xx): vale la pena reintentar la consulta. */
const isTransient = (err: unknown): boolean =>
  err instanceof ApiError &&
  (err.kind === 'network' || err.kind === 'timeout' || (err.kind === 'http' && (err.status ?? 0) >= 500));

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new ApiError('La operación fue cancelada.', 'aborted'));
      },
      { once: true },
    );
  });

/**
 * Orquesta todo el flujo de extracción y expone una máquina de estados simple:
 * idle -> submitting -> (polling) -> success | error
 */
export function useExtraction() {
  const [phase, setPhase] = useState<UiPhase>({ name: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const lastRequestRef = useRef<{ input: ExtractionRequest; mode: ProcessingMode } | null>(null);

  // Cancela cualquier petición o polling pendiente si el componente se desmonta.
  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setPhase({ name: 'idle' });
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setPhase({ name: 'idle' });
  }, []);

  const run = useCallback(async (input: ExtractionRequest, mode: ProcessingMode) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastRequestRef.current = { input, mode };
    const { signal } = controller;

    setPhase({ name: 'submitting', mode });

    try {
      if (mode === 'sync') {
        // Síncrono: una sola petición; la UI muestra el loader hasta recibir el JSON.
        const data = await extractionApi.extractSync(input, signal);
        setPhase({ name: 'success', data, mode });
        return;
      }

      // Asíncrono, paso 1: enviar el documento y obtener el correlationId (202 Accepted).
      const { correlationId } = await extractionApi.extractAsync(input, signal);

      // Paso 2: polling cada 3-5 s hasta COMPLETED / FAILED / timeout.
      const startedAt = Date.now();
      let attempt = 0;
      let failures = 0;

      for (;;) {
        attempt += 1;
        const elapsedMs = Date.now() - startedAt;
        setPhase({ name: 'polling', correlationId, attempt, elapsedMs });

        // Un fallo pasajero de red no debe tumbar todo el proceso: se reintenta en el siguiente ciclo.
        let result: JobResult | null = null;
        try {
          result = await extractionApi.getResult(correlationId, signal);
          failures = 0;
            } catch (err) {
          // El backend responde 404 mientras el resultado aún no existe: equivale a PENDING.
          if (err instanceof ApiError && err.kind === 'http' && err.status === 404) {
            failures = 0;
          } else {
            failures += 1;
            if (!isTransient(err) || failures >= MAX_POLL_FAILURES) throw err;
          }
        }

        if (result?.status === 'COMPLETED' && result.payload) {
          setPhase({ name: 'success', data: result.payload, mode });
          return;
        }
        if (result?.status === 'FAILED') {
          setPhase({
            name: 'error',
            message: result.error ?? 'El servicio no pudo procesar el documento.',
            canRetry: true,
          });
          return;
        }

        if (Date.now() - startedAt + config.pollIntervalMs > config.pollTimeoutMs) {
          setPhase({
            name: 'error',
            message: 'El procesamiento está tardando más de lo esperado. Inténtalo de nuevo más tarde.',
            canRetry: true,
          });
          return;
        }
        await sleep(config.pollIntervalMs, signal);
      }
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'aborted') return; // cancelación voluntaria
      const message = err instanceof ApiError ? err.message : 'Ocurrió un error inesperado.';
      setPhase({ name: 'error', message, canRetry: true });
    }
  }, []);

  const retry = useCallback(() => {
    const last = lastRequestRef.current;
    if (last) void run(last.input, last.mode);
  }, [run]);

  return { phase, run, retry, cancel, reset };
}
