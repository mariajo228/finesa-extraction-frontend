import { config } from '../utils/config';

/** Error tipado para que la UI pueda mostrar mensajes amigables. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly kind: 'network' | 'timeout' | 'http' | 'parse' | 'aborted',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'signal'> {
  /** Señal externa para cancelar (p. ej. el usuario cancela o el componente se desmonta). */
  signal?: AbortSignal;
  timeoutMs?: number;
}

const friendlyHttpMessage = (status: number): string => {
  if (status === 400 || status === 422) return 'El servidor rechazó los datos enviados. Revisa el formulario.';
  if (status === 401 || status === 403) return 'No tienes autorización para usar este servicio.';
  if (status === 404) return 'El recurso solicitado no existe (¿el identificador es correcto?).';
  if (status === 413) return 'El archivo es demasiado grande para el servidor.';
  if (status === 415) return 'El servidor no acepta este tipo de archivo.';
  if (status === 429) return 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.';
  if (status >= 500) return 'El servicio tuvo un problema interno. Inténtalo de nuevo en unos minutos.';
  return `La solicitud falló (HTTP ${status}).`;
};

/**
 * Wrapper de fetch con: URL base, timeout, cancelación y errores tipados.
 * Devuelve el status y el JSON ya parseado.
 */
export async function request<T>(
  path: string,
  { signal, timeoutMs = config.requestTimeoutMs, ...init }: RequestOptions = {},
): Promise<{ status: number; data: T }> {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });
  if (signal?.aborted) controller.abort();

  try {
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = typeof body?.detail === 'string' ? body.detail : typeof body?.message === 'string' ? body.message : '';
      } catch {
        /* cuerpo no JSON: se ignora */
      }
      throw new ApiError(detail || friendlyHttpMessage(response.status), 'http', response.status);
    }

    try {
      const data = (await response.json()) as T;
      return { status: response.status, data };
    } catch {
      throw new ApiError('La respuesta del servidor no tiene un formato JSON válido.', 'parse', response.status);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (timedOut) throw new ApiError('El servidor tardó demasiado en responder.', 'timeout');
      throw new ApiError('La operación fue cancelada.', 'aborted');
    }
    throw new ApiError('No se pudo conectar con el servidor. Revisa tu conexión a internet.', 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}
