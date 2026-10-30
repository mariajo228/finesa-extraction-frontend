import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { DOC_TYPES, type DocType, type ExtractionRequest, type ProcessingMode } from '../types/extraction';
import { config } from '../utils/config';
import {
  formatBytes,
  validateDocId,
  validateDocType,
  validateFileBasic,
  validateFileStrict,
  type FormErrors,
} from '../utils/validation';
import { FileIcon, LayersIcon, ScanIcon, UploadIcon, ZapIcon } from './icons';

interface Props {
  disabled: boolean;
  onSubmit: (input: ExtractionRequest, mode: ProcessingMode) => void;
}

const MAX_MB = Math.round(config.maxFileBytes / 1024 / 1024);

export function UploadForm({ disabled, onSubmit }: Props) {
  const [docType, setDocType] = useState<DocType | ''>('');
  const [docId, setDocId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ProcessingMode>('sync');
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const setError = (field: keyof FormErrors, message?: string) =>
    setErrors((prev) => ({ ...prev, [field]: message }));

  // ---- validación en tiempo real ----
  const handleDocType = (e: ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as DocType | '';
    setDocType(value);
    setTouched((t) => ({ ...t, docType: true, docId: t.docId }));
    setError('docType', validateDocType(value));
    if (touched.docId) setError('docId', validateDocId(docId, value));
  };

  const handleDocId = (e: ChangeEvent<HTMLInputElement>) => {
    // Se permiten solo dígitos y guion mientras se escribe.
    const value = e.target.value.replace(/[^\d-]/g, '');
    setDocId(value);
    setTouched((t) => ({ ...t, docId: true }));
    setError('docId', validateDocId(value, docType));
  };

  const acceptFile = async (candidate: File | null) => {
    setTouched((t) => ({ ...t, file: true }));
    const basic = validateFileBasic(candidate);
    if (basic) {
      setFile(null);
      setError('file', basic);
      return;
    }
    const strict = await validateFileStrict(candidate);
    if (strict) {
      setFile(null);
      setError('file', strict);
      return;
    }
    setFile(candidate);
    setError('file', undefined);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    void acceptFile(e.target.files?.[0] ?? null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    void acceptFile(e.dataTransfer.files?.[0] ?? null);
  };

  const clearFile = () => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
    // Quitar el archivo no es un error del usuario: se limpia el mensaje hasta el próximo envío.
    setError('file', undefined);
    setTouched((t) => ({ ...t, file: false }));
  };

  // El botón siempre está habilitado: al enviar se validan todos los campos y se muestra
  // exactamente qué falta, en lugar de dejar al usuario con un botón gris sin explicación.
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: FormErrors = {
      docType: validateDocType(docType),
      docId: validateDocId(docId, docType),
      file: await validateFileStrict(file),
    };
    setErrors(next);
    setTouched({ docType: true, docId: true, file: true });
    if (next.docType || next.docId || next.file || !file || !docType) return;
    onSubmit({ file, docType, docId: docId.trim() }, mode);
  };

  const show = (field: keyof FormErrors) => (touched[field] ? errors[field] : undefined);

  return (
    <form className="card form" onSubmit={handleSubmit} noValidate aria-label="Formulario de carga de documento">
      <header className="form__head">
        <span className="form__icon" aria-hidden="true">
          <FileIcon width={20} height={20} />
        </span>
        <div>
          <h2 className="card__title">Datos del documento</h2>
          <p className="muted">Completa los datos y adjunta el PDF para extraer su información.</p>
        </div>
      </header>

      <div className="form__row">
        <div className="field">
          <label htmlFor="docType">Tipo de documento</label>
          <select
            id="docType"
            value={docType}
            onChange={handleDocType}
            onBlur={() => {
              setTouched((t) => ({ ...t, docType: true }));
              setError('docType', validateDocType(docType));
            }}
            disabled={disabled}
            aria-invalid={Boolean(show('docType'))}
            aria-describedby="docType-error"
          >
            <option value="">Selecciona…</option>
            {DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <p id="docType-error" className="field__error" role="alert">
            {show('docType')}
          </p>
        </div>

        <div className="field">
          <label htmlFor="docId">Número de identificación</label>
          <input
            id="docId"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Ej. 1063009710"
            maxLength={17}
            value={docId}
            onChange={handleDocId}
            onBlur={() => {
              setTouched((t) => ({ ...t, docId: true }));
              setError('docId', validateDocId(docId, docType));
            }}
            disabled={disabled}
            aria-invalid={Boolean(show('docId'))}
            aria-describedby="docId-error"
          />
          <p id="docId-error" className="field__error" role="alert">
            {show('docId')}
          </p>
        </div>
      </div>

      <div className="field">
        <label htmlFor="file">Documento PDF</label>
        <div
          className={`dropzone${dragging ? ' dropzone--active' : ''}${show('file') ? ' dropzone--error' : ''}${file ? ' dropzone--filled' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          {file ? (
            <div className="dropzone__file">
              <span className="dropzone__badge dropzone__badge--file" aria-hidden="true">
                <FileIcon width={22} height={22} />
              </span>
              <div>
                <strong>{file.name}</strong>
                <div className="muted">{formatBytes(file.size)} · PDF</div>
              </div>
              <button type="button" className="btn btn--ghost btn--sm" onClick={clearFile} disabled={disabled}>
                Quitar
              </button>
            </div>
          ) : (
            <label htmlFor="file" className="dropzone__prompt">
              <span className="dropzone__badge" aria-hidden="true">
                <UploadIcon width={22} height={22} />
              </span>
              <span>
                <strong>Haz clic para elegir</strong> o arrastra un PDF aquí
              </span>
              <span className="muted">Solo .pdf · máximo {MAX_MB} MB</span>
            </label>
          )}
          <input
            ref={inputRef}
            id="file"
            className="sr-only"
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFileChange}
            disabled={disabled}
            aria-invalid={Boolean(show('file'))}
            aria-describedby="file-error"
          />
        </div>
        <p id="file-error" className="field__error" role="alert">
          {show('file')}
        </p>
      </div>

      <fieldset className="field mode" disabled={disabled}>
        <legend>Modalidad de procesamiento</legend>
        <label className={`mode__option${mode === 'sync' ? ' mode__option--on' : ''}`}>
          <input type="radio" name="mode" value="sync" checked={mode === 'sync'} onChange={() => setMode('sync')} />
          <span className="mode__icon" aria-hidden="true"><ZapIcon width={18} height={18} /></span>
          <span>
            <strong>Síncrona</strong>
            <small>Espera la respuesta en la misma petición.</small>
          </span>
        </label>
        <label className={`mode__option${mode === 'async' ? ' mode__option--on' : ''}`}>
          <input type="radio" name="mode" value="async" checked={mode === 'async'} onChange={() => setMode('async')} />
          <span className="mode__icon" aria-hidden="true"><LayersIcon width={18} height={18} /></span>
          <span>
            <strong>Asíncrona</strong>
            <small>Recibe un identificador y consulta el estado (polling).</small>
          </span>
        </label>
      </fieldset>

      <button type="submit" className="btn btn--primary btn--lg" disabled={disabled}>
        <ScanIcon width={18} height={18} /> Extraer información
      </button>
    </form>
  );
}
