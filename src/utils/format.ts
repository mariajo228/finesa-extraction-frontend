import type { JsonValue } from '../types/extraction';

/** Etiquetas con tildes y siglas correctas para los campos conocidos (pólizas). */
const FIELD_LABELS: Record<string, string> = {
  documento: 'Documento procesado',
  nombre_archivo: 'Archivo',
  paginas: 'Páginas',
  poliza: 'Póliza',
  aseguradora: 'Aseguradora',
  nit_aseguradora: 'NIT aseguradora',
  producto: 'Producto',
  numero_poliza: 'Número de póliza',
  certificado: 'Certificado',
  vigencia_desde: 'Vigencia desde',
  vigencia_hasta: 'Vigencia hasta',
  fecha_expedicion: 'Fecha de expedición',
  periodicidad_pago: 'Periodicidad de pago',
  numero_recibo: 'Número de recibo',
  tomador: 'Tomador del seguro',
  asegurado: 'Asegurado principal',
  beneficiario: 'Beneficiario',
  agente: 'Agente de seguros',
  nombre: 'Nombre',
  tipo_documento: 'Tipo de documento',
  numero_documento: 'Número de documento',
  direccion: 'Dirección',
  ciudad: 'Ciudad',
  telefono: 'Teléfono',
  movil: 'Móvil',
  email: 'Correo electrónico',
  nit: 'NIT',
  antecedentes: 'Antecedentes',
  antiguedad_cia_anterior: 'Antigüedad compañía anterior (años)',
  anos_sin_siniestros: 'Años sin siniestros',
  vehiculo: 'Vehículo',
  placa: 'Placa',
  version: 'Versión',
  codigo_fasecolda: 'Código Fasecolda',
  zona_circulacion: 'Zona de circulación',
  valor_asegurado: 'Valor asegurado',
  sistema_a_gas: 'Sistema a gas',
  dispositivo_seguridad: 'Dispositivo de seguridad',
  coberturas: 'Coberturas',
  amparo: 'Amparo',
  deducible_smmlv: 'Deducible (SMMLV)',
  intermediarios: 'Intermediarios',
  codigo: 'Código',
  participacion_pct: 'Participación (%)',
  primas: 'Liquidación de primas',
  iva: 'IVA',
  importe_total: 'Importe total',
  verificacion: 'Verificación de identidad',
  documento_ingresado: 'Documento ingresado',
  coincide_con_poliza: 'Coincide con la póliza',
  encontrado_como: 'Encontrado como',
  campos_detectados: 'Campos detectados',
};

/** Palabras comunes sin tilde (las claves de un JSON casi nunca las traen) -> forma correcta. */
const WORD_FIXES: Record<string, string> = {
  numero: 'número', poliza: 'póliza', direccion: 'dirección', telefono: 'teléfono', codigo: 'código',
  expedicion: 'expedición', emision: 'emisión', identificacion: 'identificación', informacion: 'información',
  descripcion: 'descripción', cedula: 'cédula', vehiculo: 'vehículo', razon: 'razón', electronico: 'electrónico',
  antiguedad: 'antigüedad', participacion: 'participación', ubicacion: 'ubicación', automoviles: 'automóviles',
  compania: 'compañía', ano: 'año', anos: 'años', liquidacion: 'liquidación', pais: 'país', genero: 'género',
  basico: 'básico', maximo: 'máximo', minimo: 'mínimo', periodo: 'período', comision: 'comisión',
  fabricacion: 'fabricación', afiliacion: 'afiliación', observacion: 'observación', cantidad: 'cantidad',
};

/** "fecha_nacimiento" -> "Fecha nacimiento", "docType" -> "Doc type" (o la etiqueta conocida) */
export function humanizeKey(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .map((word) => WORD_FIXES[word] ?? word)
    .join(' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const CURRENCY_KEY =
  /^(prima|iva|accesorios|blindaje|sistema_a_gas)$|(ingreso|egreso|valor|monto|cupo|saldo|total|precio|salario|deuda)/i;

/** Convierte un valor primitivo en texto legible para un usuario final. */
export function formatPrimitive(value: JsonValue, key = ''): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') {
    if (/(confianza|confidence|score_ocr|probabilidad)/i.test(key) && value <= 1) {
      return `${(value * 100).toFixed(1)} %`;
    }
    if (CURRENCY_KEY.test(key)) {
      return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value);
    }
    return new Intl.NumberFormat('es-CO').format(value);
  }
  if (typeof value === 'string' && ISO_DATE.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      const hasTime = value.includes('T');
      return new Intl.DateTimeFormat('es-CO', {
        dateStyle: 'long',
        ...(hasTime ? { timeStyle: 'short' } : {}),
        timeZone: hasTime ? undefined : 'UTC',
      }).format(d);
    }
  }
  return String(value);
}

export const isPrimitive = (v: JsonValue): v is string | number | boolean | null =>
  v === null || typeof v !== 'object';

export const isPlainObject = (v: JsonValue): v is { [k: string]: JsonValue } =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isArrayOfObjects = (v: JsonValue): v is { [k: string]: JsonValue }[] =>
  Array.isArray(v) && v.length > 0 && v.every(isPlainObject);
