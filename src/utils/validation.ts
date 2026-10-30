import { DOC_TYPES, type DocType } from '../types/extraction';
import { config } from './config';

export const PDF_MIME = 'application/pdf';

export interface FormValues {
  docType: DocType | '';
  docId: string;
  file: File | null;
}

export type FormErrors = Partial<Record<keyof FormValues, string>>;

/** Firma real de un PDF: los primeros bytes son "%PDF-". */
export async function hasPdfSignature(file: File): Promise<boolean> {
  const header = await file.slice(0, 5).arrayBuffer();
  const text = new TextDecoder('ascii').decode(header);
  return text === '%PDF-';
}

export function validateDocType(value: string): string | undefined {
  if (!value) return 'Selecciona un tipo de documento.';
  if (!DOC_TYPES.some((t) => t.value === value)) return 'Tipo de documento no válido.';
  return undefined;
}

/** Número de identificación: solo dígitos para CC/CE, dígitos con guion opcional para NI. */
export function validateDocId(value: string, docType: DocType | ''): string | undefined {
  const v = value.trim();
  if (!v) return 'Ingresa el número de identificación.';
  const pattern = docType === 'NI' ? /^\d{6,15}(-\d)?$/ : /^\d{5,15}$/;
  if (!pattern.test(v)) {
    return docType === 'NI'
      ? 'El NIT debe tener entre 6 y 15 dígitos (dígito de verificación opcional: 900123456-7).'
      : 'Debe contener solo números (entre 5 y 15 dígitos).';
  }
  return undefined;
}

/** Validación síncrona de tipo MIME, extensión y tamaño. */
export function validateFileBasic(file: File | null): string | undefined {
  if (!file) return 'Adjunta un archivo PDF.';
  if (file.type !== PDF_MIME) return 'Solo se permiten archivos PDF (application/pdf).';
  if (!file.name.toLowerCase().endsWith('.pdf')) return 'El archivo debe tener extensión .pdf.';
  if (file.size === 0) return 'El archivo está vacío.';
  if (file.size > config.maxFileBytes) {
    return `El archivo supera el máximo de ${(config.maxFileBytes / 1024 / 1024).toFixed(0)} MB.`;
  }
  return undefined;
}

/** Validación completa del archivo, incluida la firma binaria (%PDF-). */
export async function validateFileStrict(file: File | null): Promise<string | undefined> {
  const basic = validateFileBasic(file);
  if (basic || !file) return basic;
  if (!(await hasPdfSignature(file))) {
    return 'El contenido no corresponde a un PDF válido.';
  }
  return undefined;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
