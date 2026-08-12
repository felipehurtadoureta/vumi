// ============================================================
// VUMI — Types
// ============================================================

export type DocumentType =
  | 'boleta'
  | 'orden_medica'
  | 'liquidacion_banmedica'
  | 'liquidacion_metlife'
  | 'otro'

export type CaseStatus =
  | 'SUBIDO'
  | 'PROCESANDO'
  | 'INCOMPLETO'
  | 'NUEVA_INFO'
  | 'LISTO_PARA_VUMI'
  | 'ENVIADO_VUMI'
  | 'ENVIADO_METLIFE'
  | 'ENVIADO_BANMEDICA'
  | 'CERRADO'
  | 'RECHAZADO'
  | 'ARCHIVADO'
  | 'ELIMINADO'

export type InsuranceName = 'banmedica' | 'metlife' | 'vumi'
export type CaseType = 'atencion_medica' | 'medicamento'
export type CurrencyType = 'CLP' | 'USD' | 'EUR'
export type OcrStatus = 'pending' | 'processing' | 'done' | 'failed'

export interface Patient {
  id: string
  user_id: string
  full_name: string
  alias: string | null
  initials: string | null
  birth_date: string | null
  rut: string | null
  relationship: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface MedicalCase {
  id: string
  user_id: string
  patient_id: string | null   // null cuando aún no se asigna paciente
  correlativo: string | null
  boleta_number: string | null // número de boleta / bono extraído del OCR o ingresado
  title: string | null
  event_description: string | null
  status: CaseStatus
  event_date: string | null
  total_amount: number | null
  currency: CurrencyType
  provider: string | null
  rut_centro_medico: string | null
  rut_medico: string | null
  nombre_medico: string | null
  numero_banmedica: string | null
  numero_complementario: string | null
  notes: string | null
  case_type: CaseType
  needs_vumi: boolean
  needs_metlife: boolean
  has_boleta: boolean
  has_orden_medica: boolean
  has_liquidacion_banmedica: boolean
  is_complete: boolean
  banmedica_sent_at: string | null
  metlife_sent_at: string | null
  vumi_sent_at: string | null
  created_at: string
  updated_at: string
  // joins
  patient?: Patient
  case_documents?: CaseDocument[]
}

export interface ExtractedMetadata {
  provider_rut?: string
  doctor_name?: string
  doctor_rut?: string
  recipient_rut?: string
  banmedica_bonification?: number       // Bonificación Isapre (BonoBanmédica)
  complementario_bonification?: number  // Bonificación seguro complementario
}

export interface Document {
  id: string
  user_id: string
  filename: string
  original_name: string
  mime_type: string
  file_size: number | null
  storage_path: string
  storage_bucket: string
  file_hash: string | null
  is_duplicate: boolean
  doc_type: DocumentType | null
  ocr_raw_text: string | null
  extracted_date: string | null
  extracted_amount: number | null
  extracted_currency: CurrencyType
  extracted_provider: string | null
  extracted_receipt_number: string | null
  extracted_patient_name: string | null
  extracted_metadata: ExtractedMetadata | null
  insurance_hint: InsuranceName | null
  ai_confidence: number | null
  needs_review: boolean
  ocr_status: OcrStatus
  ocr_error: string | null
  drive_link: string | null
  created_at: string
  updated_at: string
}

export interface CaseDocument {
  id: string
  case_id: string
  document_id: string
  role: DocumentType
  added_at: string
  document?: Document
}

export interface InsuranceClaim {
  id: string
  case_id: string
  insurance: InsuranceName
  submitted_at: string | null
  amount_claimed: number | null
  amount_reimbursed: number | null
  reference_number: string | null
  notes: string | null
  created_at: string
}

export interface EmailLog {
  id: string
  case_id: string
  insurance: InsuranceName
  status: 'draft' | 'sent' | 'failed'
  gmail_message_id: string | null
  subject: string
  recipient: string
  sent_at: string | null
  created_at: string
}

export interface CaseStatusHistory {
  id: string
  case_id: string
  from_status: CaseStatus | null
  to_status: CaseStatus
  reason: string | null
  created_at: string
}

// UI helpers
export const STATUS_LABELS: Record<CaseStatus, string> = {
  SUBIDO: 'Subido',
  PROCESANDO: 'Procesando',
  INCOMPLETO: 'Incompleto',
  NUEVA_INFO: 'Agregar Nueva Info',
  LISTO_PARA_VUMI: 'Listo para VUMI',
  ENVIADO_VUMI: 'Enviado a VUMI',
  ENVIADO_METLIFE: 'Enviado a MetLife',
  ENVIADO_BANMEDICA: 'Enviado a Banmédica',
  CERRADO: 'Cerrado',
  RECHAZADO: 'Rechazado',
  ARCHIVADO: 'Archivado',
  ELIMINADO: 'Eliminado',
}

export const STATUS_COLORS: Record<CaseStatus, string> = {
  SUBIDO: 'bg-gray-100 text-gray-700',
  PROCESANDO: 'bg-yellow-100 text-yellow-800',
  INCOMPLETO: 'bg-red-100 text-red-700',
  NUEVA_INFO: 'bg-orange-100 text-orange-700',
  LISTO_PARA_VUMI: 'bg-green-100 text-green-800',
  ENVIADO_VUMI: 'bg-blue-100 text-blue-800',
  ENVIADO_METLIFE: 'bg-purple-100 text-purple-800',
  ENVIADO_BANMEDICA: 'bg-indigo-100 text-indigo-800',
  CERRADO: 'bg-gray-200 text-gray-600',
  RECHAZADO: 'bg-red-200 text-red-800',
  ARCHIVADO: 'bg-gray-100 text-gray-500',
  ELIMINADO: 'bg-red-50 text-red-400',
}

export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  boleta: 'Boleta',
  orden_medica: 'Orden Médica',
  liquidacion_banmedica: 'Liquidación Banmédica',
  liquidacion_metlife: 'Liquidación MetLife',
  otro: 'Otro',
}
