// ============================================================
// HOJA DE VIDA MÉDICA — Lector local (sin IA) para el formato de
// laboratorio "SISALUD" / Clínica Alemana ("LABORATORIO CLINICO").
//
// Este formato es muy consistente entre informes (mismo encabezado,
// misma tabla de resultados), así que se puede leer con reglas fijas:
// instantáneo, gratis, sin depender de ninguna cuota de IA. Si el texto
// no calza claramente con este formato, devuelve null y el llamador
// sigue con el flujo normal (IA) como respaldo.
// ============================================================

import type { InformeOCRResult, InformeOCRValor } from './ocrInformes'

const SPECIALTY_WORDS = new Set([
  'BIOQUIMICA', 'HEMATOLOGIA', 'Y', 'COAGUL', 'INMUNOLOGIA', 'MICROBIOLOGIA',
  'PARASITOLOGIA', 'UROANALISIS', 'ENDOCRINOLOGIA', 'HORMONAS', 'INMUNOENSAYOS',
])

// Algunos exámenes (ej. PSA) no traen columna de rango de referencia fijo
// y el encabezado queda "Resultado Res. Anterior", sin "V. Referencia" en
// medio — esa parte es opcional.
const TABLE_HEADER_RE = /Resultado\s+(?:V\.?\s*Referencia\s+)?Res\.?\s*Anterior/i
const INGRESO_RE = /Ingreso:(\d{2})\/(\d{2})\/(\d{4})/

const SKIP_PREFIXES = [
  'Método', 'Metodo', 'Procesado', 'fmto', 'Actualiz', 'Información', 'Valor de Referencia',
  'Referencia :', 'Cálculo', '(*)', 'Caracteres', 'Sedimentaci', 'Jefe', 'Dr', 'Dra', 'A. Anderson',
  'disponible', 'Con fecha', 'en los resultados', 'muestra concordancia', 'Observaciones',
]

// Fila de la tabla de resultados, ej:
//   "COLESTEROL Total 217 mg/dL 82 - 199 10/08/18 : 215"
//   "PROTEINA C-REACTIVA <0.1 mg/dL 0.1 - 0.5 23/08/13 : 1.45"
//   "INR 1.1"
const ROW_RE = new RegExp(
  '^([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9.\\-\\s]*?)\\s+' +
  '([<>]?\\s?-?\\d+(?:[.,]\\d+)?)\\s*' +
  '(%|/?mm3|mg\\/dL|g\\/dL|U\\/L|fL|pg|mL\\/min\\/1\\.73m2|UI\\/mL|mm\\/h|mEq\\/L|ng\\/mL)?' +
  '(?:\\s+(\\d+(?:[.,]\\d+)?)\\s*-\\s*(\\d+(?:[.,]\\d+)?))?' +
  '(?:\\s+\\d{2}\\/\\d{2}\\/\\d{2}\\s*:\\s*.*)?$'
)

function parseValores(lines: string[]): InformeOCRValor[] {
  const valores: InformeOCRValor[] = []
  let inTable = false

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (TABLE_HEADER_RE.test(line)) { inTable = true; continue }
    if (!inTable) continue

    // Estas líneas son informativas (método, notas, actualización de
    // rangos, etc.) y no marcan el fin de la tabla: un mismo informe puede
    // traer varios resultados separados por este tipo de texto (ej. un
    // resultado de Creatinina seguido, más abajo, de un cálculo de Tasa de
    // Filtración). Se saltan sin salir del modo tabla.
    if (line === '.' || SKIP_PREFIXES.some((p) => line.startsWith(p))) continue
    if (/^[A-ZÁÉÍÓÚÑ\s]{3,}$/.test(line) && !/\d/.test(line)) continue // encabezados de sección ("PERFIL HEPATICO")
    if (line.includes('NORMALES') || line.startsWith('Caracteres')) continue

    const m = ROW_RE.exec(line)
    if (!m) continue

    const nombre = m[1].trim()
    const valorRaw = m[2].replace(/[<>\s]/g, '').replace(',', '.')
    const valor = valorRaw && !isNaN(Number(valorRaw)) ? Number(valorRaw) : null
    const unidad = m[3] || null
    const rangoMin = m[4] != null ? Number(m[4].replace(',', '.')) : null
    const rangoMax = m[5] != null ? Number(m[5].replace(',', '.')) : null

    if (!nombre || valor == null) continue
    valores.push({ nombre_valor: nombre, valor, unidad, rango_min: rangoMin, rango_max: rangoMax })
  }
  return valores
}

function parseMedico(text: string): string | null {
  const m = /Dr\.?a?\.?\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]*?)\s*$/m.exec(text)
  if (!m) return null
  const words = m[1].trim().split(/\s+/)
  while (words.length > 0 && SPECIALTY_WORDS.has(words[words.length - 1].toUpperCase())) {
    words.pop()
  }
  return words.length > 0 ? words.join(' ') : null
}

function buildInterpretacion(valores: InformeOCRValor[]): string | null {
  if (valores.length === 0) return null
  const fueraDeRango = valores.filter(
    (v) => v.valor != null && v.rango_min != null && v.rango_max != null &&
      (v.valor < v.rango_min || v.valor > v.rango_max)
  )
  if (fueraDeRango.length === 0) return 'Todos los valores medidos están dentro de rango normal.'
  const nombres = fueraDeRango.map((v) => v.nombre_valor).join(', ')
  return `Valores fuera de rango: ${nombres}.`
}

// Devuelve null si el texto no calza claramente con este formato de
// laboratorio (encabezado + tabla de resultados reconocibles), o si no se
// pudo extraer ningún valor con confianza — en ese caso el llamador debe
// seguir con el flujo normal (IA).
export function parseSisalud(text: string): InformeOCRResult | null {
  if (!INGRESO_RE.test(text) || !TABLE_HEADER_RE.test(text)) return null

  const lines = text.split('\n')

  const ingresoMatch = INGRESO_RE.exec(text)
  const fecha_examen = ingresoMatch ? `${ingresoMatch[3]}-${ingresoMatch[2]}-${ingresoMatch[1]}` : null

  const pacienteMatch = /^(.*?)\s+Informe:/m.exec(text)
  const paciente_nombre = pacienteMatch ? pacienteMatch[1].trim() : null

  const institLines: string[] = []
  for (const l of lines) {
    const trimmed = l.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('Ingreso:')) break
    institLines.push(trimmed)
  }
  const institucion = institLines.length > 0 ? institLines.join(' - ') : null

  const medico_nombre = parseMedico(text)
  const valores = parseValores(lines)

  if (valores.length === 0) return null // no confiamos en un resultado sin ninguna fila reconocida

  return {
    paciente_nombre,
    fecha_examen,
    tipo_examen_codigo: 'sangre', // todos los formatos SISALUD vistos son de muestra sanguínea
    institucion,
    medico_nombre,
    interpretacion: buildInterpretacion(valores),
    valores,
    confidence: 0.95,
    fuente: 'local',
  }
}
