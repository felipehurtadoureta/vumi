// ============================================================
// Configuración ÚNICA y compartida del worker de PDF.js
//
// Antes, tanto `lib/ocr.ts` (boletas) como
// `hoja-de-vida/lib/ocrInformes.ts` (informes médicos) configuraban
// por su cuenta `pdfjsLib.GlobalWorkerOptions.workerSrc`, cada uno
// calculando la URL relativa a SU PROPIO archivo (`import.meta.url`).
// Como `GlobalWorkerOptions` es un singleton global y la app carga
// ambos módulos en el mismo bundle, cuál de las dos URLs terminaba
// "ganando" dependía del orden de carga de módulos — lo que producía
// fallas intermitentes y difíciles de reproducir al leer boletas
// (a veces el worker no cargaba bien y el sistema caía al respaldo
// de IA, mucho más lento, o directamente se colgaba).
//
// Ahora ambos importan este único módulo, que configura el worker
// una sola vez, de forma determinística.
// ============================================================

import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export { pdfjsLib }
