import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ApiError } from '../api/httpClient';
import type { PdfTextItem } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Lee un PDF en el navegador (sin enviarlo a ningún servidor) y devuelve cada fragmento de
 * texto con su posición. La posición es lo que permite reconstruir "etiqueta -> valor".
 */
export async function readPdfItems(
  file: File,
): Promise<{ items: PdfTextItem[]; pages: number }> {
  const data = new Uint8Array(await file.arrayBuffer());

  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({ data }).promise;
  } catch (err) {
    if (err instanceof Error && err.name === 'PasswordException') {
      throw new ApiError('El PDF está protegido con contraseña.', 'parse');
    }
    throw new ApiError('No se pudo leer el PDF. El archivo puede estar dañado.', 'parse');
  }

  const items: PdfTextItem[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        items.push({
          page: p,
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          w: it.width,
        });
      }
    }
  } finally {
    void doc.destroy();
  }

  if (items.length === 0) {
    throw new ApiError(
      'El PDF no contiene texto seleccionable (parece un documento escaneado). Se necesitaría OCR para leerlo.',
      'parse',
    );
  }
  return { items, pages: doc.numPages };
}
