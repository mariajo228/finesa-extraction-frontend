import type { JsonObject, JsonValue } from '../types/extraction';
import { formatPrimitive, humanizeKey, isArrayOfObjects, isPlainObject, isPrimitive } from './format';

/**
 * Organizador genérico de resultados: toma CUALQUIER objeto JSON y lo reparte en bloques
 * listos para pintar (personas, secciones de datos, tablas y listas), sin depender de que
 * el documento sea de un tipo conocido.
 *
 *  - Desenvuelve contenedores de un solo campo ({ data: { ... } }, { campos_detectados: { ... } }).
 *  - Cada objeto anidado pasa a ser su propia tarjeta; los arreglos de objetos, una tabla.
 *  - Los objetos que describen a una persona (tienen nombre) pasan a tarjetas de persona.
 *  - Los campos sueltos se agrupan por tema (identificación, fechas, valores, contacto…).
 */

type Primitive = string | number | boolean | null;

export interface Fact {
  key: string;
  label: string;
  value: Primitive;
  strong?: boolean;
}
export interface Section {
  title: string;
  entries: [string, Primitive][];
}
export interface Person {
  role: string;
  data: JsonObject;
}
export interface TableBlock {
  title: string;
  rows: JsonObject[];
}
export interface ListBlock {
  title: string;
  items: Primitive[];
}
export interface Organized {
  title?: string;
  facts: Fact[];
  people: Person[];
  sections: Section[];
  tables: TableBlock[];
  lists: ListBlock[];
  fieldCount: number;
}

// ───────────────────────── utilidades ─────────────────────────

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "numeroPoliza" / "Número póliza" -> "numero_poliza" */
const snake = (key: string) =>
  strip(key.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const tokens = (key: string) => snake(key).split('_').filter(Boolean);

/** Metadatos del archivo que ya se muestran en el encabezado (no son un dato del documento). */
const isMeta = (key: string, value: JsonValue | undefined) =>
  key === 'documento' &&
  value !== undefined &&
  isPlainObject(value) &&
  Object.keys(value).every((k) => k === 'nombre_archivo' || k === 'paginas');

/** Campos técnicos de la respuesta que no le interesan a un usuario final. */
const HIDDEN = new Set(['success', 'correlation_id', 'correlationid', 'ticket_id', 'ticketid', 'request_id', 'requestid']);
const isHidden = (key: string) => HIDDEN.has(snake(key));

/** Texto corto para valores que no caben en una tarjeta (anidación muy profunda). */
function inlineText(value: JsonValue, key = ''): string {
  if (isPrimitive(value)) return formatPrimitive(value, key);
  if (Array.isArray(value)) return value.map((v) => inlineText(v)).join(', ');
  return Object.entries(value)
    .map(([k, v]) => `${humanizeKey(k)}: ${inlineText(v, k)}`)
    .join(' · ');
}

// ───────────────────────── desenvolver contenedores ─────────────────────────

/** Si el JSON es solo un contenedor de un campo, entra hasta el contenido real. */
export function unwrapRoot(obj: JsonObject): JsonObject {
  let current = obj;
  for (let i = 0; i < 4; i++) {
    const keys = Object.keys(current).filter((k) => !isMeta(k, current[k]) && !isHidden(k));
    if (keys.length !== 1) break;
    const only = current[keys[0]];
    if (!isPlainObject(only)) break;
    current = only;
  }
  return current;
}

// ───────────────────────── personas ─────────────────────────

const NAME_KEY = /^(nombre|nombres|name|razon_social|full_name|nombre_completo)$/;

/** Un objeto "persona": pocos campos simples y uno de ellos es el nombre. */
function isPerson(obj: JsonObject): boolean {
  const entries = Object.entries(obj);
  if (entries.length === 0 || entries.length > 12) return false;
  if (entries.some(([, v]) => !isPrimitive(v))) return false;
  return entries.some(([k, v]) => NAME_KEY.test(snake(k)) && typeof v === 'string' && v.trim() !== '');
}

// ───────────────────────── agrupación por tema ─────────────────────────

const GENERAL = 'Información general';

/** Se evalúan en este orden; el primer grupo cuyo prefijo coincida con una palabra de la clave gana. */
const GROUPS: { title: string; stems: string[] }[] = [
  {
    title: 'Valores y pagos',
    stems: ['valor', 'prima', 'iva', 'total', 'subtotal', 'monto', 'saldo', 'importe', 'precio', 'costo', 'tarifa', 'pago', 'cuota', 'deducible', 'comision', 'impuesto', 'descuento', 'recargo', 'cupo', 'ingreso', 'egreso', 'salario', 'interes'],
  },
  { title: 'Fechas y vigencia', stems: ['fecha', 'vigencia', 'desde', 'hasta', 'vencimiento', 'expedicion', 'emision', 'periodo', 'inicio'] },
  { title: 'Vehículo o bien', stems: ['placa', 'marca', 'modelo', 'linea', 'motor', 'chasis', 'vin', 'color', 'clase', 'cilindraje', 'version', 'fasecolda', 'matricula'] },
  { title: 'Contacto y ubicación', stems: ['direccion', 'ciudad', 'municipio', 'departamento', 'pais', 'telefono', 'celular', 'movil', 'correo', 'email', 'mail', 'barrio', 'zona', 'ubicacion'] },
  { title: 'Identificación', stems: ['nombre', 'razon', 'titular', 'cliente', 'apellido', 'cedula', 'nit', 'identificacion', 'documento'] },
  { title: 'Datos del documento', stems: ['poliza', 'producto', 'plan', 'ramo', 'cobertura', 'amparo', 'certificado', 'contrato', 'aseguradora', 'entidad', 'emisor', 'referencia', 'numero', 'codigo', 'recibo', 'factura', 'radicado', 'periodicidad', 'estado'] },
];

const SECTION_ORDER = ['Identificación', 'Datos del documento', 'Fechas y vigencia', 'Valores y pagos', 'Contacto y ubicación', 'Vehículo o bien', GENERAL];

function classify(key: string): string {
  const words = tokens(key);
  for (const group of GROUPS) {
    if (words.some((w) => group.stems.some((s) => w.startsWith(s)))) return group.title;
  }
  return GENERAL;
}

// ───────────────────────── datos destacados (hero) ─────────────────────────

const TITLE_KEYS = ['aseguradora', 'empresa', 'entidad', 'emisor', 'razon_social', 'titulo', 'title', 'producto'];

const FACT_PATTERNS: { test: RegExp; strong?: boolean }[] = [
  { test: /^(numero|nro)_(de_|del_)?(poliza|factura|contrato|referencia|radicado|recibo|certificado|cuenta)$|^(poliza|factura|contrato|radicado)$/ },
  { test: /vigencia_desde|fecha_(de_)?(inicio|desde|expedicion|emision|inicial)|^desde$/ },
  { test: /vigencia_hasta|fecha_(de_)?(fin|hasta|vencimiento|final)|^hasta$/ },
  { test: /valor_asegurado|valor_total|monto_total|^total$|saldo_total/ },
  { test: /importe_total|total_a_pagar|valor_a_pagar/, strong: true },
];

// ───────────────────────── organizador ─────────────────────────

export function organizeData(raw: JsonObject): Organized {
  const root = unwrapRoot(raw);
  const people: Person[] = [];
  const sections: Section[] = [];
  const tables: TableBlock[] = [];
  const lists: ListBlock[] = [];
  let fieldCount = 0;

  const addBag = (title: string, entries: [string, Primitive][]) => {
    if (entries.length === 0) return;
    fieldCount += entries.length;
    // Pocos campos: una sola tarjeta con el título del padre.
    if (entries.length < 8) {
      sections.push({ title, entries });
      return;
    }
    // Muchos campos: se reparten por tema para no dejar todo en una tarjeta gigante.
    const buckets = new Map<string, [string, Primitive][]>();
    for (const entry of entries) {
      const group = classify(entry[0]);
      const list = buckets.get(group);
      if (list) list.push(entry);
      else buckets.set(group, [entry]);
    }
    // Un grupo de un solo campo no merece tarjeta propia: se une a "Información general".
    const general = buckets.get(GENERAL) ?? [];
    for (const [group, list] of [...buckets]) {
      if (group !== GENERAL && list.length < 2) {
        general.push(...list);
        buckets.delete(group);
      }
    }
    if (general.length > 0) buckets.set(GENERAL, general);
    for (const group of SECTION_ORDER) {
      const list = buckets.get(group);
      if (list && list.length > 0) sections.push({ title: title === GENERAL ? group : `${title} · ${group}`, entries: list });
    }
  };

  const addArray = (key: string, value: JsonValue[]) => {
    if (value.length === 0) return;
    if (isArrayOfObjects(value)) {
      tables.push({ title: humanizeKey(key), rows: value });
      return;
    }
    lists.push({ title: humanizeKey(key), items: value.map((v) => (isPrimitive(v) ? v : inlineText(v))) });
  };

  const walk = (title: string, obj: JsonObject, depth: number) => {
    const primitives: [string, Primitive][] = [];
    const nested: [string, JsonValue][] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === '' || isHidden(key) || (depth === 0 && isMeta(key, value))) continue;
      if (isPrimitive(value)) primitives.push([key, value]);
      else if (Array.isArray(value)) nested.push([key, value]);
      else if (depth >= 3) primitives.push([key, inlineText(value, key)]);
      else nested.push([key, value]);
    }
    addBag(title, primitives);
    for (const [key, value] of nested) {
      if (Array.isArray(value)) addArray(key, value);
      else if (isPlainObject(value)) visit(key, value, depth + 1);
    }
  };

  const visit = (key: string, obj: JsonObject, depth: number) => {
    if (depth <= 2 && isPerson(obj)) {
      people.push({ role: humanizeKey(key), data: obj });
      fieldCount += Object.keys(obj).length;
      return;
    }
    walk(humanizeKey(key), obj, depth);
  };

  walk(GENERAL, root, 0);

  // Datos destacados: se buscan entre los campos simples ya organizados.
  const flat = sections.flatMap((s) => s.entries).filter(([, v]) => v !== null && typeof v !== 'boolean');
  const facts: Fact[] = [];
  for (const { test, strong } of FACT_PATTERNS) {
    const hit = flat.find(([k]) => test.test(snake(k)) && !facts.some((f) => f.key === k));
    if (hit) facts.push({ key: hit[0], label: humanizeKey(hit[0]), value: hit[1], strong });
  }
  const title = TITLE_KEYS.map((name) => flat.find(([k, v]) => snake(k) === name && typeof v === 'string'))
    .find((hit) => hit !== undefined)?.[1];

  return { title: typeof title === 'string' ? title : undefined, facts, people, sections, tables, lists, fieldCount };
}
