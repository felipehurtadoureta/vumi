// ============================================================
// VUMI — Índice de medicamentos en órdenes médicas / recetas
//
// Las órdenes no pasan por el OCR de boletas, así que su contenido no
// queda en la BD. Este módulo transcribe cada orden UNA vez y guarda el
// resultado dentro de documents.extracted_metadata (no toca ninguna otra
// columna), para poder buscar un remedio y abrir el archivo original.
//
// Claves que agrega a extracted_metadata:
//   medicamentos   string[]  — fármacos detectados (o ingresados a mano)
//   texto_indexado string    — transcripción del documento (recortada)
//   indice_fuente  'pdf' | 'ia' | 'manual'
//   indexado_at    ISO timestamp
//   indice_error   string    — si la lectura falló
// ============================================================

import { supabase } from './supabase'
import {
  extractTextFromPDF, prepareImageDataUrl, OPENROUTER_MODELS, GEMINI_MODELS,
} from './ocr'

export interface MedIndex {
  medicamentos?: string[]
  texto_indexado?: string
  indice_fuente?: 'pdf' | 'ia' | 'manual'
  indexado_at?: string
  indice_error?: string
}

const MAX_TEXT = 6000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Formato de texto plano (no JSON): los modelos gratuitos rompen el JSON con
// frecuencia al transcribir textos largos con comillas o saltos de línea.
const ORDER_PROMPT = `Transcribe esta orden médica o receta chilena usando EXACTAMENTE este formato:

MEDICAMENTOS:
- <fármaco tal como aparece: nombre comercial y/o genérico, con dosis si figura>
- <otro fármaco>

TEXTO:
<todo el texto legible del documento, en orden>

REGLAS:
- No inventes ni completes nombres. Si una palabra no se lee, escribe [ilegible].
- Si el documento no indica medicamentos (por ejemplo, una orden de examen), escribe "- ninguno" bajo MEDICAMENTOS.
- No agregues comentarios ni explicaciones fuera de ese formato.`

/** Minúsculas y sin tildes, para comparar "Clotiazepám" con "clotiazepam". */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Interpreta la respuesta con tolerancia: si no viene el formato, guarda todo como texto. */
function parseOrderText(raw: string): { medicamentos: string[]; texto: string } | null {
  const clean = raw.replace(/```[a-z]*\n?/gi, '').trim()
  if (clean.length < 5) return null

  // Por si algún modelo responde igual en JSON
  if (clean.startsWith('{')) {
    try {
      const p = JSON.parse(clean)
      const meds = Array.isArray(p.medicamentos) ? p.medicamentos.map((m: unknown) => String(m).trim()).filter(Boolean) : []
      return { medicamentos: meds, texto: String(p.texto ?? clean) }
    } catch { /* sigue como texto */ }
  }

  const medsMatch = clean.match(/MEDICAMENTOS\s*:?\s*\n([\s\S]*?)(?:\n\s*TEXTO\s*:|$)/i)
  const textMatch = clean.match(/TEXTO\s*:?\s*\n?([\s\S]*)$/i)
  const medicamentos = (medsMatch?.[1] ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*[-•*\d.)]+\s*/, '').trim())
    .filter((l) => l && !/^ninguno\.?$/i.test(l) && !/^\[?ilegible\]?$/i.test(l))
  const texto = (textMatch?.[1] ?? clean).trim()
  return { medicamentos, texto }
}

interface VisionImage { base64: string; mime: string; dataUrl: string; note?: string }

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
  return btoa(chunks.join(''))
}

async function prepareImage(buffer: ArrayBuffer, mimeType: string): Promise<VisionImage> {
  // Formatos que el navegador no puede abrir para convertir (HEIC) se envían tal cual:
  // solo Gemini los acepta.
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    return { base64: toBase64(buffer), mime: mimeType, dataUrl: '' }
  }

  if (mimeType === 'application/pdf') {
    try {
      // slice(0): PDF.js "consume" el buffer y lo necesitamos intacto para el respaldo
      const dataUrl = await prepareImageDataUrl(buffer.slice(0), mimeType)
      return { base64: dataUrl.split(',')[1], mime: 'image/jpeg', dataUrl }
    } catch (e: any) {
      // Respaldo: Gemini lee el PDF completo directamente, sin convertirlo a imagen
      return {
        base64: toBase64(buffer),
        mime: 'application/pdf',
        dataUrl: '',
        note: `No se pudo convertir el PDF a imagen (${e?.message ?? 'error'})`,
      }
    }
  }

  try {
    const dataUrl = await prepareImageDataUrl(buffer, mimeType)
    return { base64: dataUrl.split(',')[1], mime: 'image/jpeg', dataUrl }
  } catch (e: any) {
    throw new Error(`No se pudo preparar la imagen (${mimeType}): ${e?.message ?? 'error'}`)
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), ms)
  try { return await fetch(url, { ...init, signal: controller.signal }) }
  finally { clearTimeout(t) }
}

// Los modelos gratuitos se retiran y renombran seguido (de ahí los HTTP 404), así que
// en vez de confiar en una lista fija se consulta cuáles están vigentes. Si la consulta
// falla se usan las listas fijas de ocr.ts.
let orModelsCache: string[] | null = null
let geminiModelsCache: string[] | null = null

async function discoverOpenRouterModels(): Promise<string[]> {
  if (orModelsCache) return orModelsCache
  try {
    const resp = await fetchWithTimeout('https://openrouter.ai/api/v1/models', {}, 15_000)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const found: string[] = (data.data ?? [])
      .filter((m: any) => typeof m.id === 'string' && m.id.endsWith(':free'))
      .filter((m: any) => (m.architecture?.input_modalities ?? []).includes('image')
        || String(m.architecture?.modality ?? '').split('->')[0].includes('image'))
      .map((m: any) => m.id)
    orModelsCache = found.length ? found.slice(0, 5) : [...OPENROUTER_MODELS]
  } catch {
    orModelsCache = [...OPENROUTER_MODELS]
  }
  return orModelsCache
}

async function discoverGeminiModels(key: string): Promise<string[]> {
  if (geminiModelsCache) return geminiModelsCache
  try {
    const resp = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${key}`, {}, 15_000)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const names: string[] = (data.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m: any) => String(m.name).replace(/^models\//, ''))
      .filter((n: string) => /^gemini-/.test(n) && /flash/.test(n) && !/(image|tts|live|audio|thinking|exp|robotics|computer|embedding)/.test(n))
    const version = (n: string) => parseFloat(n.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? '0')
    const stable = (n: string) => !/(preview|latest)/.test(n)
    // Más nuevos primero; estables antes que previews; "flash" completo antes que "lite"
    names.sort((a, b) =>
      version(b) - version(a) || Number(stable(b)) - Number(stable(a)) ||
      Number(/lite/.test(a)) - Number(/lite/.test(b)))
    geminiModelsCache = names.length ? names.slice(0, 4) : [...GEMINI_MODELS]
  } catch {
    geminiModelsCache = [...GEMINI_MODELS]
  }
  return geminiModelsCache
}

/** Devuelve la respuesta del modelo, o null; anota en `log` por qué falló cada intento. */
async function visionViaOpenRouter(img: VisionImage, log: string[]): Promise<string | null> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY
  if (!apiKey) { log.push('OpenRouter: sin clave'); return null }
  if (!img.dataUrl) return null // HEIC / PDF sin convertir: solo Gemini
  const models = await discoverOpenRouterModels()
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://vumi.app',
            'X-Title': 'Vumi Reembolsos',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: [
              { type: 'image_url', image_url: { url: img.dataUrl } },
              { type: 'text', text: ORDER_PROMPT },
            ]}],
            temperature: 0,
          }),
        }, 30_000)
        if (resp.status === 429 && attempt === 0) { await sleep(8_000); continue }
        if (!resp.ok) { log.push(`${model}: HTTP ${resp.status}`); break }
        const data = await resp.json()
        const raw: string = data.choices?.[0]?.message?.content ?? ''
        if (parseOrderText(raw)) return raw
        log.push(`${model}: respuesta vacía`)
        break
      } catch (e: any) {
        log.push(`${model}: ${e?.name === 'AbortError' ? 'sin respuesta en 30 s' : e?.message ?? 'error'}`)
        break
      }
    }
  }
  return null
}

async function visionViaGemini(img: VisionImage, log: string[]): Promise<string | null> {
  const key = import.meta.env.VITE_GEMINI_API_KEY
  if (!key) { log.push('Gemini: sin clave'); return null }
  const models = await discoverGeminiModels(key)
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [
                { text: ORDER_PROMPT },
                { inline_data: { mime_type: img.mime, data: img.base64 } },
              ]}],
              generationConfig: { temperature: 0 },
            }),
          },
          30_000,
        )
        if (resp.status === 429 && attempt === 0) { await sleep(8_000); continue }
        if (!resp.ok) { log.push(`${model}: HTTP ${resp.status}`); break }
        const data = await resp.json()
        const raw: string = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? ''
        if (parseOrderText(raw)) return raw
        log.push(`${model}: respuesta vacía`)
        break
      } catch (e: any) {
        log.push(`${model}: ${e?.name === 'AbortError' ? 'sin respuesta en 30 s' : e?.message ?? 'error'}`)
        break
      }
    }
  }
  return null
}

/** Lee una orden/receta y devuelve su índice (sin guardar nada). */
export async function transcribeOrder(buffer: ArrayBuffer, mimeType: string): Promise<MedIndex> {
  // PDF digital: el texto ya viene en el archivo, no hace falta IA.
  if (mimeType === 'application/pdf') {
    const text = await extractTextFromPDF(buffer)
    if (text && text.length >= 30) {
      return { medicamentos: [], texto_indexado: text.slice(0, MAX_TEXT), indice_fuente: 'pdf' }
    }
  }

  const img = await prepareImage(buffer, mimeType)
  const log: string[] = img.note ? [img.note] : []
  // HEIC solo lo acepta Gemini; para el resto, OpenRouter primero
  const raw = img.dataUrl
    ? (await visionViaOpenRouter(img, log)) ?? (await visionViaGemini(img, log))
    : (await visionViaGemini(img, log))
  const parsed = raw ? parseOrderText(raw) : null
  if (!parsed) throw new Error(log.join(' · ') || 'Ningún modelo pudo leer el documento')
  return {
    medicamentos: parsed.medicamentos,
    texto_indexado: parsed.texto.slice(0, MAX_TEXT),
    indice_fuente: 'ia',
  }
}

/** Mezcla el índice en extracted_metadata, conservando las claves existentes. */
async function saveIndex(docId: string, currentMeta: Record<string, unknown> | null, idx: MedIndex) {
  const next = { ...(currentMeta ?? {}), ...idx, indexado_at: new Date().toISOString() }
  if (!idx.indice_error) delete (next as any).indice_error
  const { error } = await supabase.from('documents').update({ extracted_metadata: next }).eq('id', docId)
  if (error) throw error
  return next
}

/** Descarga el archivo, lo transcribe y guarda el índice. Nunca lanza: registra el error. */
export async function indexDocument(doc: {
  id: string
  storage_path: string
  mime_type: string
  extracted_metadata: Record<string, unknown> | null
}): Promise<Record<string, unknown>> {
  try {
    const { data: blob, error } = await supabase.storage.from('documents').download(doc.storage_path)
    if (error || !blob) throw error ?? new Error('No se pudo descargar el archivo')
    const idx = await transcribeOrder(await blob.arrayBuffer(), doc.mime_type)
    return await saveIndex(doc.id, doc.extracted_metadata, idx)
  } catch (e: any) {
    console.warn('[MedIndex] indexDocument falló:', e?.message)
    return await saveIndex(doc.id, doc.extracted_metadata, {
      ...(doc.extracted_metadata as MedIndex | null),
      indice_error: e?.message ?? 'Error desconocido',
    }).catch(() => doc.extracted_metadata ?? {})
  }
}

/** Corrección manual de la lista de medicamentos (para recetas manuscritas mal leídas). */
export async function saveManualMeds(
  docId: string,
  currentMeta: Record<string, unknown> | null,
  medicamentos: string[],
) {
  return saveIndex(docId, currentMeta, {
    ...(currentMeta as MedIndex | null),
    medicamentos,
    indice_fuente: 'manual',
    indice_error: undefined,
  })
}

export function isIndexed(meta: Record<string, unknown> | null | undefined): boolean {
  return !!meta && typeof (meta as MedIndex).indexado_at === 'string' && !(meta as MedIndex).indice_error
}
