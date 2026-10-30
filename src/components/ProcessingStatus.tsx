import { useEffect, useState } from 'react';
import type { UiPhase } from '../types/extraction';
import { config } from '../utils/config';
import { CheckIcon } from './icons';

interface Props {
  phase: Extract<UiPhase, { name: 'submitting' | 'polling' }>;
  onCancel: () => void;
}

const clock = (totalSeconds: number) =>
  `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;

/** Segundos transcurridos desde que se montó el componente (empieza al enviar el documento). */
function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return seconds;
}

/**
 * - sync: overlay bloqueante con spinner (pantalla bloqueada hasta recibir la respuesta).
 * - async: panel parcial con línea de tiempo, identificador (correlationId) y tiempo transcurrido.
 */
export function ProcessingStatus({ phase, onCancel }: Props) {
  const elapsed = useElapsedSeconds();

  if (phase.name === 'submitting' && phase.mode === 'sync') {
    return (
      <div className="overlay" role="dialog" aria-modal="true" aria-label="Procesando documento">
        <div className="overlay__box">
          <div className="spinner" aria-hidden="true" />
          <h3>Procesando tu documento…</h3>
          <p className="muted">Esperando la respuesta del servicio. Esto puede tardar unos segundos.</p>
          <span className="badge badge--pending">Tiempo transcurrido · {clock(elapsed)}</span>
          <button type="button" className="btn btn--ghost" onClick={onCancel} autoFocus>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  const polling = phase.name === 'polling';
  const steps = [
    { label: 'Documento enviado', state: polling ? 'done' : 'active' },
    { label: 'Procesando en el servidor', state: polling ? 'active' : 'todo' },
    { label: 'Resultados listos', state: 'todo' },
  ] as const;

  return (
    <section className="card status" aria-live="polite">
      <div className="status__head">
        <div className="spinner spinner--sm" aria-hidden="true" />
        <div>
          <h2 className="card__title">{polling ? 'Tu archivo está en proceso' : 'Enviando documento…'}</h2>
          <p className="muted">
            {polling
              ? 'Consultamos el estado automáticamente cada pocos segundos. Puedes esperar en esta pantalla.'
              : 'Subiendo el PDF y solicitando un identificador de seguimiento.'}
          </p>
        </div>
      </div>

      <ol className="timeline">
        {steps.map((s) => (
          <li key={s.label} className={`timeline__item timeline__item--${s.state}`}>
            <span className="timeline__dot" aria-hidden="true">
              {s.state === 'done' ? <CheckIcon width={13} height={13} strokeWidth={2.6} /> : s.state === 'active' ? <span className="timeline__pulse" /> : null}
            </span>
            <span>{s.label}</span>
          </li>
        ))}
      </ol>

      {phase.name === 'polling' && (
        <dl className="status__meta">
          <div>
            <dt>Identificador (correlationId)</dt>
            <dd><code>{phase.correlationId}</code></dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd><span className="badge badge--pending">PENDING · en proceso</span></dd>
          </div>
          <div>
            <dt>Tiempo transcurrido</dt>
            <dd>{clock(elapsed)} <span className="muted">de {clock(Math.round(config.pollTimeoutMs / 1000))} máx.</span></dd>
          </div>
          <div>
            <dt>Consultas realizadas</dt>
            <dd>{phase.attempt}</dd>
          </div>
        </dl>
      )}

      <div className="progress" aria-hidden="true"><div className="progress__bar" /></div>

      <button type="button" className="btn btn--ghost" onClick={onCancel}>
        Cancelar seguimiento
      </button>
    </section>
  );
}
