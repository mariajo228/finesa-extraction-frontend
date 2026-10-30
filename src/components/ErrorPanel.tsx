import { AlertIcon, RefreshIcon } from './icons';

interface Props {
  message: string;
  canRetry: boolean;
  onRetry: () => void;
  onBack: () => void;
}

export function ErrorPanel({ message, canRetry, onRetry, onBack }: Props) {
  return (
    <section className="card error-panel" role="alert">
      <span className="error-panel__icon">
        <AlertIcon width={22} height={22} />
      </span>
      <div className="error-panel__body">
        <h2 className="card__title">No pudimos completar la extracción</h2>
        <p>{message}</p>
        <div className="error-panel__actions">
          {canRetry && (
            <button type="button" className="btn btn--primary" onClick={onRetry}>
              <RefreshIcon width={16} height={16} /> Reintentar
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onBack}>
            Volver al formulario
          </button>
        </div>
      </div>
    </section>
  );
}
