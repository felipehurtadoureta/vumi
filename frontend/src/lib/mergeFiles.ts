import { PDFDocument } from 'pdf-lib'

/** Convierte cualquier imagen a JPEG via canvas (soporta HEIC en Safari/macOS) */
async function imageFileToJpegBytes(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('No se pudo convertir la imagen'))
        blob.arrayBuffer().then(resolve).catch(reject)
      }, 'image/jpeg', 0.92)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`No se pudo cargar ${file.name}`)) }
    img.src = url
  })
}

/**
 * Combina varios archivos (imágenes y PDFs) en un único PDF.
 * Devuelve un Blob PDF listo para subir.
 */
export async function mergeFilesToPdf(files: File[]): Promise<Blob> {
  const merged = await PDFDocument.create()

  for (const file of files) {
    if (file.type === 'application/pdf') {
      // PDF: copiar páginas directamente
      const bytes = await file.arrayBuffer()
      const src   = await PDFDocument.load(bytes)
      const pages = await merged.copyPages(src, src.getPageIndices())
      pages.forEach(p => merged.addPage(p))
    } else {
      // Imagen: embeber como página
      const jpegBytes = await imageFileToJpegBytes(file)
      const img = await merged.embedJpg(jpegBytes)

      // Escalar para que quepa en A4 (595 × 842 pt) manteniendo proporción
      const MAX_W = 595, MAX_H = 842
      const scale = Math.min(1, MAX_W / img.width, MAX_H / img.height)
      const w = img.width  * scale
      const h = img.height * scale

      const page = merged.addPage([w, h])
      page.drawImage(img, { x: 0, y: 0, width: w, height: h })
    }
  }

  const bytes = await merged.save()
  return new Blob([bytes], { type: 'application/pdf' })
}
