// ============================================================
// HOJA DE VIDA MÉDICA — Utilidades de perfil del paciente
// ============================================================

import type { HistorialPerfil } from './types'

// Calcula la edad de la persona en una fecha de referencia (ej: la fecha de
// un examen), a partir de su fecha de nacimiento. Evita el error de usar la
// edad que a veces viene impresa en un informe antiguo como si fuera la
// edad actual.
export function calcularEdad(fechaNacimiento: string | null, fechaReferencia: string | null): number | null {
  if (!fechaNacimiento) return null
  const nacimiento = new Date(fechaNacimiento + 'T00:00:00')
  const referencia = fechaReferencia ? new Date(fechaReferencia + 'T00:00:00') : new Date()
  if (isNaN(nacimiento.getTime()) || isNaN(referencia.getTime())) return null

  let edad = referencia.getFullYear() - nacimiento.getFullYear()
  const mesDiff = referencia.getMonth() - nacimiento.getMonth()
  if (mesDiff < 0 || (mesDiff === 0 && referencia.getDate() < nacimiento.getDate())) {
    edad--
  }
  return edad >= 0 ? edad : null
}

const SEXO_LABEL: Record<string, string> = {
  femenino: 'Femenino',
  masculino: 'Masculino',
  otro: 'Otro',
}

// Formatea el perfil como bloque de contexto para el chat de IA. `fechaReferencia`
// permite calcular la edad correcta al momento de un examen específico; si se
// omite, se usa la edad actual.
export function fmtPerfilBlock(perfil: HistorialPerfil | null, fechaReferencia: string | null = null): string | null {
  if (!perfil) return null
  const edad = calcularEdad(perfil.fecha_nacimiento, fechaReferencia)
  const partes = [
    edad != null ? `Edad${fechaReferencia ? ' en la fecha del examen' : ' actual'}: ${edad} años` : null,
    perfil.sexo_biologico ? `Sexo biológico: ${SEXO_LABEL[perfil.sexo_biologico] ?? perfil.sexo_biologico}` : null,
    perfil.estatura_cm != null ? `Estatura de referencia: ${perfil.estatura_cm} cm` : null,
    perfil.peso_kg != null ? `Peso de referencia: ${perfil.peso_kg} kg` : null,
    perfil.condiciones_cronicas ? `Condiciones crónicas / enfermedades previas conocidas: ${perfil.condiciones_cronicas}` : null,
    perfil.alergias ? `Alergias conocidas: ${perfil.alergias}` : null,
    perfil.medicamentos_habituales ? `Medicamentos habituales: ${perfil.medicamentos_habituales}` : null,
  ].filter(Boolean)
  if (partes.length === 0) return null
  return `Perfil del paciente:\n${partes.map((p) => `  - ${p}`).join('\n')}`
}
