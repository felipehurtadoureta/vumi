// ============================================================
// HOJA DE VIDA MÉDICA — Chat informativo sobre un informe o el
// historial completo de un paciente.
//
// Usa el mismo Gemini gratuito que el resto del módulo. No es un
// motor de diagnóstico: el prompt de sistema restringe las
// respuestas a observaciones descriptivas, nunca diagnósticos ni
// indicaciones de tratamiento.
// ============================================================

import type { HistorialInforme, HistorialValor, HistorialPerfil } from './types'
import { fmtPerfilBlock } from './perfil'

export interface ChatMessage {
  role: 'user' | 'model'
  text: string
}

const SYSTEM_PROMPT = `Eres un asistente informativo de salud dentro de una app de historial médico familiar (Hoja de Vida Médica).
Respondes preguntas del usuario basándote SOLO en los datos de historial clínico que se te entregan a continuación.

Reglas estrictas:
- NO das diagnósticos médicos, NO interpretas síntomas como enfermedades, NO recomiendas tratamientos ni medicamentos.
- Ofreces información descriptiva: explicar qué significa un valor o un término, señalar tendencias visibles en los datos, resumir hallazgos.
- NUNCA combines, promedies ni confundas dos valores o exámenes distintos aunque estén relacionados (ej: "nitrógeno ureico" y "urea" son mediciones DIFERENTES con números DIFERENTES, aunque midan algo similar — nunca asumas que son el mismo valor).
- Si el "Perfil del paciente" entregado incluye una edad, esa es la edad correcta y calculada para el contexto de cada examen. Ignora cualquier edad que pudiera aparecer mencionada dentro del texto de interpretación o hallazgos de un informe individual: esos textos vienen de documentos antiguos y su edad ahí impresa puede estar desactualizada.
- Si citas un número, cítalo EXACTAMENTE como aparece en los datos entregados. Si el usuario te corrige porque mezclaste datos, revisa el texto entregado de nuevo antes de responder, no repitas el mismo error.
- Si la pregunta pide una conclusión clínica, un diagnóstico o una decisión de tratamiento, responde que eso debe conversarlo con su médico y explica por qué (no reemplazas una evaluación profesional).
- Si los datos entregados no alcanzan para responder con precisión, dilo explícitamente en vez de inventar o aproximar información.
- Responde en español neutro, de forma breve y clara (máximo un par de párrafos cortos).

Datos de historial disponibles:
"""
{{CONTEXT}}
"""`

function fmtFecha(f: string | null): string {
  if (!f) return 'sin fecha'
  return new Date(f + 'T00:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })
}

// Lista los valores exactos tal como quedaron guardados en historial_valores.
// Se listan ANTES que la interpretación y con instrucción explícita de
// preferirlos, para que la IA no tenga que "recordar" números desde un
// resumen en prosa (que es donde se mezclaron nitrógeno ureico y urea).
function fmtValoresBlock(valores: HistorialValor[]): string | null {
  if (valores.length === 0) return null
  const lineas = valores.map((v) => {
    const rango = v.rango_min != null && v.rango_max != null ? ` (rango normal: ${v.rango_min}-${v.rango_max})` : ''
    const flag = v.fuera_de_rango ? ' [FUERA DE RANGO]' : ''
    return `  - ${v.nombre_valor}: ${v.valor ?? '?'}${v.unidad ? ' ' + v.unidad : ''}${rango}${flag}`
  })
  return `Valores exactos medidos (fuente de verdad — usa SIEMPRE estos números, cada línea es un valor distinto, no los combines):\n${lineas.join('\n')}`
}

export function buildContextForInforme(informe: HistorialInforme, valores: HistorialValor[] = [], perfil: HistorialPerfil | null = null): string {
  return [
    fmtPerfilBlock(perfil, informe.fecha_examen),
    `Tipo de examen: ${informe.tipo_examen?.nombre ?? 'no especificado'}`,
    `Fecha: ${fmtFecha(informe.fecha_examen)}`,
    `Institución: ${informe.institucion ?? 'no especificada'}`,
    `Médico: ${informe.medico_nombre ?? 'no especificado'}`,
    fmtValoresBlock(valores),
    `Interpretación / hallazgos (resumen en prosa, secundario a los valores exactos de arriba si los hay): ${informe.interpretacion ?? 'sin interpretación registrada'}`,
    informe.notas ? `Notas del usuario: ${informe.notas}` : null,
  ].filter(Boolean).join('\n')
}

export function buildContextForHistorial(items: { informe: HistorialInforme; valores: HistorialValor[] }[], perfil: HistorialPerfil | null = null): string {
  if (items.length === 0) return 'No hay informes registrados para este paciente.'
  const perfilBlock = fmtPerfilBlock(perfil, null)
  const cuerpo = items
    .map(({ informe: inf, valores }, i) => {
      const valoresBlock = fmtValoresBlock(valores)
      const edadEnExamen = fmtPerfilBlock(perfil, inf.fecha_examen)
      const edadLinea = edadEnExamen ? edadEnExamen.split('\n').find((l) => l.includes('Edad')) : null
      return [
        `${i + 1}. [${fmtFecha(inf.fecha_examen)}] ${inf.tipo_examen?.nombre ?? 'Examen'} — ${inf.institucion ?? 'institución no especificada'}`,
        edadLinea ? `   ${edadLinea.trim()}` : null,
        valoresBlock ? `   ${valoresBlock.replace(/\n/g, '\n   ')}` : null,
        `   Hallazgos: ${inf.interpretacion ?? 'sin interpretación registrada'}`,
      ].filter(Boolean).join('\n')
    })
    .join('\n\n')
  return [perfilBlock, perfilBlock ? '(la edad exacta en cada examen se detalla junto a cada uno más abajo)' : null, cuerpo].filter(Boolean).join('\n\n')
}

class ChatProviderError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

async function askViaGemini(context: string, history: ChatMessage[], question: string): Promise<string> {
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!geminiKey) throw new ChatProviderError('Falta VITE_GEMINI_API_KEY')

  const systemInstruction = SYSTEM_PROMPT.replace('{{CONTEXT}}', context)
  const contents = [
    ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: question }] },
  ]

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: { temperature: 0.3 },
        }),
      }
    )
    clearTimeout(timeout)
    if (!resp.ok) throw new ChatProviderError(`Gemini respondió ${resp.status}`, resp.status)

    const data = await resp.json()
    const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text) throw new ChatProviderError('Gemini no devolvió respuesta')
    return text.trim()
  } catch (e: any) {
    clearTimeout(timeout)
    if (e.name === 'AbortError') throw new ChatProviderError('Gemini demoró demasiado', 408)
    throw e
  }
}

// Respaldo gratuito, por si Gemini está sin cuota (429) o falla por
// cualquier otro motivo. 'openrouter/free' es el router automático de
// OpenRouter (elige al azar entre todos los modelos gratis disponibles en
// ese momento), se prueba primero porque se adapta solo si el catálogo de
// modelos gratis cambia. Lista corta a propósito: cada modelo agregado se
// prueba en secuencia (hasta 20s cada uno) y una lista larga hace que el
// usuario espere demasiado si los primeros fallan.
const OPENROUTER_CHAT_MODELS = [
  'openrouter/free',
  'meta-llama/llama-3.3-70b-instruct:free',
]

async function askViaOpenRouter(context: string, history: ChatMessage[], question: string): Promise<string> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY
  if (!apiKey) throw new ChatProviderError('Falta VITE_OPENROUTER_API_KEY')

  const systemInstruction = SYSTEM_PROMPT.replace('{{CONTEXT}}', context)
  const messages = [
    { role: 'system', content: systemInstruction },
    ...history.map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
    { role: 'user', content: question },
  ]

  for (const model of OPENROUTER_CHAT_MODELS) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 20_000)
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://vumi.app',
          'X-Title': 'Vumi Hoja de Vida',
        },
        body: JSON.stringify({ model, messages, temperature: 0.3 }),
      })
      clearTimeout(timeout)
      if (!resp.ok) continue
      const data = await resp.json()
      const text: string = data.choices?.[0]?.message?.content ?? ''
      if (text) return text.trim()
    } catch (e: any) {
      console.warn(`[HojaDeVida Chat] OpenRouter ${model} error:`, e?.message ?? e)
    }
  }
  throw new ChatProviderError('OpenRouter no pudo responder')
}

// Pregunta a la IA usando el historial de conversación (multi-turno) más la
// nueva pregunta. `history` NO incluye la pregunta nueva. Intenta Gemini
// primero; si falla (incluyendo límite de cuota gratuita, error 429),
// reintenta con OpenRouter como respaldo.
export async function askAboutInforme(context: string, history: ChatMessage[], question: string): Promise<string> {
  try {
    return await askViaGemini(context, history, question)
  } catch (geminiErr: any) {
    try {
      return await askViaOpenRouter(context, history, question)
    } catch {
      if (geminiErr.status === 429) {
        throw new Error('La IA gratuita alcanzó su límite de uso por ahora. Espera un momento y vuelve a intentar.')
      }
      throw new Error('No se pudo consultar la IA en este momento. Intenta de nuevo en unos minutos.')
    }
  }
}
