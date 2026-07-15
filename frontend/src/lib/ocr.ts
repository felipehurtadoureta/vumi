import { supabase } from './supabase'
import * as pdfjsLib from 'pdfjs-dist'
import Tesseract from 'tesseract.js'

// Configurar worker de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export interface ExtractedMetadata {
  provider_rut?: string              // RUT del centro médico / emisor
  doctor_name?: string               // Nombre del médico tratante
  doctor_rut?: string                // RUT del médico
  recipient_rut?: string             // RUT del receptor / paciente
  banmedica_bonification?: number    // Bonificación Isapre (BonoBanmédica)
  complementario_bonification?: number // Bonificación seguro complementario
}

export interface OCRResult {
  doc_type: 'boleta' | 'orden_medica' | 'liquidacion_banmedica' | 'liquidacion_metlife' | 'otro'
  extracted_date: string | null
  extracted_amount: number | null
  extracted_currency: 'CLP' | 'USD' | 'EUR'
  extracted_provider: string | null
  extracted_receipt_number: string | null
  extracted_patient_name: string | null
  extracted_metadata: ExtractedMetadata
  insurance_hint: 'banmedica' | 'metlife' | 'vumi' | null
  ai_confidence: number
  ocr_raw_text: string
}

// ─────────────────────────────────────────────
// Extracción de texto
// ─────────────────────────────────────────────

async function extractTextFromPDF(buffer: ArrayBuffer): Promise<string> {
  // pdfjs detacha el buffer al tomarlo — usar copia para preservar el original
  const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise
  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .filter((item: any) => 'str' in item)
      .map((item: any) => item.str)
      .join(' ')
    fullText += pageText + '\n'
  }
  return fullText.trim()
}

async function extractTextFromImage(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  // HEIC/HEIF no son procesables por Tesseract en el browser — saltar directamente
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return ''

  const blob = new Blob([buffer], { type: mimeType })
  const url = URL.createObjectURL(blob)
  try {
    // Timeout de 45 segundos para evitar que Tesseract se cuelgue indefinidamente
    const result = await Promise.race([
      Tesseract.recognize(url, 'spa', { logger: () => {} }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Tesseract timeout')), 45_000)
      ),
    ])
    return result.data.text.trim()
  } catch (err: any) {
    console.warn('[OCR] Tesseract falló:', err.message)
    return ''
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ─────────────────────────────────────────────
// Helpers de RUT chileno
// ─────────────────────────────────────────────

// Captura RUTs con o sin puntos de miles, con espacios opcionales (ej: "20. 073.730-K")
// 77.413.290-2 | 77413290-2 | 12.365.644-k | 20. 073.730-K | 8832372-6
const RUT_PATTERN = /\b(\d{1,2}\.?\s*\d{3}\.?\s*\d{3}\s*-\s*[\dkK])\b/

function normalizeRut(raw: string): string {
  // Quitar espacios primero (para "20. 073.730-K" → "20.073.730-K")
  const s = raw.replace(/\s/g, '')
  // Si ya tiene puntos de miles, retornar tal cual
  if (/^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/.test(s)) return s
  // Si viene sin puntos "77413290-2" → "77.413.290-2"
  return s.replace(/^(\d{1,2})(\d{3})(\d{3})([-][\dkK])$/, '$1.$2.$3$4')
}

function findAllRuts(text: string): string[] {
  // Patrón flexible: acepta espacios alrededor de puntos y guión
  const re = /\b(\d{1,2}\.?\s*\d{3}\.?\s*\d{3}\s*-\s*[\dkK])\b/g
  const matches: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    matches.push(normalizeRut(m[1]))
  }
  return [...new Set(matches)]
}

// ─────────────────────────────────────────────
// Parser de documentos médicos chilenos
// ─────────────────────────────────────────────

const MESES: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04',
  mayo: '05', junio: '06', julio: '07', agosto: '08',
  septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
}

function detectDocType(text: string): { doc_type: OCRResult['doc_type']; confidence: number } {
  const u = text.toUpperCase()

  if (u.includes('LIQUIDACION') || u.includes('LIQUIDACIÓN')) {
    if (u.includes('BANMEDICA') || u.includes('BÁNMEDICA') || u.includes('ISAPRE'))
      return { doc_type: 'liquidacion_banmedica', confidence: 0.95 }
    if (u.includes('METLIFE') || u.includes('COMPLEMENTARIO'))
      return { doc_type: 'liquidacion_metlife', confidence: 0.90 }
    return { doc_type: 'liquidacion_banmedica', confidence: 0.60 }
  }

  // BonoBanmédica: comprobante de bonificación isapre (sin palabra "liquidación")
  if ((u.includes('BANMEDICA') || u.includes('BÁNMEDICA')) && u.includes('BONIFICACI'))
    return { doc_type: 'liquidacion_banmedica', confidence: 0.90 }

  if (u.includes('BOLETA') || u.includes('HONORARIOS PROFESIONALES'))
    return { doc_type: 'boleta', confidence: 0.95 }

  if (/\bRP\.?\b/i.test(text) || u.includes('ORDEN MEDICA') || u.includes('RECETA MEDICA'))
    return { doc_type: 'orden_medica', confidence: 0.90 }

  return { doc_type: 'otro', confidence: 0.50 }
}

// Convierte número chileno "40.000" o "40.000,00" a entero 40000
// También acepta "40,000" por si Tesseract intercambia separadores
function parseChileanNumber(raw: string): number | null {
  const s = raw.trim()
    .replace(/\./g, '')    // quitar puntos de miles
    .replace(/,\d+$/, '')  // quitar decimales
    .replace(/,/g, '')     // quitar comas de miles (formato alternativo)
  const val = parseInt(s, 10)
  // Máximo 99 millones — números más grandes son RUTs, no montos médicos
  return (!isNaN(val) && val >= 1000 && val < 100_000_000) ? val : null
}

function extractAmount(text: string): number | null {
  // Número chileno: 1-3 dígitos + grupos de .000 (también acepta ,000 por Tesseract)
  // NO captura números seguidos de guión (ej: 16.021.114-8 = RUT)
  const NUM = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?/

  // Solo busca en contextos etiquetados — nunca un fallback genérico
  const labeled: RegExp[] = [
    new RegExp(`MONTO\\s+TOTAL[^\\d]{0,30}(${NUM.source})`, 'i'),
    new RegExp(`VALOR\\s+TOTAL[^\\d]{0,30}(${NUM.source})`, 'i'),
    new RegExp(`\\bTOTAL\\b[^\\d]{0,50}(${NUM.source})`, 'i'),
    new RegExp(`\\bEXENTO\\b[^\\d]{0,50}(${NUM.source})`, 'i'),
    new RegExp(`HONORARIOS[\\s\\S]{0,80}?(${NUM.source})`, 'i'),
    new RegExp(`\\$\\s*:?\\s*(${NUM.source})`),  // $: 75.000 o $ 75.000
  ]

  for (const p of labeled) {
    const m = text.match(p)
    if (!m) continue
    // Descartar si el número es seguido por guión (formato RUT: 77.583.394-7)
    const endIdx = (m.index ?? 0) + m[0].length
    if (/^-[\dkK]/.test(text.slice(endIdx, endIdx + 3))) continue
    const val = parseChileanNumber(m[1])
    if (val !== null) return val
  }
  return null
}

function extractDate(text: string): string | null {
  // 1. "05 de junio de 2026" / "11 de mayo 2026" (con o sin segundo "de")
  const longDate = text.match(
    /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(\d{4})/i
  )
  if (longDate) {
    const month = MESES[longDate[2].toLowerCase()]
    return `${longDate[3]}-${month}-${longDate[1].padStart(2, '0')}`
  }

  // 2. ISO: 2026-05-18 / 2026-03-24 (año primero, 4 dígitos)
  const iso = text.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  // 3. DD/MM/YYYY o DD-MM-YYYY
  const slashFull = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/)
  if (slashFull) {
    return `${slashFull[3]}-${slashFull[2].padStart(2, '0')}-${slashFull[1].padStart(2, '0')}`
  }

  // 4. DD/MM/YY o DD-MM-YY (año corto)
  const slashShort = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})\b/)
  if (slashShort) {
    const year = parseInt(slashShort[3]) > 50 ? `19${slashShort[3]}` : `20${slashShort[3]}`
    return `${year}-${slashShort[2].padStart(2, '0')}-${slashShort[1].padStart(2, '0')}`
  }

  return null
}

function extractPatient(text: string): string | null {
  // "SEÑOR(ES) : HURTADO URETA LUIS FELIPE" o "SEÑOR(A):"
  const senor = text.match(/SE[ÑN]OR[AES)(\s]*:?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\[\]\.]{4,60})/i)
  if (senor) return senor[1].replace(/\[.*?\]/g, '').trim()

  // "PACIENTE: Juan Pérez" — común en boletas de clínicas
  const paciente = text.match(/PACIENTE\s*:?\s*([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñA-ZÁÉÍÓÚÑ\s]{5,50})/i)
  if (paciente) return paciente[1].trim()

  // "Rp. Luis Felipe Hurtado Ureta" — orden médica
  const rp = text.match(/Rp\.?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúña-zA-Z\s]{5,50})/i)
  if (rp) return rp[1].trim()

  return null
}

function extractProvider(text: string): string | null {
  const lines = text.split(/[\n\r]+/).map((l) => l.trim()).filter(Boolean)

  const institutionKeywords = [
    'CLINICA', 'CLÍNICA', 'HOSPITAL', 'LABORATORIO', 'FARMACIA',
    'CENTRO MEDICO', 'CENTRO MÉDICO', 'SERVICIOS', 'LTDA', 'S.A.',
    'PRESTACIONES', 'ALEMANA', 'INTEGRAL', 'SALUD', 'MÉDICOS', 'MEDICOS',
  ]

  for (const line of lines) {
    const u = line.toUpperCase()
    if (institutionKeywords.some((k) => u.includes(k)) && line.length > 5 && line.length < 100)
      return line.replace(/\[.*?\]/g, '').trim()
  }

  for (const line of lines) {
    if (/^DR[A]?\.\s+/i.test(line) && line.length < 70)
      return line.trim()
  }

  const firstCaps = lines.find((l) => l.length > 8 && /^[A-ZÁÉÍÓÚÑ\s]{8,}$/.test(l))
  if (firstCaps) return firstCaps

  return null
}

function extractDoctorName(text: string): string | null {
  // "MEDICO: DR. NOMBRE" o "MÉDICO TRATANTE: NOMBRE"
  const medico = text.match(
    /M[ÉE]DICO\s*(?:TRATANTE)?\s*:?\s*(DR[A]?\.\s*[A-ZÁÉÍÓÚÑ][A-Za-záéíóúñA-ZÁÉÍÓÚÑ\s\.]{3,50}|[A-ZÁÉÍÓÚÑ][A-Za-záéíóúñA-ZÁÉÍÓÚÑ\s\.]{5,50})/i
  )
  if (medico) return medico[1].trim()

  // "PROFESIONAL: NOMBRE" — parar antes de RUT o dígitos
  const prof = text.match(/PROFESIONAL\s*:?\s*([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s\.]{4,50})(?:\s+RUT|\s+\d|$)/i)
  if (prof) return prof[1].trim()

  // "DR. / DRA. NOMBRE" en línea propia o después de espacio
  const dr = text.match(/\bDR[A]?\.\s+([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñA-ZÁÉÍÓÚÑ\s\.]{3,50})/i)
  if (dr) return `Dr. ${dr[1].trim()}`

  return null
}

/**
 * Extrae y clasifica RUTs de la boleta.
 *
 * Formatos encontrados en boletas chilenas:
 *   R.U.T.: 78.317.440-5          ← RUT emisor (primera aparición con label R.U.T.)
 *   Señor(es): ...  R.U.T.: XX    ← RUT receptor (después de Señor)
 *   Atención / RUT : 8832372-6    ← RUT médico (después de "Atención")
 *   RUT: 16.021.114-8             ← RUT médico inline en descripción
 *   77.225.579-9                  ← RUT bare al inicio (sin label) = emisor
 *   20. 073.730-K                 ← RUT con espacio tras punto (manejado por findAllRuts)
 */
function extractRuts(text: string, docType: OCRResult['doc_type']): ExtractedMetadata {
  const meta: ExtractedMetadata = {}

  // 1. RUT del médico: "Atención\nRUT : XXXX" (Clínica MEDS y similares)
  const atencionRut = text.match(
    /ATENCI[OÓ]N\s+RUT\s*:?\s*([\d.\s]{5,14}-\s*[\dkK])/i
  )
  if (atencionRut) meta.doctor_rut = normalizeRut(atencionRut[1])

  // 2. RUT del médico por etiqueta explícita
  if (!meta.doctor_rut) {
    const medicoRutMatch = text.match(
      /(?:RUT\s*(?:M[ÉE]DICO|PROFESIONAL|DOCTOR|DEL?\s*M[ÉE]DICO))\s*:?\s*([\d.]{5,14}-[\dkK])/i
    )
    if (medicoRutMatch) meta.doctor_rut = normalizeRut(medicoRutMatch[1])
  }

  // 3. RUT del emisor/prestador con etiqueta explícita
  const emisorMatch = text.match(
    /(?:R\.?U\.?T\.?\s*(?:EMISOR|PRESTADOR|DEL?\s*PROVEEDOR|EMPRESA)|RUT\s*EMPRESA)\s*:?\s*([\d.]{5,14}-[\dkK])/i
  )
  if (emisorMatch) meta.provider_rut = normalizeRut(emisorMatch[1])

  // 4. RUT del receptor con etiqueta explícita
  const receptorMatch = text.match(
    /(?:R\.?U\.?T\.?\s*(?:RECEPTOR|PACIENTE|CLIENTE|DEL?\s*PACIENTE)|RUT\s*RECEPTOR)\s*:?\s*([\d.]{5,14}-[\dkK])/i
  )
  if (receptorMatch) meta.recipient_rut = normalizeRut(receptorMatch[1])

  // 5. Fallback por posición: todos los RUTs en orden de aparición
  const allRuts = findAllRuts(text)
  if (allRuts.length >= 1 && !meta.provider_rut && docType === 'boleta')
    meta.provider_rut = allRuts[0]
  if (allRuts.length >= 2 && !meta.recipient_rut)
    meta.recipient_rut = allRuts[1]
  if (allRuts.length >= 3 && !meta.doctor_rut)
    meta.doctor_rut = allRuts[2]

  // Nombre del médico
  const doctorName = extractDoctorName(text)
  if (doctorName) meta.doctor_name = doctorName

  return meta
}

/**
 * Extrae bonificaciones desde liquidaciones BanMédica.
 * "Bonificación Isapre : 23.826"
 * "Bonificación Complementario : 37.088"
 */
function extractBonifications(text: string): { isapre?: number; complementario?: number } {
  const result: { isapre?: number; complementario?: number } = {}

  // Parser que acepta 0 (distinto de parseChileanNumber que exige >= 1000)
  const parseBonif = (raw: string): number | null => {
    const s = raw.trim().replace(/\./g, '').replace(/,\d+$/, '')
    const val = parseInt(s, 10)
    return !isNaN(val) && val >= 0 ? val : null
  }

  const NUM = /[\d.]+/
  const isapreM = text.match(new RegExp(`BONIFICACI[OÓ]N\\s+ISAPRE\\s*:?\\s*(${NUM.source})`, 'i'))
  if (isapreM) {
    const v = parseBonif(isapreM[1])
    if (v !== null) result.isapre = v
  }

  const compM = text.match(new RegExp(`BONIFICACI[OÓ]N\\s+(?:SEGURO\\s+)?COMPLEMENTARIO\\s*:?\\s*(${NUM.source})`, 'i'))
  if (compM) {
    const v = parseBonif(compM[1])
    if (v !== null) result.complementario = v
  }

  return result
}

function extractReceiptNumber(text: string): string | null {
  // stripNum: quita puntos de miles (72.655 → 72655), espacios
  const stripNum = (s: string) => s.replace(/\./g, '').replace(/\s/g, '')

  const patterns: RegExp[] = [
    /N\s*[°º]\.?\s*:?\s*([\d.]+)/i,  // Nº: 17220 / N °: 5721 / Nº 2
    /FOLIO\s*:?\s*([\d.]+)/i,         // FOLIO: 17276
    /N[ÚU]MERO\s*:?\s*([\d.]+)/i,    // NÚMERO: 72.655 / NUMERO: 2
    /\bNRO\.?\s*:?\s*([\d.]+)/i,     // NRO: 17276
    /\bN[°º]\s+([\d.]+)/i,           // N° 5721 (sin dos puntos)
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      const num = stripNum(m[1])
      if (num.length >= 1) return num
    }
  }
  return null
}

function detectInsuranceHint(text: string): OCRResult['insurance_hint'] {
  const u = text.toUpperCase()
  if (u.includes('BANMEDICA') || u.includes('BÁNMEDICA')) return 'banmedica'
  if (u.includes('METLIFE')) return 'metlife'
  if (u.includes('VUMI')) return 'vumi'
  return null
}

function parseDocument(rawText: string): OCRResult {
  const { doc_type, confidence } = detectDocType(rawText)
  const meta = extractRuts(rawText, doc_type)

  // Bonificaciones: siempre intentar extraer (solo se guardan si se encuentran)
  const bonif = extractBonifications(rawText)
  if (bonif.isapre != null) meta.banmedica_bonification = bonif.isapre
  if (bonif.complementario != null) meta.complementario_bonification = bonif.complementario

  return {
    doc_type,
    extracted_date: extractDate(rawText),
    extracted_amount: extractAmount(rawText),
    extracted_currency: 'CLP',
    extracted_provider: extractProvider(rawText),
    extracted_receipt_number: extractReceiptNumber(rawText),
    extracted_patient_name: extractPatient(rawText),
    extracted_metadata: meta,
    insurance_hint: detectInsuranceHint(rawText),
    ai_confidence: confidence,
    ocr_raw_text: rawText,
  }
}

// ─────────────────────────────────────────────
// Vision IA — Claude (principal) + Gemini (fallback)
// ─────────────────────────────────────────────

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const chunks: string[] = []
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length))))
  }
  return btoa(chunks.join(''))
}

// Extrae el JPEG embebido directamente del binario del PDF (boletas escaneadas típicas).
// Mucho más rápido que renderizar via pdfjs. Devuelve null si el PDF no tiene JPEG directo.
function extractJpegFromPdf(buf: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buf)
  // Buscar inicio del JPEG: FF D8 FF
  let start = -1
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
      start = i; break
    }
  }
  if (start < 0) return null
  // Buscar fin del JPEG: FF D9
  let end = -1
  for (let i = bytes.length - 2; i >= start; i--) {
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD9) {
      end = i + 2; break
    }
  }
  if (end < 0) return null
  // Convertir a base64 data URL
  const jpeg = bytes.slice(start, end)
  const chunks: string[] = []
  for (let i = 0; i < jpeg.length; i += 8192)
    chunks.push(String.fromCharCode(...jpeg.subarray(i, Math.min(i + 8192, jpeg.length))))
  return `data:image/jpeg;base64,${btoa(chunks.join(''))}`
}

// Convierte la primera página de un PDF a imagen JPEG via pdfjs (fallback)
async function pdfPageToDataUrl(buf: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const page = await pdf.getPage(1)
  const scale = 2.0
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')!
  await page.render({ canvasContext: ctx, viewport, canvas }).promise
  return canvas.toDataURL('image/jpeg', 0.88)
}

// Prepara imagen o PDF para enviar a Vision IA (redimensiona si hace falta)
async function prepareImageDataUrl(buf: ArrayBuffer, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf') {
    // Siempre renderizar la página completa via pdfjs.
    // NO usar extractJpegFromPdf: muchas boletas tienen imágenes embebidas (ej: Timbre SII/barcode)
    // que son el único JPEG del PDF — enviar solo el barcode a la IA da resultados vacíos.
    return pdfPageToDataUrl(buf)
  }
  return new Promise((resolve, reject) => {
    const blob = new Blob([buf], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const MAX = 1800
      const scale = Math.min(1, MAX / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.88))
    }
    img.onerror = reject
    img.src = url
  })
}

const VISION_PROMPT = `Analiza este documento médico chileno. Responde SOLO con JSON válido (sin markdown):
{
  "numero_boleta": "<número de boleta, bono o folio — SOLO dígitos, sin puntos ni espacios> o null",
  "monto": <VALOR TOTAL de la prestación en CLP como entero sin puntos — en bonos Banmédica es el campo 'Valor' o 'Totales Valor', NUNCA el Copago ni 'A Pagar'> o null,
  "fecha": "<fecha de emisión o atención en formato YYYY-MM-DD>" o null,
  "rut_centro": "<RUT del ESTABLECIMIENTO emisor (clínica, farmacia, laboratorio, institución) — NO el RUT del paciente ni del médico> o null",
  "rut_medico": "<RUT del médico o profesional tratante — si aparece explícito> o null",
  "nombre_paciente": "<nombre completo del paciente — buscar en campos PACIENTE, SEÑOR/ES, Afiliado, Beneficiario> o null",
  "tipo_doc": "boleta" | "bono_banmedica" | "orden_medica" | "liquidacion_banmedica" | "otro",
  "bonif_isapre": <entero CLP que cubre la isapre/financiador — campo 'Bonificación Financiador' en bonos> o null,
  "bonif_complementario": <entero CLP que cubre el seguro complementario — campo 'Otra Bonificación' en bonos> o null
}
IMPORTANTE:
- monto = valor TOTAL de la prestación, no lo que paga el paciente (copago)
- En "Bono de Atención Ambulatoria" Banmédica: monto = columna "Valor" del total, bonif_isapre = "Bonificación Financiador", bonif_complementario = "Otra Bonificación"
- rut_centro es el RUT del negocio/institución emisora, NO del paciente`

// Normaliza fechas al formato YYYY-MM-DD (acepta DD/MM/YYYY, DD-MM-YYYY, etc.)
function normalizeDate(raw: string | null): string | null {
  if (!raw) return null
  // Ya está en formato ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  // DD/MM/YYYY o DD-MM-YYYY
  const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
  return raw
}

function parseVisionJSON(raw: string): OCRResult | null {
  try {
    const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const p = JSON.parse(jsonStr)
    const meta: ExtractedMetadata = {}
    if (p.rut_centro)              meta.provider_rut = p.rut_centro
    if (p.rut_medico)              meta.doctor_rut = p.rut_medico
    if (p.bonif_isapre != null)    meta.banmedica_bonification = Number(p.bonif_isapre)
    if (p.bonif_complementario != null) meta.complementario_bonification = Number(p.bonif_complementario)
    return {
      doc_type:                 p.tipo_doc === 'bono_banmedica' ? 'liquidacion_banmedica' : (p.tipo_doc ?? 'boleta'),
      extracted_date:           normalizeDate(p.fecha),
      extracted_amount:         p.monto != null ? Number(p.monto) : null,
      extracted_currency:       'CLP',
      extracted_provider:       null,
      extracted_receipt_number: p.numero_boleta ? String(p.numero_boleta) : null,
      extracted_patient_name:   p.nombre_paciente ?? null,
      extracted_metadata:       meta,
      insurance_hint:           detectInsuranceHint(raw),
      ai_confidence:            0.93,
      ocr_raw_text:             raw,
    }
  } catch {
    return null
  }
}

// OpenRouter — modelos de visión gratuitos (Gemini 2.0 Flash, Llama Vision, etc.)
// Crear cuenta gratis en openrouter.ai — sin tarjeta de crédito para modelos ":free"
const OPENROUTER_MODELS = [
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'google/gemma-4-26b-a4b-it:free',
]

async function extractViaOpenRouter(buffer: ArrayBuffer, mimeType: string): Promise<OCRResult | null> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY
  if (!apiKey) { console.warn('[OCR] No OPENROUTER_API_KEY'); return null }

  const dataUrl = await prepareImageDataUrl(buffer, mimeType)
  console.log(`[OCR] Imagen preparada: ${Math.round(dataUrl.length / 1024)}KB, tipo: ${mimeType}`)

  for (const model of OPENROUTER_MODELS) {
    try {
      console.log(`[OCR] Intentando modelo: ${model}`)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)

      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://vumi.app',
          'X-Title': 'Vumi Reembolsos',
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text',      text: VISION_PROMPT },
            ],
          }],
          temperature: 0,
        }),
      })

      clearTimeout(timeout)

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        console.warn(`[OCR] ${model} HTTP ${resp.status}:`, errText.slice(0, 300))
        continue
      }

      const data = await resp.json()
      const raw: string = data.choices?.[0]?.message?.content ?? ''
      console.log(`[OCR] ${model} respuesta:`, raw.slice(0, 300))
      const result = parseVisionJSON(raw)
      if (result) { console.log('[OCR] JSON parseado OK'); return result }
      console.warn('[OCR] JSON no parseable:', raw.slice(0, 200))
    } catch (e: any) {
      if (e?.name === 'AbortError') console.warn(`[OCR] ${model} timeout (30s)`)
      else console.warn(`[OCR] ${model} error:`, e)
    }
  }

  console.warn('[OCR] Todos los modelos fallaron — retornando null')
  return null
}

// Gemini directo — intenta múltiples modelos con timeout
const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-001',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
]

async function extractViaGemini(buffer: ArrayBuffer, mimeType: string): Promise<OCRResult | null> {
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!geminiKey) { console.warn('[OCR] No VITE_GEMINI_API_KEY'); return null }

  // Para imágenes: enviar inline. Para PDFs: enviar imagen preparada.
  const isPdf = mimeType === 'application/pdf'
  const imgDataUrl = isPdf ? await prepareImageDataUrl(buffer, mimeType) : null
  const base64 = imgDataUrl
    ? imgDataUrl.split(',')[1]
    : arrayBufferToBase64(buffer)
  const sendMime = isPdf ? 'image/jpeg' : mimeType

  for (const model of GEMINI_MODELS) {
    try {
      console.log(`[OCR] Intentando Gemini modelo: ${model}`)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 25_000)

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: VISION_PROMPT },
              { inline_data: { mime_type: sendMime, data: base64 } },
            ]}],
            generationConfig: { temperature: 0 },
          }),
        }
      )
      clearTimeout(timeout)

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        console.warn(`[OCR] Gemini ${model} HTTP ${resp.status}:`, errText.slice(0, 300))
        continue
      }

      const data = await resp.json()
      const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      console.log(`[OCR] Gemini ${model} respuesta:`, raw.slice(0, 200))
      const result = parseVisionJSON(raw)
      if (result) { console.log('[OCR] Gemini OK con modelo:', model); return result }
      console.warn('[OCR] Gemini JSON no parseable:', raw.slice(0, 200))
    } catch (e: any) {
      if (e?.name === 'AbortError') console.warn(`[OCR] Gemini ${model} timeout (25s)`)
      else console.warn(`[OCR] Gemini ${model} error:`, e)
    }
  }

  console.warn('[OCR] Todos los modelos Gemini fallaron')
  return null
}

// Intenta OpenRouter; si no hay key, intenta Gemini directo como último recurso
async function extractViaVision(buffer: ArrayBuffer, mimeType: string): Promise<OCRResult | null> {
  // OpenRouter: gratis, sin tarjeta de crédito
  const openRouterResult = await extractViaOpenRouter(buffer, mimeType)
  if (openRouterResult) return openRouterResult

  // Gemini directo con múltiples modelos y timeout
  return extractViaGemini(buffer, mimeType)
}

// ─────────────────────────────────────────────
// Función principal
// ─────────────────────────────────────────────

const SUPPORTED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp',
  'image/heic', 'image/heif',
  'application/pdf',
]

const EMPTY_RESULT: OCRResult = {
  doc_type: 'otro', extracted_date: null, extracted_amount: null,
  extracted_currency: 'CLP', extracted_provider: null,
  extracted_receipt_number: null, extracted_patient_name: null,
  extracted_metadata: {}, insurance_hint: null, ai_confidence: 0, ocr_raw_text: '',
}

// Analiza un archivo en memoria sin crear registros en DB.
// Úsalo para el flujo de nuevo caso (upload-first).
export async function analyzeFile(buffer: ArrayBuffer, mimeType: string): Promise<OCRResult> {
  console.log('[OCR] analyzeFile iniciado, mimeType:', mimeType, 'size:', buffer.byteLength)
  try {
    if (mimeType === 'application/pdf') {
      console.log('[OCR] Extrayendo texto del PDF...')
      const rawText = await extractTextFromPDF(buffer)
      console.log('[OCR] Texto extraído:', rawText.length, 'chars:', JSON.stringify(rawText.slice(0, 100)))
      if (rawText && rawText.length >= 10) {
        console.log('[OCR] PDF digital → parseDocument')
        return parseDocument(rawText)
      }
      console.log('[OCR] PDF escaneado → Vision IA')
      return (await extractViaVision(buffer, mimeType)) ?? EMPTY_RESULT
    }
    console.log('[OCR] Imagen → Vision IA')
    return (await extractViaVision(buffer, mimeType)) ?? EMPTY_RESULT
  } catch (err) {
    console.error('[OCR] analyzeFile ERROR:', err)
    return EMPTY_RESULT
  }
}

export async function processDocument(
  docId: string,
  storagePath: string,
  mimeType: string,
): Promise<OCRResult> {
  if (!SUPPORTED_TYPES.includes(mimeType)) {
    const msg = `Tipo no soportado: ${mimeType}`
    await supabase.from('documents').update({ ocr_status: 'failed', ocr_error: msg, needs_review: true }).eq('id', docId)
    throw new Error(msg)
  }

  await supabase.from('documents').update({ ocr_status: 'processing' }).eq('id', docId)

  try {
    const { data: blob, error: downloadErr } = await supabase.storage.from('documents').download(storagePath)
    if (downloadErr) throw downloadErr

    const buffer = await blob.arrayBuffer()

    let result: OCRResult

    if (mimeType === 'application/pdf') {
      const rawText = await extractTextFromPDF(buffer)
      if (rawText && rawText.length >= 10) {
        result = parseDocument(rawText)
      } else {
        const visionResult = await extractViaVision(buffer, mimeType)
        if (!visionResult) throw new Error('PDF sin texto — configura VITE_ANTHROPIC_API_KEY en .env para OCR con IA')
        result = visionResult
      }
    } else {
      const visionResult = await extractViaVision(buffer, mimeType)
      if (visionResult) {
        result = visionResult
      } else {
        const rawText = await extractTextFromImage(buffer, mimeType)
        if (!rawText || rawText.length < 10) {
          throw new Error(
            'No se pudo analizar la imagen. Asegurate de tener VITE_OPENROUTER_API_KEY o VITE_GEMINI_API_KEY configurados en el .env'
          )
        }
        result = parseDocument(rawText)
      }
    }

    await supabase.from('documents').update({
      ocr_status: 'done',
      doc_type: result.doc_type,
      ocr_raw_text: result.ocr_raw_text,
      extracted_date: result.extracted_date,
      extracted_amount: result.extracted_amount,
      extracted_currency: result.extracted_currency,
      extracted_provider: result.extracted_provider,
      extracted_receipt_number: result.extracted_receipt_number,
      extracted_patient_name: result.extracted_patient_name,
      extracted_metadata: result.extracted_metadata,
      insurance_hint: result.insurance_hint,
      ai_confidence: result.ai_confidence,
      needs_review: result.ai_confidence < 0.75,
    }).eq('id', docId)

    return result
  } catch (err: any) {
    await supabase.from('documents').update({
      ocr_status: 'failed',
      ocr_error: err.message,
      needs_review: true,
    }).eq('id', docId)
    throw err
  }
}
