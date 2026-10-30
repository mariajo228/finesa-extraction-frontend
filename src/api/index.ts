import { config } from '../utils/config';
import { localExtractionApi } from '../local/localExtractionApi';
import { realExtractionApi, type ExtractionApi } from './extractionApi';

/**
 * Punto único de selección según VITE_API_MODE:
 *  - "real"  -> backend REST (los 3 endpoints del contrato)
 *  - "local" -> lee el PDF en el navegador (no necesita backend)
 */
export const extractionApi: ExtractionApi =
  config.apiMode === 'real' ? realExtractionApi : localExtractionApi;

export type { ExtractionApi } from './extractionApi';
export { ApiError } from './httpClient';
