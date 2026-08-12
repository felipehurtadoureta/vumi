// ============================================================
// HOJA DE VIDA MÉDICA — Extracción IA de informes de resultados
//
// Módulo autocontenido: NO importa nada de '@/lib/ocr' ni lo
// modifica, para no tocar el flujo de reembolsos existente.
// Usa el mismo enfoque (Gemini directo, gratis) que ya usa el
// resto del proyecto como motor de visión.
// ============================================================

import { pdfjsLib } from '@/lib/pdfWorker'
import { parseSisalud } from './parserSisalud'

export interface InformeOCRValor {
  nombre_valor: string
  valor: number | null
  unidad: string | null
  rango_min: number | null
  rango_max: number | null
}

export interface InformeOCRResult {
  paciente_nombre: string | null
  fecha_examen: string | null       // YYYY-MM-DD
  tipo_examen_codigo: string | null // debe calzar con historial_tipos_examen.codigo, o null
  institucion: string | null
  medico_nombre: string | null
  interpretacion: string | null
  valores: InformeOCRValor[]         // vacío si el informe no trae una tabla de valores numéricos
  confidence: number                // 0..1, heurística simple según campos encontrados
  // 'local': lector de reglas sin IA (instantáneo, gratis, sin cuota).
  // 'ia': algún proveedor de IA (Gemini u OpenRouter) hizo la extracción.
  fuente: 'local' | 'ia'
}

// Códigos válidos — deben coincidir con el seed de la migración 18.
// Si el usuario agrega un tipo nuevo desde la UI, la IA seguirá
// devolviendo 'otro' para esos casos hasta que se actualice este prompt,
// lo cual está bien: el usuario corrige manualmente en el formulario.
const TIPOS_CODIGOS = [
  'sangre', 'orina', 'rx', 'rm', 'tac', 'ecografia',
  'colonoscopia', 'endoscopia', 'mamografia', 'electro', 'consulta', 'otro',
]

// Igual que ocr.ts: la mayoría de los informes médicos son PDFs generados
// digitalmente (no escaneados), así que ya traen el texto embebido. Extraerlo
// es instantáneo, gratis y no depende de red — mucho más confiable que
// convertir a imagen y mandarlo a un modelo de visión. Solo si esto falla
// (PDF escaneado como imagen) se recurre a la IA de visión más abajo.
async function extractTextFromPDFRaw(buf: ArrayBuffer): Promise<string> {
  // pdfjs "consume" (detach) el ArrayBuffer al tomarlo — usar una copia.
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise
  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const items = (content.items as any[]).filter((item) => 'str' in item && item.str.trim() !== '')

    // pdfjs NO separa el texto en líneas visuales por sí solo — entrega
    // todos los fragmentos de texto de la página sueltos, en el orden en
    // que aparecen internamente en el PDF (no necesariamente de arriba
    // hacia abajo). Sin reconstruir las líneas por posición, todo el texto
    // de una página queda pegado en una sola línea gigante, y cualquier
    // parser basado en líneas (como el lector local de SISALUD) no puede
    // reconocer ninguna fila de tabla.
    //
    // Se ordenan todos los fragmentos por Y (de arriba a abajo) y se agrupan
    // comparando cada fragmento con el ANTERIOR ya ordenado (no con un
    // "ancla" fija del grupo) — en una misma fila de tabla, el nombre y los
    // valores a veces tienen un baseline levemente distinto (fuente/tamaño
    // diferente), y comparar solo contra el primer fragmento del grupo podía
    // partir una sola fila visual en dos líneas de texto.
    const TOLERANCE = 3
    const sorted = [...items].sort((a, b) => b.transform[5] - a.transform[5])
    const lineGroups: { y: number; items: any[] }[] = []
    for (const item of sorted) {
      const y = item.transform[5]
      const last = lineGroups[lineGroups.length - 1]
      if (last && Math.abs(last.y - y) <= TOLERANCE) {
        last.items.push(item)
        last.y = y // permite deriva gradual a lo largo de la fila
      } else {
        lineGroups.push({ y, items: [item] })
      }
    }

    for (const group of lineGroups) {
      group.items.sort((a, b) => a.transform[4] - b.transform[4])
      fullText += group.items.map((it) => it.str).join(' ') + '\n'
    }
  }
  return fullText.trim()
}

// Timeout de seguridad: si el worker de PDF.js falla en cargarse o se
// cuelga (visto de forma intermitente cuando conviven dos módulos de OCR
// distintos en el mismo bundle), esto evita que quede atascado
// indefinidamente en vez de caer al respaldo de IA.
async function extractTextFromPDF(buf: ArrayBuffer): Promise<string> {
  try {
    return await Promise.race([
      extractTextFromPDFRaw(buf),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('PDF.js timeout (15s)')), 15_000)
      ),
    ])
  } catch (e: any) {
    console.warn('[HojaDeVida OCR] extractTextFromPDF falló/timeout:', e?.message ?? e)
    return ''
  }
}

async function pdfPageToDataUrlRaw(buf: ArrayBuffer): Promise<string> {
  // pdfjs "consume" (detach) el ArrayBuffer al tomarlo — usar una copia para
  // que el buffer original siga disponible si hay que reintentar con otro proveedor.
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise
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

async function pdfPageToDataUrl(buf: ArrayBuffer): Promise<string> {
  return Promise.race([
    pdfPageToDataUrlRaw(buf),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error('PDF.js render timeout (15s)')), 15_000)
    ),
  ])
}

async function imageFileToDataUrl(buf: ArrayBuffer, mimeType: string): Promise<string> {
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

async function prepareImageDataUrl(buf: ArrayBuffer, mimeType: string): Promise<string> {
  if (mimeType === 'application/pdf') return pdfPageToDataUrl(buf)
  return imageFileToDataUrl(buf, mimeType)
}

const PROMPT = `Analiza este informe de resultado médico (examen de laboratorio, imagenología, consulta, etc.). Responde SOLO con JSON válido, sin markdown:
{
  "paciente_nombre": "<nombre completo del paciente tal como aparece impreso — puede venir como 'APELLIDOS NOMBRES' o 'Nombres Apellidos', respeta el orden del documento>" o null,
  "fecha_examen": "<fecha en que se TOMÓ la muestra o se realizó el examen, en formato YYYY-MM-DD>" o null,
  "tipo_examen_codigo": "<uno de estos códigos exactos: ${TIPOS_CODIGOS.join(', ')}>",
  "institucion": "<nombre del laboratorio, clínica o centro que emite el informe — identifícalo también por el logo si el texto no lo dice explícitamente>" o null,
  "medico_nombre": "<nombre del médico tratante o que solicita el examen — normalmente etiquetado 'Dr.'/'Dra.' junto a los datos del paciente, NO el jefe de laboratorio ni el tecnólogo que firma al final del informe>" o null,
  "interpretacion": "<resumen breve en 1-3 frases. Si el informe tiene una sección explícita de 'Conclusión' o 'Interpretación', úsala. Si es solo una tabla de valores de laboratorio sin conclusión escrita, sintetiza tú: menciona qué valores están fuera de rango; si todos los valores están dentro de rango, dilo brevemente (ej: 'Hemograma dentro de rango normal')>" o null,
  "valores": [
    { "nombre_valor": "<nombre EXACTO de la fila, ej: 'Glucosa', 'Nitrógeno Ureico', 'Urea' — cada fila de la tabla es un valor SEPARADO, nunca combines dos filas distintas en una>", "valor": <número, sin unidad ni texto> o null, "unidad": "<ej: mg/dL>" o null, "rango_min": <número> o null, "rango_max": <número> o null }
  ]
}
IMPORTANTE:
- tipo_examen_codigo: usa "sangre" para hemogramas, perfiles bioquímicos, complemento, PCR, etc. "electro" para electrocardiogramas. "otro" si no calza con ninguno.
- fecha_examen: si el documento distingue "Ingreso" (toma de muestra) de "Informe" (emisión del resultado), usa la fecha de "Ingreso"/muestra, no la de emisión.
- La columna "Res. Anterior" / "Resultado Anterior" en tablas de laboratorio es un valor histórico de un examen previo — NO es el resultado actual, ignórala tanto en interpretacion como en valores.
- "valores": incluye UNA entrada por cada fila numérica de la tabla de resultados, tal como aparece (mismo nombre, mismo número). Si el informe NO trae una tabla de valores (ej: una radiografía, una ecografía descriptiva), deja "valores" como arreglo vacío []. Nunca combines, promedies ni fusiones dos filas distintas en una sola entrada, aunque midan cosas relacionadas.
- No inventes datos: usa null si no aparece claramente en el documento.`

function parseJSON(raw: string): InformeOCRResult | null {
  try {
    const jsonStr = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const p = JSON.parse(jsonStr)
    const codigo = TIPOS_CODIGOS.includes(p.tipo_examen_codigo) ? p.tipo_examen_codigo : null
    const fieldsFound = [p.paciente_nombre, p.fecha_examen, codigo, p.institucion, p.interpretacion]
      .filter(Boolean).length

    const valoresRaw = Array.isArray(p.valores) ? p.valores : []
    const valores: InformeOCRValor[] = valoresRaw
      .filter((v: any) => v && typeof v.nombre_valor === 'string' && v.nombre_valor.trim())
      .map((v: any) => ({
        nombre_valor: String(v.nombre_valor).trim(),
        valor: typeof v.valor === 'number' ? v.valor : (v.valor != null && !isNaN(Number(v.valor)) ? Number(v.valor) : null),
        unidad: v.unidad ?? null,
        rango_min: typeof v.rango_min === 'number' ? v.rango_min : (v.rango_min != null && !isNaN(Number(v.rango_min)) ? Number(v.rango_min) : null),
        rango_max: typeof v.rango_max === 'number' ? v.rango_max : (v.rango_max != null && !isNaN(Number(v.rango_max)) ? Number(v.rango_max) : null),
      }))

    return {
      paciente_nombre: p.paciente_nombre ?? null,
      fecha_examen: p.fecha_examen ?? null,
      tipo_examen_codigo: codigo,
      institucion: p.institucion ?? null,
      medico_nombre: p.medico_nombre ?? null,
      interpretacion: p.interpretacion ?? null,
      valores,
      confidence: Math.min(1, fieldsFound / 5),
      fuente: 'ia',
    }
  } catch {
    return null
  }
}

// Se lanza cuando Gemini responde 429 (cuota gratuita agotada). Al propagarse
// evita que sigamos gastando cupo probando más modelos o el paso de visión:
// pasamos directo al respaldo de OpenRouter.
class GeminiQuotaError extends Error {}

// Gemini directo — mismo modelo/patrón gratuito que usa el resto del proyecto.
// Un solo modelo: reintentar con otro modelo de Gemini no ayuda si el error
// es de cuota (comparten el mismo límite), y solo duplica las llamadas.
const GEMINI_MODELS = ['gemini-2.0-flash']

async function extractViaGemini(buffer: ArrayBuffer, mimeType: string): Promise<InformeOCRResult | null> {
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!geminiKey) { console.warn('[HojaDeVida OCR] No VITE_GEMINI_API_KEY'); return null }

  const isPdf = mimeType === 'application/pdf'
  const imgDataUrl = await prepareImageDataUrl(buffer, mimeType)
  const base64 = imgDataUrl.split(',')[1]
  const sendMime = isPdf ? 'image/jpeg' : mimeType

  for (const model of GEMINI_MODELS) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              { text: PROMPT },
              { inline_data: { mime_type: sendMime, data: base64 } },
            ] }],
            generationConfig: { temperature: 0 },
          }),
        }
      )
      clearTimeout(timeout)
      if (resp.status === 429) throw new GeminiQuotaError('Gemini sin cuota')
      if (!resp.ok) continue

      const data = await resp.json()
      const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      const result = parseJSON(raw)
      if (result) return result
    } catch (e: any) {
      clearTimeout(timeout)
      if (e instanceof GeminiQuotaError) throw e
      console.warn(`[HojaDeVida OCR] Gemini ${model} error:`, e?.message ?? e)
    }
  }
  return null
}

// Extracción por TEXTO (PDF digital con texto embebido) — sin imagen, sin
// visión, solo texto plano al modelo. Mucho más rápido y confiable.
async function extractViaGeminiText(text: string): Promise<InformeOCRResult | null> {
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!geminiKey) return null

  const textPrompt = `${PROMPT}\n\nTexto extraído del documento:\n"""\n${text.slice(0, 6000)}\n"""`

  for (const model of GEMINI_MODELS) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: textPrompt }] }],
            generationConfig: { temperature: 0 },
          }),
        }
      )
      clearTimeout(timeout)
      if (resp.status === 429) throw new GeminiQuotaError('Gemini sin cuota')
      if (!resp.ok) continue

      const data = await resp.json()
      const raw: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      const result = parseJSON(raw)
      if (result) return result
    } catch (e: any) {
      clearTimeout(timeout)
      if (e instanceof GeminiQuotaError) throw e
      console.warn(`[HojaDeVida OCR] Gemini (texto) ${model} error:`, e?.message ?? e)
    }
  }
  return null
}

// OpenRouter — respaldo gratuito con visión. 'openrouter/free' es el router
// automático de OpenRouter: elige al azar entre TODOS los modelos gratis
// disponibles en ese momento filtrando por los que soportan imagen, así que
// se adapta solo aunque el catálogo de modelos gratis cambie.
// IMPORTANTE: la lista se mantiene corta (2 modelos) a propósito — cada
// modelo agregado se prueba en secuencia y suma hasta ~8s más de espera si
// el anterior falla; una lista larga hace que la cadena completa exceda el
// tiempo máximo total que le damos a analyzeInforme() y termine
// "rindiéndose" antes de que un modelo de más atrás alcance a responder.
const OPENROUTER_MODELS = [
  'openrouter/free',
  'google/gemma-4-31b-it:free',
]

// Modelos gratis solo-texto (sin imagen) — más livianos y con menos
// probabilidad de toparse con el límite compartido de los modelos de visión.
// Misma razón que arriba: lista corta para no alargar la cadena total.
const OPENROUTER_TEXT_MODELS = [
  'openrouter/free',
  'meta-llama/llama-3.3-70b-instruct:free',
]

async function extractViaOpenRouter(buffer: ArrayBuffer, mimeType: string): Promise<InformeOCRResult | null> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY
  if (!apiKey) return null

  const dataUrl = await prepareImageDataUrl(buffer, mimeType)

  for (const model of OPENROUTER_MODELS) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8_000)
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://vumi.app',
          'X-Title': 'Vumi Hoja de Vida',
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: PROMPT },
            ],
          }],
          temperature: 0,
        }),
      })
      clearTimeout(timeout)
      if (!resp.ok) continue
      const data = await resp.json()
      const raw: string = data.choices?.[0]?.message?.content ?? ''
      const result = parseJSON(raw)
      if (result) return result
    } catch (e: any) {
      console.warn(`[HojaDeVida OCR] OpenRouter ${model} error:`, e?.message ?? e)
    }
  }
  return null
}

// OpenRouter, solo texto — respaldo cuando ya tenemos el texto del documento
// (extraído localmente vía pdfjs o Tesseract) y solo falta estructurarlo.
async function extractViaOpenRouterText(text: string): Promise<InformeOCRResult | null> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY
  if (!apiKey) return null

  const textPrompt = `${PROMPT}\n\nTexto extraído del documento:\n"""\n${text.slice(0, 6000)}\n"""`

  for (const model of OPENROUTER_TEXT_MODELS) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8_000)
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://vumi.app',
          'X-Title': 'Vumi Hoja de Vida',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: textPrompt }],
          temperature: 0,
        }),
      })
      clearTimeout(timeout)
      if (!resp.ok) continue
      const data = await resp.json()
      const raw: string = data.choices?.[0]?.message?.content ?? ''
      const result = parseJSON(raw)
      if (result) return result
    } catch (e: any) {
      console.warn(`[HojaDeVida OCR] OpenRouter (texto) ${model} error:`, e?.message ?? e)
    }
  }
  return null
}

// Extrae texto de una imagen localmente con Tesseract.js (OCR sin IA, sin
// red, sin límite de cuota). Menos preciso que la visión de un modelo de IA,
// pero sirve como primer intento gratuito e ilimitado antes de gastar cuota.
async function extractTextFromImageLocal(buf: ArrayBuffer, mimeType: string): Promise<string> {
  // HEIC/HEIF no son procesables por Tesseract en el navegador.
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return ''
  const { default: Tesseract } = await import('tesseract.js')
  const blob = new Blob([buf], { type: mimeType })
  const url = URL.createObjectURL(blob)
  try {
    const result = await Promise.race([
      Tesseract.recognize(url, 'spa', { logger: () => {} }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Tesseract timeout')), 12_000)),
    ])
    return result.data.text.trim()
  } catch (e: any) {
    console.warn('[HojaDeVida OCR] Tesseract falló:', e?.message ?? e)
    return ''
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Intenta estructurar un bloque de texto ya extraído (por pdfjs o Tesseract)
// usando primero Gemini y, si no hay resultado, OpenRouter — ambos en modo
// solo-texto, mucho más liviano y confiable que mandar la imagen completa.
// Devuelve también si Gemini avisó cuota agotada, para que el llamador sepa
// si conviene saltarse el resto de los intentos con Gemini.
async function extractViaTexto(text: string): Promise<{ result: InformeOCRResult | null; quotaExceeded: boolean }> {
  let quotaExceeded = false
  try {
    const result = await extractViaGeminiText(text)
    if (result) return { result, quotaExceeded }
  } catch (e: any) {
    if (e instanceof GeminiQuotaError) quotaExceeded = true
    else console.warn('[HojaDeVida OCR] Extracción por texto (Gemini) falló:', e?.message ?? e)
  }
  const result = await extractViaOpenRouterText(text)
  return { result, quotaExceeded }
}

// Analiza un informe médico en memoria. No sube nada ni toca la DB.
// Orden de prioridad, de más a menos confiable/barato:
//   1. Texto ya embebido en el PDF (pdfjs, instantáneo, sin red)
//   1b. Lector local sin IA para formatos de laboratorio reconocidos
//       (ej. SISALUD/Clínica Alemana) — instantáneo, gratis, sin cuota.
//   2. Texto extraído localmente de la imagen (Tesseract, sin red, sin cuota)
//   3. Visión con IA (Gemini, luego OpenRouter) — solo si lo anterior no
//      alcanza, ya que es lo más caro en cuota y lo más propenso a fallar
//      por límites compartidos.
// Si Gemini está sin cuota (429) en cualquier paso, no insiste con más
// llamadas a Gemini — pasa directo a los respaldos de OpenRouter.
export async function analyzeInforme(buffer: ArrayBuffer, mimeType: string): Promise<InformeOCRResult | null> {
  let quotaExceeded = false

  // Paso 1: texto ya embebido (solo PDFs digitales, no escaneados)
  if (mimeType === 'application/pdf') {
    try {
      const text = await extractTextFromPDF(buffer)
      if (text && text.length >= 30) {
        // Paso 1b: si el formato es uno reconocido (sin IA), usarlo directo.
        const sisalud = parseSisalud(text)
        if (sisalud) return sisalud

        const { result, quotaExceeded: q } = await extractViaTexto(text)
        if (q) quotaExceeded = true
        if (result) return result
      }
    } catch (e: any) {
      console.warn('[HojaDeVida OCR] Extracción de texto embebido falló:', e?.message ?? e)
    }
  }

  // Paso 2: OCR local (imágenes y fotos — no aplica a PDFs, ya se intentó su texto embebido arriba)
  if (mimeType !== 'application/pdf') {
    try {
      const text = await extractTextFromImageLocal(buffer, mimeType)
      if (text && text.length >= 30) {
        const { result, quotaExceeded: q } = await extractViaTexto(text)
        if (q) quotaExceeded = true
        if (result) return result
      }
    } catch (e: any) {
      console.warn('[HojaDeVida OCR] OCR local falló:', e?.message ?? e)
    }
  }

  // Paso 3: visión con IA (más caro en cuota, último recurso)
  if (!quotaExceeded) {
    try {
      const geminiResult = await extractViaGemini(buffer, mimeType)
      if (geminiResult) return geminiResult
    } catch (e: any) {
      if (!(e instanceof GeminiQuotaError)) console.warn('[HojaDeVida OCR] Gemini visión falló:', e?.message ?? e)
    }
  }

  return extractViaOpenRouter(buffer, mimeType)
}
