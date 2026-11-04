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

const ORDER_PROMPT = `Transcribe esta orden médica o receta chilena. Responde SOLO con JSON válido (sin markdown):
{
  "medicamentos": ["<cada fármaco tal como aparece: nombre comercial y/o genérico, con dosis si figura>"],
  "texto": "<transcripción de todo el texto legible del documento, en orden>"
}
REGLAS:
- No inventes ni completes nombres. Si una palabra no se lee, escribe [ilegible].
- Si el documento no indica medicamentos (por ejemplo, una orden de examen), deja "medicamentos" como [].
- Incluye en "texto" también exámenes, indicaciones y el nombre del médico si aparecen.`

/** Minúsculas y sin tildes, para comparar "Clotiazepám" con "clotiazepam". */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function parseOrderJSON(raw: string): { medicamentos: string[]; texto: string } | null {
  try {
    const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const start = jsonStr.indexOf('{')
    const end = jsonStr.lastIndexOf('}')
    const p = JSON.parse(jsonStr.slice(start, end + 1))
    const meds = Array.isArray(p.medicamentos)
      ? p.medicamentos.map((m: unknown) => String(m).trim()).filter(Boolean)
      : []
    return { medicamentos: meds, texto: String(p.texto ?? '').trim() }
  } catch {
    return null
  }
}

async function visionViaOpenRouter(dataUrl: string): Promise<string | null> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY
  if (!apiKey) return null
  for (const model of OPENROUTER_MODELS) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 45_000)
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
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: ORDER_PROMPT },
          ]}],
          temperature: 0,
        }),
      })
      clearTimeout(timeout)
      if (!resp.ok) continue
      const data = await resp.json()
      const raw: string = data.choices?.[0]?.message?.content ?? ''
      if (parseOrderJSON(raw)) return raw
    } catch (e) {
      console.warn(`[MedIndex] ${model} falló:`, e)
    }
  }
  return null
}

async function visionViaGemini(dataUrl: string): Promise<string | null> {
  const key = import.meta.env.VITE_GEMINI_API_KEY
  if (!key) return null
  const base64 = dataUrl.split(',')[1]
  for (const model of GEMINI_MODELS) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 40_000)
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: ORDER_PROMPT },
              { inline_data: { mime_type: 'image/jpeg', data: base64 } },
            ]}],
            generationConfig: { temperature: 0 },
          }),
        },
      )
      clearTimeout(timeout)
      if (!resp.ok) continue
      const data = await resp.json()
      const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (parseOrderJSON(raw)) return raw
    } catch (e) {
      console.warn(`[MedIndex] Gemini ${model} falló:`, e)
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

  const dataUrl = await prepareImageDataUrl(buffer, mimeType)
  const raw = (await visionViaOpenRouter(dataUrl)) ?? (await visionViaGemini(dataUrl))
  const parsed = raw ? parseOrderJSON(raw) : null
  if (!parsed) {
    throw new Error('No se pudo leer el documento (revisa VITE_OPENROUTER_API_KEY / VITE_GEMINI_API_KEY)')
  }
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
