import { useMemo, useState, type ReactNode } from 'react';
import type { JsonObject, JsonValue } from '../types/extraction';
import {
  formatPrimitive,
  humanizeKey,
  isArrayOfObjects,
  isPlainObject,
  isPrimitive,
} from '../utils/format';
import { organizeData, unwrapRoot } from '../utils/organize';
import { CheckIcon, DownloadIcon, RefreshIcon, SearchIcon, SortIcon } from './icons';

type Primitive = string | number | boolean | null;

const PARTY_ROLES: Record<string, string> = {
  tomador: 'Tomador del seguro',
  asegurado: 'Asegurado principal',
  beneficiario: 'Beneficiario',
  agente: 'Agente de seguros',
};

const KNOWN_KEYS = new Set([
  'documento',
  'poliza',
  'antecedentes',
  'vehiculo',
  'coberturas',
  'intermediarios',
  'primas',
  'verificacion',
  ...Object.keys(PARTY_ROLES),
]);

const MONEY_KEY = /(valor|prima|iva|total|accesorios|blindaje|gas|monto|saldo)/i;

const asObject = (value: JsonValue | undefined): JsonObject | undefined =>
  value !== undefined && isPlainObject(value) && Object.keys(value).length > 0 ? value : undefined;

const asText = (value: JsonValue | undefined): string | undefined =>
  value === undefined || value === null || value === '' ? undefined : formatPrimitive(value);

const PLAIN_NUMBER_KEY = /(modelo|ano|anio|año|codigo|numero|placa)/i;

function formatMoney(value: Primitive, key: string): string {
  if (typeof value === 'number' && PLAIN_NUMBER_KEY.test(key)) return String(value);
  if (typeof value === 'number' && MONEY_KEY.test(key)) {
    return `$ ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value)}`;
  }
  return formatPrimitive(value, key);
}

function Value({ k, v }: { k: string; v: Primitive }) {
  if (typeof v === 'boolean') {
    return <span className={`badge ${v ? 'badge--ok' : 'badge--muted'}`}>{v ? 'Sí' : 'No'}</span>;
  }
  return <>{formatMoney(v, k)}</>;
}

function Card({
  title,
  subtitle,
  className = '',
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card result-card ${className}`.trim()}>
      <header className="result-card__head">
        <h3>{title}</h3>
        {subtitle && <span className="muted">{subtitle}</span>}
      </header>
      {children}
    </section>
  );
}

function KeyValueList({ data, columns = 1 }: { data: JsonObject; columns?: 1 | 2 }) {
  const rows = Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const primitives = rows.filter(([, v]) => isPrimitive(v)) as [string, Primitive][];
  const nested = rows.filter(([, v]) => !isPrimitive(v));

  return (
    <>
      <dl className={`kv-list kv-list--${columns}`}>
        {primitives.map(([k, v]) => (
          <div key={k} className="kv-list__row">
            <dt>{humanizeKey(k)}</dt>
            <dd><Value k={k} v={v} /></dd>
          </div>
        ))}
      </dl>
      {nested.map(([k, v]) => (
        <div key={k} className="result-card__nested">
          <h4>{humanizeKey(k)}</h4>
          <Nested value={v} />
        </div>
      ))}
    </>
  );
}

type SortState = { col: string; dir: 'asc' | 'desc' } | null;

const compareValues = (a: JsonValue | undefined, b: JsonValue | undefined): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''), 'es', { numeric: true });
};

/** Tabla dinámica: ordena por columna (clic en el encabezado) y filtra cuando hay varias filas. */
function DataTable({ rows }: { rows: JsonObject[] }) {
  const columns = useMemo(() => Array.from(new Set(rows.flatMap((r) => Object.keys(r)))), [rows]);
  const [sort, setSort] = useState<SortState>(null);
  const [query, setQuery] = useState('');
  const isNumeric = (c: string) => rows.every((r) => r[c] === undefined || typeof r[c] === 'number');
  const filterable = rows.length > 5;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) =>
        columns.some((c) => {
          const v = r[c];
          return v !== undefined && isPrimitive(v) && formatPrimitive(v, c).toLowerCase().includes(q);
        }),
      );
    }
    if (sort) {
      const { col, dir } = sort;
      list = [...list].sort((x, y) => compareValues(x[col], y[col]) * (dir === 'asc' ? 1 : -1));
    }
    return list;
  }, [rows, columns, query, sort]);

  // Ciclo: sin orden -> ascendente -> descendente -> sin orden.
  const toggleSort = (col: string) =>
    setSort((s) => (s && s.col === col ? (s.dir === 'asc' ? { col, dir: 'desc' } : null) : { col, dir: 'asc' }));

  return (
    <div className="table-block">
      {filterable && (
        <div className="table-toolbar">
          <label className="search">
            <SearchIcon width={16} height={16} />
            <input
              type="search"
              placeholder="Filtrar filas…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filtrar filas de la tabla"
            />
          </label>
          <span className="muted" aria-live="polite">
            {visible.length} de {rows.length}
          </span>
        </div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => {
                const state = sort?.col === c ? sort.dir : 'none';
                return (
                  <th
                    key={c}
                    scope="col"
                    className={isNumeric(c) ? 'num' : undefined}
                    aria-sort={state === 'asc' ? 'ascending' : state === 'desc' ? 'descending' : 'none'}
                  >
                    <button type="button" className="th-sort" onClick={() => toggleSort(c)}>
                      {humanizeKey(c)}
                      <SortIcon state={state} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="table__empty">
                  Sin coincidencias para “{query}”.
                </td>
              </tr>
            ) : (
              visible.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => {
                    const cell = row[c];
                    return (
                      <td key={c} data-label={humanizeKey(c)} className={isNumeric(c) ? 'num' : undefined}>
                        {cell === undefined ? '—' : isPrimitive(cell) ? <Value k={c} v={cell} /> : <Inline value={cell} />}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Inline({ value }: { value: JsonValue }) {
  if (Array.isArray(value)) {
    return <>{value.map((v) => (isPrimitive(v) ? formatPrimitive(v) : '…')).join(', ')}</>;
  }
  if (isPlainObject(value)) {
    return (
      <>
        {Object.entries(value)
          .map(([k, v]) => `${humanizeKey(k)}: ${isPrimitive(v) ? formatPrimitive(v, k) : '…'}`)
          .join(' · ')}
      </>
    );
  }
  return <>{formatPrimitive(value)}</>;
}

function Nested({ value }: { value: JsonValue }) {
  if (isArrayOfObjects(value)) return <DataTable rows={value} />;
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="muted">Sin elementos.</p>;
    return (
      <ul className="chips">
        {value.map((v, i) => (
          <li key={i} className="chip">{isPrimitive(v) ? formatPrimitive(v) : <Inline value={v} />}</li>
        ))}
      </ul>
    );
  }
  if (isPlainObject(value)) return <KeyValueList data={value} />;
  return <p>{formatPrimitive(value)}</p>;
}

function initials(name: string): string {
  const letters = name
    .replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]);
  return letters.join('').toUpperCase() || '?';
}

function PartyCard({ role, data }: { role: string; data: JsonObject }) {
  const { nombre, tipo_documento, numero_documento, ...rest } = data;
  const name = asText(nombre) ?? 'Sin nombre';
  const document = [asText(tipo_documento), asText(numero_documento)].filter(Boolean).join(' ');

  return (
    <section className="card party">
      <div className="party__top">
        <span className="party__avatar" aria-hidden="true">{initials(name)}</span>
        <div className="party__id">
          <span className="party__role">{role}</span>
          <strong className="party__name">{name}</strong>
          {document && <span className="muted">{document}</span>}
        </div>
      </div>
      <KeyValueList data={rest} />
    </section>
  );
}

interface HeroFact {
  label: string;
  value: string | undefined;
  strong?: boolean;
}

/** Resumen superior reutilizable: título del documento y sus datos más importantes. */
function HeroCard({ eyebrow, title, facts }: { eyebrow: string; title: string; facts: HeroFact[] }) {
  return (
    <section className="hero card">
      <div className="hero__main">
        <span className="hero__eyebrow">{eyebrow}</span>
        <h3 className="hero__title">{title}</h3>
      </div>
      {facts.length > 0 && (
        <dl className="hero__facts">
          {facts.map((f) => (
            <div key={f.label} className={f.strong ? 'hero__fact hero__fact--strong' : 'hero__fact'}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function PolicyHero({ data }: { data: JsonObject }) {
  const poliza = asObject(data.poliza);
  const vehiculo = asObject(data.vehiculo);
  const primas = asObject(data.primas);

  const facts: { label: string; value: string | undefined; strong?: boolean }[] = [
    { label: 'Número de póliza', value: asText(poliza?.numero_poliza) },
    { label: 'Vigencia desde', value: asText(poliza?.vigencia_desde) },
    { label: 'Vigencia hasta', value: asText(poliza?.vigencia_hasta) },
    {
      label: 'Valor asegurado',
      value: vehiculo && isPrimitive(vehiculo.valor_asegurado) ? formatMoney(vehiculo.valor_asegurado, 'valor_asegurado') : undefined,
    },
    {
      label: 'Importe total',
      value: primas && isPrimitive(primas.importe_total) ? formatMoney(primas.importe_total, 'importe_total') : undefined,
      strong: true,
    },
  ];
  const visibleFacts = facts.filter((f) => f.value && f.value !== '—');
  const title = asText(poliza?.aseguradora);
  if (!title && visibleFacts.length === 0) return null;

  return (
    <HeroCard
      eyebrow={asText(poliza?.producto) ?? 'Documento'}
      title={title ?? 'Información del documento'}
      facts={visibleFacts}
    />
  );
}

function PremiumTiles({ data }: { data: JsonObject }) {
  const entries = Object.entries(data).filter(([, v]) => isPrimitive(v)) as [string, Primitive][];
  return (
    <div className="tiles">
      {entries.map(([k, v]) => (
        <div key={k} className={`tile ${k === 'importe_total' ? 'tile--strong' : ''}`.trim()}>
          <span>{humanizeKey(k)}</span>
          <strong><Value k={k} v={v} /></strong>
        </div>
      ))}
    </div>
  );
}

/** Exporta el resultado como archivo .json (descarga; nunca se muestra el JSON en pantalla). */
function downloadJson(data: JsonObject, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

interface Props {
  data: JsonObject;
  mode: 'sync' | 'async';
  onNew: () => void;
}

/** Estructura conocida: carátula de póliza, con tarjetas pensadas para ese documento. */
function PolicyBody({ data }: { data: JsonObject }) {
  const poliza = asObject(data.poliza);
  const vehiculo = asObject(data.vehiculo);
  const antecedentes = asObject(data.antecedentes);
  const primas = asObject(data.primas);
  const parties = Object.entries(PARTY_ROLES)
    .map(([key, role]) => [role, asObject(data[key])] as const)
    .filter((entry): entry is readonly [string, JsonObject] => entry[1] !== undefined);

  const coberturas = isArrayOfObjects(data.coberturas) ? data.coberturas : undefined;
  const intermediarios = isArrayOfObjects(data.intermediarios) ? data.intermediarios : undefined;

  const { aseguradora: _insurer, producto: _product, ...policyDetails } = poliza ?? {};
  void _insurer;
  void _product;

  const others = Object.entries(data).filter(([key]) => !KNOWN_KEYS.has(key));

  return (
    <>
      <PolicyHero data={data} />

      {parties.length > 0 && (
        <div className="group">
          <h3 className="group__title">Personas involucradas</h3>
          <div className="parties">
            {parties.map(([role, party]) => (
              <PartyCard key={role} role={role} data={party} />
            ))}
          </div>
        </div>
      )}

      {(Object.keys(policyDetails).length > 0 || vehiculo) && (
        <div className="group">
          <h3 className="group__title">Póliza y vehículo</h3>
          <div className="pair">
            {Object.keys(policyDetails).length > 0 && (
              <Card title="Datos de la póliza" className="result-card--wide">
                <KeyValueList data={policyDetails} columns={2} />
              </Card>
            )}
            {vehiculo && (
              <Card title="Vehículo asegurado" className="result-card--wide">
                <KeyValueList data={vehiculo} columns={2} />
              </Card>
            )}
          </div>
        </div>
      )}

      {coberturas && (
        <div className="group">
          <h3 className="group__title">Coberturas</h3>
          <Card title="Amparos contratados" subtitle={`${coberturas.length} amparos`}>
            <DataTable rows={coberturas} />
          </Card>
        </div>
      )}

      {(primas || antecedentes || intermediarios) && (
        <div className="group">
          <h3 className="group__title">Primas y otros datos</h3>
          {primas && (
            <Card title="Liquidación de primas">
              <PremiumTiles data={primas} />
            </Card>
          )}
          {(antecedentes || intermediarios) && (
            <div className="pair">
              {antecedentes && (
                <Card title="Antecedentes">
                  <KeyValueList data={antecedentes} />
                </Card>
              )}
              {intermediarios && (
                <Card title="Intermediarios">
                  <DataTable rows={intermediarios} />
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {others.length > 0 && (
        <div className="group">
          <h3 className="group__title">{poliza ? 'Información adicional' : 'Datos detectados'}</h3>
          <div className="pair">
            {others.map(([key, value]) => (
              <Card
                key={key}
                title={humanizeKey(key)}
                className={isArrayOfObjects(value) ? 'result-card--wide' : ''}
              >
                <Nested value={value} />
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Cualquier otro documento: el organizador reparte el JSON en personas, secciones de datos,
 * tablas y listas, de modo que nunca quede toda la información en una sola tarjeta.
 */
function GenericBody({ data, fallbackTitle }: { data: JsonObject; fallbackTitle: string }) {
  const org = useMemo(() => organizeData(data), [data]);

  const facts: HeroFact[] = org.facts.map((f) => ({
    label: f.label,
    value: formatMoney(f.value, f.key),
    strong: f.strong,
  }));
  // Sin datos destacados reconocibles, el resumen muestra cuánta información se encontró.
  const stats: HeroFact[] = [
    { label: 'Campos extraídos', value: String(org.fieldCount) },
    { label: 'Secciones', value: String(org.sections.length + org.people.length) },
    { label: 'Tablas y listados', value: String(org.tables.length + org.lists.length) },
  ].filter((f) => f.value !== '0');

  const hasContent =
    org.people.length + org.sections.length + org.tables.length + org.lists.length > 0;

  return (
    <>
      <HeroCard eyebrow="Documento procesado" title={org.title ?? fallbackTitle} facts={facts.length > 0 ? facts : stats} />

      {!hasContent && (
        <section className="card">
          <p className="muted">No se encontraron datos para mostrar en este documento.</p>
        </section>
      )}

      {org.people.length > 0 && (
        <div className="group">
          <h3 className="group__title">Personas involucradas</h3>
          <div className="parties">
            {org.people.map((p, i) => (
              <PartyCard key={`${p.role}-${i}`} role={p.role} data={p.data} />
            ))}
          </div>
        </div>
      )}

      {org.sections.length > 0 && (
        <div className="group">
          <h3 className="group__title">Datos extraídos</h3>
          <div className="pair">
            {org.sections.map((section, i) => (
              <Card
                key={`${section.title}-${i}`}
                title={section.title}
                subtitle={`${section.entries.length} campos`}
                className={section.entries.length > 6 ? 'result-card--wide' : ''}
              >
                <KeyValueList
                  data={Object.fromEntries(section.entries) as JsonObject}
                  columns={section.entries.length > 6 ? 2 : 1}
                />
              </Card>
            ))}
          </div>
        </div>
      )}

      {(org.tables.length > 0 || org.lists.length > 0) && (
        <div className="group">
          <h3 className="group__title">Tablas y listados</h3>
          <div className="pair">
            {org.tables.map((t, i) => (
              <Card key={`${t.title}-${i}`} title={t.title} subtitle={`${t.rows.length} filas`} className="result-card--wide">
                <DataTable rows={t.rows} />
              </Card>
            ))}
            {org.lists.map((l, i) => (
              <Card key={`${l.title}-${i}`} title={l.title} subtitle={`${l.items.length} elementos`}>
                <Nested value={l.items} />
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function ResultsView({ data, mode, onNew }: Props) {
  const documento = asObject(data.documento);
  const fileLabel = documento
    ? [asText(documento.nombre_archivo), documento.paginas ? `${formatPrimitive(documento.paginas)} pág.` : undefined]
        .filter(Boolean)
        .join(' · ')
    : '';

  const baseName = asText(documento?.nombre_archivo)?.replace(/\.pdf$/i, '') ?? 'extraccion';
  const downloadName = `${baseName}.json`;

  // Si la respuesta viene dentro de un contenedor ({ data: {...} }), se trabaja con su contenido.
  const view = unwrapRoot(data);
  const isPolicy = Boolean(
    asObject(view.poliza) || asObject(view.vehiculo) || asObject(view.primas) || isArrayOfObjects(view.coberturas),
  );

  return (
    <div className="results" aria-live="polite">
      <div className="results__head">
        <div className="results__heading">
          <span className="results__check" aria-hidden="true">
            <CheckIcon width={20} height={20} strokeWidth={2.4} />
          </span>
          <div>
            <h2 className="results__title">Información extraída</h2>
            <p className="muted">
              Procesamiento {mode === 'sync' ? 'síncrono' : 'asíncrono'} completado
              {fileLabel ? ` · ${fileLabel}` : ''}
            </p>
          </div>
        </div>
        <div className="results__actions">
          <button type="button" className="btn btn--ghost" onClick={() => downloadJson(data, downloadName)}>
            <DownloadIcon width={16} height={16} /> Descargar JSON
          </button>
          <button type="button" className="btn btn--primary" onClick={onNew}>
            <RefreshIcon width={16} height={16} /> Procesar otro documento
          </button>
        </div>
      </div>

      {isPolicy ? <PolicyBody data={view} /> : <GenericBody data={view} fallbackTitle={baseName} />}
    </div>
  );
}
