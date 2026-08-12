// ============================================================
// HOJA DE VIDA MÉDICA — Types
// Módulo separado del sistema de reembolsos. Reutiliza el tipo
// Patient definido en '@/lib/types'.
// ============================================================

export interface TipoExamen {
  id: number
  codigo: string
  nombre: string
  created_at: string
}

export interface HistorialInforme {
  id: string
  user_id: string
  patient_id: string
  tipo_examen_id: number | null

  fecha_examen: string | null
  institucion: string | null
  medico_nombre: string | null
  interpretacion: string | null
  notas: string | null

  storage_path: string
  storage_bucket: string
  mime_type: string
  file_size: number | null
  file_hash: string | null

  ai_extracted: boolean
  ai_confidence: number | null
  needs_review: boolean

  created_at: string
  updated_at: string

  // join
  tipo_examen?: TipoExamen
}

export interface HistorialValor {
  id: string
  informe_id: string
  nombre_valor: string
  valor: number | null
  unidad: string | null
  rango_min: number | null
  rango_max: number | null
  fuera_de_rango: boolean
  created_at: string
}

export type SexoBiologico = 'femenino' | 'masculino' | 'otro'

export interface HistorialPerfil {
  id: string
  user_id: string
  patient_id: string
  fecha_nacimiento: string | null
  sexo_biologico: SexoBiologico | null
  condiciones_cronicas: string | null
  alergias: string | null
  medicamentos_habituales: string | null
  estatura_cm: number | null
  peso_kg: number | null
  created_at: string
  updated_at: string
}
