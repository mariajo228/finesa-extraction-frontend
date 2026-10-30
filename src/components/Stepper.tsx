import { CheckIcon } from './icons';

const STEPS = ['Datos', 'Procesamiento', 'Resultados'] as const;

interface Props {
  /** 0 = formulario, 1 = procesando, 2 = resultados */
  current: 0 | 1 | 2;
}

export function Stepper({ current }: Props) {
  return (
    <ol className="stepper" aria-label="Progreso del proceso">
      {STEPS.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li
            key={label}
            className={`stepper__item stepper__item--${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="stepper__dot">{state === 'done' ? <CheckIcon width={14} height={14} strokeWidth={2.4} /> : i + 1}</span>
            <span className="stepper__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
