import { useEffect, useRef } from 'react';
import { ErrorPanel } from './components/ErrorPanel';
import { MoonIcon, ScanIcon, SunIcon } from './components/icons';
import { ProcessingStatus } from './components/ProcessingStatus';
import { ResultsView } from './components/ResultsView';
import { Stepper } from './components/Stepper';
import { UploadForm } from './components/UploadForm';
import { useExtraction } from './hooks/useExtraction';
import { useTheme } from './hooks/useTheme';
import { useToasts } from './hooks/useToasts';
import { config } from './utils/config';

export default function App() {
  const { phase, run, retry, cancel, reset } = useExtraction();
  const toasts = useToasts();
  const { theme, toggle } = useTheme();
  const previous = useRef(phase.name);

  // Notificaciones (toasts) ante cambios de estado relevantes.
  useEffect(() => {
    if (previous.current === phase.name) return;
    if (phase.name === 'success') toasts.push('success', 'Documento procesado correctamente.');
    // El detalle del error se muestra en el panel; el toast solo avisa.
    if (phase.name === 'error') toasts.push('error', 'No se pudo completar la extracción.');
    if (phase.name === 'polling' && previous.current === 'submitting') {
      toasts.push('info', 'Documento recibido. Tu archivo está en proceso.');
    }
    previous.current = phase.name;
  }, [phase, toasts]);

  const busy = phase.name === 'submitting' || phase.name === 'polling';
  const step = phase.name === 'success' ? 2 : busy ? 1 : 0;
  const maxMb = Math.round(config.maxFileBytes / 1024 / 1024);

  return (
    <div className="app">
      <header className="header">
        <div className="header__inner">
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              <ScanIcon width={22} height={22} />
            </span>
            <div>
              <h1>Extracción de documentos</h1>
              <p className="muted">Carga un PDF y obtén su información estructurada.</p>
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <main className="main">
        <Stepper current={step} />

        {(phase.name === 'idle' || busy || phase.name === 'error') && (
          <UploadForm disabled={busy} onSubmit={(input, mode) => void run(input, mode)} />
        )}

        {busy && <ProcessingStatus phase={phase} onCancel={cancel} />}

        {phase.name === 'error' && (
          <ErrorPanel message={phase.message} canRetry={phase.canRetry} onRetry={retry} onBack={reset} />
        )}

        {phase.name === 'success' && <ResultsView data={phase.data} mode={phase.mode} onNew={reset} />}
      </main>

      <footer className="footer">Formato admitido: PDF · Tamaño máximo: {maxMb} MB</footer>
    </div>
  );
}
