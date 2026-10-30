/** Un fragmento de texto del PDF con su posición en la página (origen abajo-izquierda). */
export interface PdfTextItem {
  page: number;
  str: string;
  x: number;
  y: number;
  /** Ancho del fragmento en puntos. */
  w: number;
}

/** Contexto de la extracción: lo que el usuario escribió en el formulario y datos del archivo. */
export interface ExtractionContext {
  fileName: string;
  pages: number;
  docType: string;
  docId: string;
}
