/** Configuración centralizada, leída de variables de entorno de Vite (VITE_*). */

const toNumber = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  /** "local" = lee el PDF en el navegador (cualquier otro valor), "real" = backend REST. */
  apiMode: (import.meta.env.VITE_API_MODE === 'real' ? 'real' : 'local') as 'local' | 'real',
  /** Vacío => rutas relativas ("/api/...") que usan el proxy de Vite en desarrollo. */
  apiBaseUrl: ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/+$/, ''),
  /** El enunciado pide polling cada 3 a 5 segundos. Se fuerza al rango [3000, 5000]. */
  pollIntervalMs: Math.min(
    5000,
    Math.max(3000, toNumber(import.meta.env.VITE_POLL_INTERVAL_MS as string | undefined, 4000)),
  ),
  pollTimeoutMs: toNumber(import.meta.env.VITE_POLL_TIMEOUT_MS as string | undefined, 120_000),
  maxFileBytes:
    toNumber(import.meta.env.VITE_MAX_FILE_MB as string | undefined, 10) * 1024 * 1024,
  /** Tiempo máximo de una petición HTTP individual. */
  requestTimeoutMs: 60_000,
} as const;

export const ENDPOINTS = {
  sync: '/api/extraction/trigger/sync',
  pubsub: '/api/extraction/trigger/pubsub',
  results: (correlationId: string) =>
    `/api/extraction/results/${encodeURIComponent(correlationId)}`,
} as const;
