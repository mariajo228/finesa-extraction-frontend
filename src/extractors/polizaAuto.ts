import type { JsonObject, JsonValue } from '../types/extraction';
import type { ExtractionContext, PdfTextItem } from './types';

/**
 * Parser de "Certificado del seguro de Automóviles" (carátula de póliza).
 *
 * Es una función pura: recibe los fragmentos de texto del PDF con su posición (x, y) y devuelve
 * un objeto JSON. La estrategia es:
 *   1. Agrupar los fragmentos en líneas por coordenada Y.
 *   2. Cortar el documento en secciones usando los títulos ("Datos del Vehículo", "Coberturas"...).
 *   3. Dentro de cada sección, emparejar "Etiqueta:" -> valor por posición, o leer tablas por columnas.
 */

// ───────────────────────── utilidades ─────────────────────────

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "84.231.000,00" -> 84231000 ; "1,10" -> 1.1 ; "04" -> 4. Devuelve null si no es un número. */
export function parseNumberCO(raw: string): number | null {
  const s = raw.trim();
  if (!/^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(s)) return null;
  return Number(s.replace(/\./g, '').replace(',', '.'));
}

const numberOrText = (raw: string | undefined): JsonValue | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const n = parseNumberCO(raw);
  return n !== null ? n : raw;
};

const clean = (s: string | undefined): string | undefined => {
  const v = s?.replace(/\s+/g, ' ').trim();
  return v ? v : undefined;
};

/** Quita las claves con valor undefined para producir un JSON limpio. */
function compact(obj: Record<string, JsonValue | undefined>): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

const isEmpty = (o: JsonObject) => Object.keys(o).length === 0;

const MONTHS: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12',
};

const dmyToIso = (d: string) => {
  const [dd, mm, yyyy] = d.split('/');
  return `${yyyy}-${mm}-${dd}`;
};

// ───────────────────────── líneas y secciones ─────────────────────────

interface Line {
  page: number;
  y: number;
  cells: PdfTextItem[];
}

const lineText = (cells: PdfTextItem[]) =>
  cells.map((c) => c.str.trim()).filter(Boolean).join(' ');

/** Agrupa fragmentos con la misma Y (±tolerancia) en líneas, de arriba hacia abajo. */
function toLines(items: PdfTextItem[], tol = 1.5): Line[] {
  const lines: Line[] = [];
  const pages = Array.from(new Set(items.map((i) => i.page))).sort((a, b) => a - b);
  for (const page of pages) {
    const pageItems = items.filter((i) => i.page === page).sort((a, b) => b.y - a.y);
    const pageLines: Line[] = [];
    for (const it of pageItems) {
      const line = pageLines.find((l) => Math.abs(l.y - it.y) <= tol);
      if (line) line.cells.push(it);
      else pageLines.push({ page, y: it.y, cells: [it] });
    }
    for (const l of pageLines) l.cells.sort((a, b) => a.x - b.x);
    lines.push(...pageLines);
  }
  return lines;
}

const SECTION_TITLES = [
  'datos generales',
  'datos del asegurado',
  'antecedentes',
  'datos del vehiculo',
  'coberturas',
  'especificaciones adicionales',
  'liquidacion de primas',
];

interface Sections {
  /** Líneas anteriores al primer título (encabezado con producto y agente). */
  header: Line[];
  byTitle: Map<string, Line[]>;
}

function splitSections(lines: Line[]): Sections {
  const header: Line[] = [];
  const byTitle = new Map<string, Line[]>();
  let current: Line[] = header;
  for (const line of lines) {
    const first = line.cells[0];
    const title = first && first.x < 45 ? normalize(first.str) : '';
    if (SECTION_TITLES.includes(title)) {
      current = [];
      byTitle.set(title, current);
      // La línea del título puede traer más datos (p. ej. "Nº de recibo" junto a "Liquidación de Primas").
      if (line.cells.length > 1) current.push({ ...line, cells: line.cells.slice(1) });
      continue;
    }
    current.push(line);
  }
  return { header, byTitle };
}

// ───────────────────────── etiqueta: valor ─────────────────────────

/** Empareja celdas "Etiqueta:" con las celdas que la siguen en la misma línea. */
function extractPairs(lines: Line[]): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of lines) {
    const cells = line.cells;
    for (let i = 0; i < cells.length; i++) {
      const label = cells[i].str.trim();
      if (!label.endsWith(':')) continue;
      const values: string[] = [];
      for (let j = i + 1; j < cells.length && !cells[j].str.trim().endsWith(':'); j++) {
        values.push(cells[j].str.trim());
      }
      const key = normalize(label.slice(0, -1));
      const value = clean(values.join(' '));
      if (value) pairs[key] = value;
    }
  }
  return pairs;
}

const dashesToUndefined = (v: string | undefined) =>
  v && !/^[-–—\s]+$/.test(v) ? v : undefined;

// ───────────────────────── personas (tomador, asegurado, beneficiario) ─────────────────────────

const VALUE_COL_MIN_X = 100; // las etiquetas están a la izquierda (x≈38) y los valores desde x≈130
const SIDE_COL_MIN_X = 300; // datos secundarios a la derecha, como "CC: 12978800"
const BLOCK_GAP = 12; // separación vertical que parte un bloque de otro (las líneas de un bloque están a ~10)

interface ValueLine {
  y: number;
  main: string;
  side: string;
}

/**
 * Agrupa las líneas de valores en bloques verticales y asigna cada bloque a la etiqueta
 * (p. ej. "Tomador del Seguro:") que queda a su altura.
 */
function groupByLabel(lines: Line[]): Map<string, ValueLine[]> {
  const labelLines = lines.filter((l) => l.cells.some((c) => c.x < 60 && c.str.trim().endsWith(':')));

  const valueLines: ValueLine[] = lines
    .map((l) => ({
      y: l.y,
      main: lineText(l.cells.filter((c) => c.x >= VALUE_COL_MIN_X && c.x < SIDE_COL_MIN_X)),
      side: lineText(l.cells.filter((c) => c.x >= SIDE_COL_MIN_X)),
    }))
    .filter((v) => v.main || v.side);

  const blocks: ValueLine[][] = [];
  for (const v of valueLines) {
    const block = blocks[blocks.length - 1];
    if (block && block[block.length - 1].y - v.y <= BLOCK_GAP) block.push(v);
    else blocks.push([v]);
  }

  const groups = new Map<string, ValueLine[]>();
  let lastLabel: string | undefined;
  for (const block of blocks) {
    const top = block[0].y;
    const bottom = block[block.length - 1].y;
    const label = labelLines.find((l) => l.y <= top + 6 && l.y >= bottom - 6);
    const labelCell = label?.cells.find((c) => c.x < 60 && c.str.trim().endsWith(':'));
    const key = labelCell ? normalize(labelCell.str.replace(/:$/, '')) : lastLabel;
    if (!key) continue;
    lastLabel = key;
    groups.set(key, [...(groups.get(key) ?? []), ...block]);
  }
  return groups;
}

const findGroup = (groups: Map<string, ValueLine[]>, ...needles: string[]) => {
  const out: ValueLine[] = [];
  for (const [k, v] of groups) if (needles.some((n) => k.includes(n))) out.push(...v);
  return out;
};

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE_RE = /^Tel[eé]fono:?\s*(.+)$/i;
const DOC_RE = /\b(CC|CE|NIT|NI|TI|PA|RC|PEP|PPT)\s*:?\s*(\d[\d.]*(?:-\d)?)/;

function parseParty(lines: ValueLine[]): JsonObject {
  if (lines.length === 0) return {};
  const all = lines.flatMap((l) => [l.main, l.side]).filter(Boolean);

  const doc = DOC_RE.exec(lines.map((l) => l.side).join(' ') || all.join(' '));
  const email = EMAIL_RE.exec(all.join(' '))?.[0];
  const phoneLine = lines.map((l) => PHONE_RE.exec(l.main)).find(Boolean);

  const plain = lines
    .map((l) => l.main)
    .filter((m) => m && !EMAIL_RE.test(m) && !PHONE_RE.test(m) && !/^E-?mail/i.test(m));

  return compact({
    nombre: clean(plain[0]),
    tipo_documento: doc?.[1],
    numero_documento: doc?.[2],
    direccion: clean(plain[1]),
    ciudad: plain.length > 2 ? clean(plain[plain.length - 1]) : undefined,
    telefono: clean(phoneLine?.[1]),
    email,
  });
}

function parseBeneficiary(lines: ValueLine[]): JsonObject {
  if (lines.length === 0) return {};
  const mains = lines.map((l) => l.main).filter(Boolean);
  const nit = mains.map((m) => /NIT:?\s*([\d.\-]+)/i.exec(m)).find(Boolean);
  const name = mains.find((m) => !/NIT:?\s*[\d.\-]+/i.test(m));
  return compact({ nombre: clean(name), nit: nit?.[1] });
}

// ───────────────────────── agente (esquina superior derecha) ─────────────────────────

function parseAgent(header: Line[]): JsonObject {
  const texts = header
    .map((l) => lineText(l.cells.filter((c) => c.x >= 350)))
    .filter(Boolean);
  const idx = texts.findIndex((t) => /Agente de Seguros/i.test(t));
  if (idx < 1) return {};

  const docIdx = texts.findIndex((t, i) => i > idx && DOC_RE.test(t));
  const doc = docIdx >= 0 ? DOC_RE.exec(texts[docIdx]) : null;
  const joined = texts.join(' | ');

  return compact({
    nombre: clean(texts[idx - 1]),
    tipo_documento: doc?.[1],
    numero_documento: doc?.[2],
    direccion: docIdx >= 0 ? clean(texts[docIdx + 1]) : undefined,
    ciudad: docIdx >= 0 ? clean(texts[docIdx + 2]) : undefined,
    telefono: clean(/Tel\.?\s*([\d\s]+)/i.exec(joined)?.[1]),
    movil: clean(/M[oó]vil\s*([\d\s]+)/i.exec(joined)?.[1]),
    email: EMAIL_RE.exec(joined)?.[0],
  });
}

// ───────────────────────── tablas ─────────────────────────

function parseCoverages(lines: Line[]): JsonObject[] {
  const headerLine = lines.find((l) => l.cells.some((c) => normalize(c.str) === 'deducible'));
  const valueX = headerLine?.cells.find((c) => normalize(c.str) === 'valor asegurado')?.x;
  const deducX = headerLine?.cells.find((c) => normalize(c.str) === 'deducible')?.x;
  if (!headerLine || valueX === undefined || deducX === undefined) return [];

  // Frontera entre la columna "Valor asegurado" y la columna "Deducible".
  const boundary = (valueX + deducX) / 2;

  const rows: JsonObject[] = [];
  for (const line of lines) {
    if (line === headerLine) continue;
    const name = clean(lineText(line.cells.filter((c) => c.x < SIDE_COL_MIN_X - 150)));
    if (!name || !line.cells.some((c) => c.x < 100)) continue; // fila de datos: empieza con el nombre del amparo
    const value = clean(lineText(line.cells.filter((c) => c.x >= 200 && c.x < boundary)));
    const deductible = clean(lineText(line.cells.filter((c) => c.x >= boundary)));
    rows.push(
      compact({
        amparo: name,
        valor_asegurado: numberOrText(value),
        deducible_smmlv: numberOrText(deductible),
      }),
    );
  }
  return rows;
}

function parseIntermediaries(lines: Line[]): JsonObject[] {
  const headerIdx = lines.findIndex((l) => /Nombre Intermediario/i.test(lineText(l.cells)));
  if (headerIdx < 0) return [];
  const rows: JsonObject[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const cells = line.cells.map((c) => c.str.trim());
    if (cells.length < 3 || !/^\d+$/.test(cells[0])) break;
    rows.push(
      compact({
        codigo: cells[0],
        nombre: clean(cells[1]),
        participacion_pct: parseNumberCO(cells[cells.length - 1]) ?? undefined,
      }),
    );
  }
  return rows;
}

function parsePremiums(lines: Line[]): JsonObject {
  const amount = (label: string) => {
    const line = lines.find((l) => normalize(l.cells[0]?.str ?? '') === label);
    const cell = line?.cells[line.cells.length - 1];
    return line && line.cells.length > 1 && cell ? (parseNumberCO(cell.str) ?? undefined) : undefined;
  };
  return compact({
    prima: amount('prima'),
    iva: amount('iva'),
    importe_total: amount('importe total'),
  });
}

// ───────────────────────── punto de entrada ─────────────────────────

/** Hay suficiente información para decir que es una póliza de automóviles reconocida. */
const looksLikePolicy = (r: JsonObject) => {
  const poliza = r.poliza as JsonObject | undefined;
  const vehiculo = r.vehiculo as JsonObject | undefined;
  return Boolean(poliza?.numero_poliza || vehiculo?.placa);
};

export function parsePolizaAuto(items: PdfTextItem[], ctx: ExtractionContext): JsonObject | null {
  const lines = toLines(items);
  const { header, byTitle } = splitSections(lines);
  const sec = (title: string) => byTitle.get(title) ?? [];
  const fullText = lines.map((l) => lineText(l.cells)).join('\n');

  // — Póliza —
  const policyMatch = /P[oó]liza\s*n\S{0,2}:?\s*(\d+)\s*\/\s*(\d+)/i.exec(fullText);
  const dates = /del\s+(\d{2}\/\d{2}\/\d{4})\s+hasta\s+las\s+[\d:]+\s+horas\s+del\s+(\d{2}\/\d{2}\/\d{4})/i.exec(fullText);
  const issued = /Expedido el d[ií]a\s+(\d{1,2})\s+de\s+([A-Za-zñÑ]+)\s+de\s+(\d{4})/i.exec(fullText);
  const insurer = /([A-Za-zÁÉÍÓÚáéíóú]+)\s+Seguros\s+S\.A\./.exec(fullText);
  const insurerNit = /Nit\.?\s*([\d.]+)\s*-\s*(\d)/i.exec(fullText);

  const titleCells = header
    .flatMap((l) => l.cells.filter((c) => c.x >= 135 && c.x < 200))
    .map((c) => c.str.trim())
    .filter((s) => s && !/^www\./i.test(s) && !/^Allianz$/i.test(s));
  const product = clean(titleCells.join(' ').replace(/^Certificado del seguro\s+de\s+/i, ''));

  const premiumsSection = sec('liquidacion de primas');
  const premiumText = premiumsSection.map((l) => lineText(l.cells)).join('\n');

  const poliza = compact({
    aseguradora: insurer ? `${insurer[1]} Seguros S.A.` : undefined,
    nit_aseguradora: insurerNit ? `${insurerNit[1]}-${insurerNit[2]}` : undefined,
    producto: product,
    numero_poliza: policyMatch?.[1],
    certificado: policyMatch?.[2],
    vigencia_desde: dates ? dmyToIso(dates[1]) : undefined,
    vigencia_hasta: dates ? dmyToIso(dates[2]) : undefined,
    fecha_expedicion: issued && MONTHS[issued[2].toLowerCase()]
      ? `${issued[3]}-${MONTHS[issued[2].toLowerCase()]}-${issued[1].padStart(2, '0')}`
      : undefined,
    periodicidad_pago: clean(/Periodicidad del pago:\s*(\S+)/i.exec(premiumText)?.[1]),
    numero_recibo: /recibo:\s*(\d+)/i.exec(premiumText)?.[1],
  });

  // — Personas —
  const generalGroups = groupByLabel(sec('datos generales'));
  const insuredLines = sec('datos del asegurado');
  const insuredGroups = groupByLabel(insuredLines);

  const tomador = parseParty(findGroup(generalGroups, 'tomador'));
  const beneficiario = parseBeneficiary(findGroup(generalGroups, 'benefici'));
  const asegurado = parseParty(findGroup(insuredGroups, 'asegurado', 'email'));
  const agente = parseAgent(header);

  // — Antecedentes y vehículo —
  const prior = extractPairs(sec('antecedentes'));
  const antecedentes = compact({
    antiguedad_cia_anterior: numberOrText(prior['antiguedad cia anterior']),
    anos_sin_siniestros: numberOrText(prior['anos sin siniestros']),
  });

  const v = extractPairs(sec('datos del vehiculo'));
  const vehiculo = compact({
    placa: v['placa'],
    marca: v['marca'],
    clase: v['clase'],
    tipo: v['tipo'],
    modelo: v['modelo'],
    version: v['version'],
    motor: v['motor'],
    serie: v['serie'],
    chasis: v['chasis'],
    codigo_fasecolda: v['codigo fasecolda'],
    uso: v['uso'],
    zona_circulacion: v['zona circulacion'],
    valor_asegurado: numberOrText(v['valor asegurado']),
    accesorios: numberOrText(v['accesorios']),
    blindaje: numberOrText(v['blindaje']),
    sistema_a_gas: numberOrText(v['sistema a gas']),
    dispositivo_seguridad: dashesToUndefined(v['dispositivo seguridad']) ?? (v['dispositivo seguridad'] ? '—' : undefined),
  });

  // — Tablas —
  const coberturas = parseCoverages(sec('coberturas'));
  const intermediarios = parseIntermediaries(sec('especificaciones adicionales'));
  const primas = parsePremiums(premiumsSection);

  // — Verificación contra lo que escribió el usuario en el formulario —
  const typed = ctx.docId.replace(/\D/g, '');
  const sameDoc = (p: JsonObject) =>
    typeof p.numero_documento === 'string' && p.numero_documento.replace(/\D/g, '') === typed;
  const roles = [sameDoc(tomador) && 'Tomador', sameDoc(asegurado) && 'Asegurado'].filter(Boolean);
  const verificacion: JsonObject = {
    documento_ingresado: `${ctx.docType} ${ctx.docId}`,
    coincide_con_poliza: roles.length > 0,
    encontrado_como: roles.length > 0 ? roles.join(' y ') : 'No encontrado en la póliza',
  };

  const result: JsonObject = {
    documento: { nombre_archivo: ctx.fileName, paginas: ctx.pages },
    ...(isEmpty(poliza) ? {} : { poliza }),
    ...(isEmpty(tomador) ? {} : { tomador }),
    ...(isEmpty(asegurado) ? {} : { asegurado }),
    ...(isEmpty(beneficiario) ? {} : { beneficiario }),
    ...(isEmpty(agente) ? {} : { agente }),
    ...(isEmpty(antecedentes) ? {} : { antecedentes }),
    ...(isEmpty(vehiculo) ? {} : { vehiculo }),
    ...(coberturas.length ? { coberturas } : {}),
    ...(intermediarios.length ? { intermediarios } : {}),
    ...(isEmpty(primas) ? {} : { primas }),
    verificacion,
  };

  return looksLikePolicy(result) ? result : null;
}

/**
 * Plan B para documentos que no tienen el formato conocido: devuelve todos los pares
 * "Etiqueta: valor" que encuentre, para no dejar al usuario sin nada.
 */
export function parseGenericPairs(items: PdfTextItem[], ctx: ExtractionContext): JsonObject | null {
  const lines = toLines(items);
  const pairs = extractPairs(lines);
  const inline: Record<string, string> = {};
  for (const l of lines) {
    for (const c of l.cells) {
      const m = /^([A-Za-zÁÉÍÓÚáéíóúñÑ .\/ºª]{2,40}):\s*(\S.*)$/.exec(c.str.trim());
      if (m) inline[normalize(m[1])] = m[2].trim();
    }
  }
  const merged = { ...inline, ...pairs };
  const entries = Object.entries(merged);
  if (entries.length === 0) return null;

  const fields: JsonObject = {};
  for (const [k, val] of entries) fields[k.replace(/\s+/g, '_')] = numberOrText(val) ?? val;
  return {
    documento: { nombre_archivo: ctx.fileName, paginas: ctx.pages },
    campos_detectados: fields,
  };
}
