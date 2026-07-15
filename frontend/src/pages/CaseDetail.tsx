import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Trash2, Loader2, Upload, FileText,
  CheckCircle, Clock, XCircle, Send, Calendar, Download, UserCheck, Users, Eye, X, Files, Check, Archive, RotateCcw,
  AlertCircle, Plus, BookOpen, Search, ChevronUp, ChevronDown,
} from 'lucide-react'
import { mergeFilesToPdf } from '@/lib/mergeFiles'
import { uploadToDrive, deleteFromDrive, getAccessToken, isDriveAvailable } from '@/lib/googleDrive'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { processDocument } from '@/lib/ocr'
import StatusBadge from '@/components/ui/StatusBadge'
import type { MedicalCase, CaseDocument, DocumentType, Patient } from '@/lib/types'
import { DOC_TYPE_LABELS } from '@/lib/types'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import clsx from 'clsx'

// ── tipos de documento que se pueden subir en el caso ──────────────────
const DOC_SLOTS: { type: DocumentType; label: string; hint: string; multi?: boolean }[] = [
  { type: 'orden_medica',          label: 'Orden médica',       hint: 'Receta o derivación del médico', multi: true },
  { type: 'boleta',                label: 'Boleta / Bono',      hint: 'Boleta o factura de la prestación' },
  { type: 'liquidacion_banmedica', label: 'Liq. Banmédica',     hint: 'Liquidación recibida de Banmédica' },
]

// Nombre del tipo de documento para archivos
const DOC_FILE_LABEL: Record<DocumentType, string> = {
  boleta:                'Boleta',
  orden_medica:          'Orden',
  liquidacion_banmedica: 'Liquidacion',
  liquidacion_metlife:   'LiquidacionML',
  otro:                  'Otro',
}

// ── helpers ────────────────────────────────────────────────────────────
// Parsear YYYY-MM-DD como hora local para evitar desfase por timezone (UTC vs Chile)
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  // Siempre parsear como fecha local (tomar solo YYYY-MM-DD) para evitar desfase UTC→Chile
  return format(parseLocalDate(iso.slice(0, 10)), 'dd/MM/yyyy')
}
function fmtDateTime(iso: string | null) {
  if (!iso) return '—'
  return format(parseLocalDate(iso.slice(0, 10)), "d 'de' MMMM yyyy", { locale: es })
}

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { userId } = useStore()

  const [caseData, setCaseData] = useState<MedicalCase | null>(null)
  const [docsByType, setDocsByType] = useState<Partial<Record<DocumentType, CaseDocument>>>({})
  const [otroDocs, setOtroDocs] = useState<CaseDocument[]>([])
  // Library picker
  const [libraryPickerFor, setLibraryPickerFor] = useState<DocumentType | null>(null)
  const [libraryDocs, setLibraryDocs] = useState<import('@/lib/types').Document[]>([])
  const [librarySearch, setLibrarySearch] = useState('')
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [linkingDoc, setLinkingDoc] = useState<string | null>(null)
  // Additional docs (otro)
  const [uploadingOtro, setUploadingOtro] = useState(false)
  const [otroDragging, setOtroDragging] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [uploadingType, setUploadingType] = useState<DocumentType | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)
  const [viewerUrl,  setViewerUrl]  = useState('')
  const [viewerName, setViewerName] = useState('')
  const [viewerPdf,  setViewerPdf]  = useState(false)

  // Paciente
  const [patients, setPatients] = useState<Patient[]>([])
  const [suggestedPatient, setSuggestedPatient] = useState<Patient | null>(null)
  const [assignPatientId,  setAssignPatientId]  = useState('')
  const [assigningPatient, setAssigningPatient] = useState(false)
  const [changingPatient,  setChangingPatient]  = useState(false)
  const [editingTitle,     setEditingTitle]     = useState(false)
  const [titleDraft,       setTitleDraft]       = useState('')

  // editing fields
  const [editMode, setEditMode] = useState(false)
  const [fields, setFields] = useState({
    boleta_number: '',
    event_date: '',
    total_amount: '',
    rut_centro_medico: '',
    rut_medico: '',
  })
  const [savingFields, setSavingFields] = useState(false)

  // reimbursement date inputs
  const [banmedicaDate, setBanmedicaDate] = useState('')
  const [metlifeDate, setMetlifeDate]     = useState('')
  const [savingStep, setSavingStep] = useState<string | null>(null)
  const [sendingVumi, setSendingVumi] = useState(false)
  const [vumiConfirmOpen, setVumiConfirmOpen] = useState(false)
  const [vumiPendingData, setVumiPendingData] = useState<{ subject: string; body: string; correlativo: string } | null>(null)
  const [confirmingVumi, setConfirmingVumi] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [clearingSentDate, setClearingSentDate] = useState<string | null>(null)
  const [reopenModalOpen, setReopenModalOpen] = useState(false)
  const [reopenTargets, setReopenTargets] = useState<string[]>([])
  const [reopenNote, setReopenNote] = useState('')

  // ── load ──────────────────────────────────────────────────────────────
  async function loadCase() {
    if (!id) return
    const [caseRes, docsRes, patientsRes] = await Promise.all([
      supabase
        .from('medical_cases')
        .select('*, patient:patients(full_name, alias, relationship, initials)')
        .eq('id', id)
        .single(),
      supabase
        .from('case_documents')
        .select('*, document:documents(*)')
        .eq('case_id', id),
      supabase
        .from('patients')
        .select('*')
        .eq('is_active', true)
        .order('full_name'),
    ])
    if (caseRes.data) {
      const c = caseRes.data as MedicalCase
      setCaseData(c)
      setFields({
        boleta_number:     c.boleta_number     ?? '',
        event_date:        c.event_date        ?? '',
        total_amount:      c.total_amount != null ? String(c.total_amount) : '',
        rut_centro_medico: c.rut_centro_medico ?? '',
        rut_medico:        c.rut_medico        ?? '',
      })
    }
    if (docsRes.data) {
      const map: Partial<Record<DocumentType, CaseDocument>> = {}
      const otros: CaseDocument[] = []
      for (const cd of docsRes.data as CaseDocument[]) {
        if (cd.role === 'otro') {
          otros.push(cd)
        } else {
          map[cd.role] = cd
        }
      }
      setDocsByType(map)
      setOtroDocs(otros)
    }
    if (patientsRes.data) setPatients(patientsRes.data)
    setLoading(false)
  }

  useEffect(() => { loadCase() }, [id])

  // ── descarga un documento con nombre de convención ───────────────────
  async function downloadDoc(cd: CaseDocument) {
    const doc = cd.document as any
    if (!doc?.storage_path) return
    const { data } = await supabase.storage.from('documents').download(doc.storage_path)
    if (!data) return
    const ext = doc.storage_path?.split('.').pop() ?? 'bin'
    const initials   = (caseData?.patient as any)?.initials ?? 'XX'
    const correlativo = caseData?.correlativo ?? 'V000'
    const titleSlug  = (caseData?.title ?? 'caso')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9\s-]/g, '').trim()
      .replace(/\s+/g, '-').slice(0, 30)
    const typeLabel  = DOC_FILE_LABEL[cd.role] ?? 'Doc'
    const filename = `${correlativo}_${titleSlug}_${typeLabel}_${initials}.${ext}`
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  // ── upload doc ────────────────────────────────────────────────────────
  async function uploadDoc(file: File, docType: DocumentType) {
    if (!id || !userId) return
    setUploadingType(docType)

    // Pedir token de Drive AHORA (contexto de gesto del usuario) antes de cualquier async
    if (isDriveAvailable()) {
      await getAccessToken().catch(() => { /* no bloquear si Drive falla */ })
    }

    // Normalizar MIME type por extensión (algunos PDFs llegan como octet-stream)
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
    const mimeByExt: Record<string, string> = {
      pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
    }
    const mimeType = mimeByExt[ext] ?? file.type

    try {
      // Nombre de archivo: correlativo_titulo_Boleta|Orden|Liquidacion_iniciales.ext
      const initials   = (caseData?.patient as any)?.initials ?? 'XX'
      const correlativo = caseData?.correlativo ?? `${Date.now()}`
      const titleSlug  = (caseData?.title ?? 'caso')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9\s-]/g, '').trim()
        .replace(/\s+/g, '-').slice(0, 30)
      const typeLabel  = DOC_FILE_LABEL[docType]
      const displayName = `${correlativo}_${titleSlug}_${typeLabel}_${initials}.${ext}`
      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const storagePath = `${userId}/${uniqueName}`

      // 1. Insert document record
      const { data: doc, error: docErr } = await supabase
        .from('documents')
        .insert({
          user_id: userId,
          filename: uniqueName,
          original_name: displayName,
          mime_type: mimeType,
          file_size: file.size,
          storage_path: storagePath,
          storage_bucket: 'documents',
          ocr_status: docType === 'boleta' ? 'pending' : 'not_required',
        })
        .select()
        .single()
      if (docErr) throw docErr

      // 2. Upload file
      const { error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(storagePath, file, { contentType: mimeType })
      if (uploadErr) throw uploadErr

      // 3. Link to case (delete any existing row for this role first, then insert)
      // Para 'otro' se permite múltiples; para los demás se reemplaza.
      if (docType !== 'otro') {
        const oldCd = docsByType[docType]
        const oldDoc = oldCd?.document as any
        if (oldDoc?.drive_link && isDriveAvailable()) {
          deleteFromDrive(oldDoc.drive_link).catch(e =>
            console.warn('[Drive] delete old on replace failed:', e.message)
          )
        }
        await supabase
          .from('case_documents')
          .delete()
          .eq('case_id', id)
          .eq('role', docType)
      }

      const { error: linkErr } = await supabase.from('case_documents').insert({
        case_id: id,
        document_id: doc.id,
        role: docType,
      })
      if (linkErr) throw linkErr

      // 4. Actualizar flags del caso inmediatamente (no depender de trigger DB)
      const flagMap: Partial<Record<DocumentType, string>> = {
        boleta:                'has_boleta',
        orden_medica:          'has_orden_medica',
        liquidacion_banmedica: 'has_liquidacion_banmedica',
        liquidacion_metlife:   'has_liquidacion_metlife',
      }
      const flagField = flagMap[docType]
      if (flagField) {
        const { error: flagErr } = await supabase
          .from('medical_cases')
          .update({ [flagField]: true })
          .eq('id', id)
        if (flagErr) console.warn('[uploadDoc] flag update failed:', flagErr.message)
      }

      // 5. Subir a Drive y guardar el link en la BD
      if (isDriveAvailable()) {
        const driveFile = new File([file], displayName, { type: mimeType })
        uploadToDrive(driveFile)
          .then(async driveLink => {
            console.log('[Drive] subido OK:', driveLink)
            await supabase.from('documents').update({ drive_link: driveLink }).eq('id', doc.id)
            // Refrescar estado local para que el link de Drive quede disponible
            // de inmediato (ej. al generar el correo de envío justo después de subir).
            await loadCase()
          })
          .catch(e => console.error('[Drive] upload falló:', e.message))
      }

      // 6. OCR solo para boletas (órdenes y liquidaciones no necesitan extracción)
      if (docType === 'boleta') {
        try {
          const result = await processDocument(doc.id, storagePath, mimeType)

          const updates: Partial<MedicalCase> = {}
          if (!caseData?.boleta_number && result.extracted_receipt_number)
            updates.boleta_number = result.extracted_receipt_number
          if (!caseData?.event_date && result.extracted_date)
            updates.event_date = result.extracted_date
          if (!caseData?.total_amount && result.extracted_amount)
            updates.total_amount = result.extracted_amount
          if (!caseData?.rut_centro_medico && result.extracted_metadata?.provider_rut)
            updates.rut_centro_medico = result.extracted_metadata.provider_rut
          if (!caseData?.rut_medico && result.extracted_metadata?.doctor_rut)
            updates.rut_medico = result.extracted_metadata.doctor_rut

          if (!caseData?.patient_id && result.extracted_patient_name) {
            const matched = matchPatient(result.extracted_patient_name, patients)
            if (matched) setSuggestedPatient(matched)
          }

          if (Object.keys(updates).length > 0) {
            await supabase.from('medical_cases').update(updates).eq('id', id)
          }
        } catch {
          console.warn('OCR falló para', file.name, '— documento guardado sin datos extraídos')
        }
      }
    } catch (err: any) {
      console.error('[uploadDoc] Error al subir:', err)
      alert(`Error al subir "${file.name}":\n${err.message}`)
    } finally {
      await loadCase()
      setUploadingType(null)
    }
  }

  // ── view doc ──────────────────────────────────────────────────────────
  async function viewDoc(cd: CaseDocument) {
    const doc = cd.document as any
    if (!doc?.storage_path) return
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.storage_path, 3600)
    if (!data?.signedUrl) return
    setViewerUrl(data.signedUrl)
    setViewerName(doc.original_name ?? doc.filename ?? 'Documento')
    setViewerPdf(doc.mime_type === 'application/pdf')
  }

  // ── delete doc ────────────────────────────────────────────────────────
  async function deleteDoc(cd: CaseDocument) {
    const doc = cd.document as any
    if (!window.confirm(`¿Eliminar "${doc?.original_name ?? 'este documento'}"?`)) return
    try {
      // 1. Desvincular del caso
      await supabase.from('case_documents').delete().eq('id', cd.id)
      // 2. Eliminar registro del documento
      await supabase.from('documents').delete().eq('id', doc.id)
      // 3. Eliminar archivo del storage
      if (doc?.storage_path) {
        await supabase.storage.from('documents').remove([doc.storage_path])
      }
      // 4. Eliminar de Drive si existe
      if (doc?.drive_link && isDriveAvailable()) {
        deleteFromDrive(doc.drive_link).catch(e =>
          console.warn('[Drive] delete failed:', e.message)
        )
      }
      await loadCase()
    } catch (err: any) {
      alert('Error al eliminar: ' + err.message)
    }
  }

  // ── save editable fields + track corrections ─────────────────────────
  async function saveFields() {
    if (!id) return

    // Verificar duplicado de boleta si el número cambió
    const newBoleta = fields.boleta_number.trim()
    if (newBoleta && newBoleta !== (caseData?.boleta_number ?? '')) {
      const { data: dup } = await supabase
        .from('medical_cases')
        .select('id, correlativo, title')
        .eq('user_id', userId!)
        .eq('boleta_number', newBoleta)
        .neq('id', id)
        .limit(1)
      if (dup && dup.length > 0) {
        const d = dup[0] as any
        setDuplicateWarning(`⚠️ La boleta N° ${newBoleta} ya está registrada en el caso #${d.correlativo} — "${d.title}". Verifica que no sea un duplicado.`)
      }
    }

    setSavingFields(true)
    await supabase.from('medical_cases').update({
      boleta_number:     fields.boleta_number     || null,
      event_date:        fields.event_date        || null,
      total_amount:      fields.total_amount ? parseFloat(fields.total_amount) : null,
      rut_centro_medico: fields.rut_centro_medico || null,
      rut_medico:        fields.rut_medico        || null,
    }).eq('id', id)

    // Registrar correcciones respecto al OCR (para mejorar patrones futuros)
    const boletaDoc = docsByType['boleta']?.document as any
    if (boletaDoc?.id) {
      const ocrValues: Record<string, string | null> = {
        boleta_number:     boletaDoc.extracted_receipt_number ?? null,
        total_amount:      boletaDoc.extracted_amount != null ? String(boletaDoc.extracted_amount) : null,
        event_date:        boletaDoc.extracted_date ?? null,
        rut_centro_medico: boletaDoc.extracted_metadata?.provider_rut ?? null,
        rut_medico:        boletaDoc.extracted_metadata?.doctor_rut ?? null,
      }
      const corrections: object[] = []
      for (const [field, userVal] of Object.entries(fields)) {
        if (!userVal) continue
        const ocrVal = ocrValues[field]
        if (userVal === ocrVal) continue  // coincide con OCR, sin corrección
        corrections.push({ document_id: boletaDoc.id, case_id: id, field_name: field, ocr_value: ocrVal, corrected_value: userVal })
      }
      if (corrections.length > 0) {
        await supabase.from('ocr_corrections').insert(corrections)
      }
    }

    setSavingFields(false)
    setEditMode(false)
    await loadCase()
  }

  // ── asignar paciente ──────────────────────────────────────────────────
  async function assignPatient(patientId: string) {
    if (!id || !patientId) return
    setAssigningPatient(true)
    await supabase.from('medical_cases').update({ patient_id: patientId }).eq('id', id)
    setSuggestedPatient(null)
    setAssignPatientId('')
    setAssigningPatient(false)
    await loadCase()
  }

  // ── reimbursement steps ───────────────────────────────────────────────
  async function recordBanmedicaSent() {
    if (!id || !banmedicaDate) return
    setSavingStep('banmedica')
    await supabase.from('medical_cases').update({ banmedica_sent_at: banmedicaDate }).eq('id', id)
    setBanmedicaDate('')
    setSavingStep(null)
    await loadCase()
  }

  async function recordMetlifeSent() {
    if (!id || !metlifeDate) return
    setSavingStep('metlife')
    await supabase.from('medical_cases').update({ metlife_sent_at: metlifeDate }).eq('id', id)
    setMetlifeDate('')
    setSavingStep(null)
    await loadCase()
  }

  async function downloadAllDocs() {
    const allDocs = Object.values(docsByType).filter(Boolean) as CaseDocument[]
    for (const cd of allDocs) {
      await downloadDoc(cd)
      await new Promise(r => setTimeout(r, 400))
    }
  }

  async function generateVumiEmail() {
    if (!caseData || !id) return
    setSendingVumi(true)
    try {
      let correlativo = caseData.correlativo
      if (!correlativo) {
        const { data: allCases } = await supabase
          .from('medical_cases').select('correlativo').not('correlativo', 'is', null)
        const parseCorr = (s: string) => {
          const part = s.includes('-') ? (s.split('-')[1] ?? '0') : s
          return parseInt(part, 10)
        }
        const maxNum = (allCases ?? []).reduce((max: number, c: any) => {
          const n = parseCorr(c.correlativo ?? '0')
          return isNaN(n) ? max : Math.max(max, n)
        }, 0)
        correlativo = String(Math.max(maxNum, 9) + 1)
        await supabase.from('medical_cases').update({ correlativo }).eq('id', id!)
        await loadCase()
      }

      const patientName = (caseData.patient as any)?.full_name ?? 'Paciente'
      const amount = caseData.total_amount
        ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(caseData.total_amount)
        : '—'
      const fechaPrestacion = caseData.event_date ? fmtDateTime(caseData.event_date) : '—'

      // Generar links para cada documento: Drive si existe, sino Supabase (7 días)
      const allDocs = Object.values(docsByType).filter(Boolean) as CaseDocument[]

      // Traer drive_link fresco desde la BD: el estado local puede estar
      // desactualizado si la subida a Drive terminó después de la última carga.
      const docIds = allDocs.map(cd => (cd.document as any)?.id).filter(Boolean)
      const freshDriveLinks = new Map<string, string | null>()
      if (docIds.length > 0) {
        const { data: freshDocs } = await supabase
          .from('documents')
          .select('id, drive_link')
          .in('id', docIds)
        for (const d of freshDocs ?? []) freshDriveLinks.set(d.id, d.drive_link)
      }

      const linkLines: string[] = []
      for (const cd of allDocs) {
        const doc = cd.document as any
        if (!doc?.storage_path) continue
        const label = DOC_FILE_LABEL[cd.role] ?? cd.role
        let driveLink: string | null = freshDriveLinks.get(doc.id) ?? doc.drive_link ?? null

        // Reparación automática: si a este documento nunca se le guardó el
        // link de Drive (subida vieja fallida, condición de carrera, etc.),
        // reintentar la subida ahora mismo, antes de recurrir a Supabase.
        if (!driveLink && isDriveAvailable()) {
          try {
            const { data: blob } = await supabase.storage
              .from('documents')
              .download(doc.storage_path)
            if (blob) {
              const ext = doc.storage_path.split('.').pop() ?? 'bin'
              const driveFile = new File(
                [blob],
                doc.original_name ?? `documento.${ext}`,
                { type: doc.mime_type ?? blob.type }
              )
              driveLink = await uploadToDrive(driveFile)
              await supabase.from('documents').update({ drive_link: driveLink }).eq('id', doc.id)
              console.log('[Drive] link reparado para', doc.id, driveLink)
            }
          } catch (e: any) {
            console.warn('[Drive] reintento de subida falló para', doc.id, e.message)
          }
        }

        if (driveLink) {
          linkLines.push(`${label}\n${driveLink}`)
        } else {
          const { data: signed } = await supabase.storage
            .from('documents')
            .createSignedUrl(doc.storage_path, 7 * 24 * 3600)
          if (signed?.signedUrl) linkLines.push(`${label}\n${signed.signedUrl}`)
        }
      }

      const subject = `Rendición N° ${correlativo} — ${patientName}`
      const body = `Estimados:
Adjunto documentos para reembolso

Nombre: ${patientName}
Boleta: ${caseData.boleta_number ?? '—'}
Fecha Prestación: ${fechaPrestacion}
Monto: ${amount}

Documentos:
${linkLines.join('\n\n')}

Saludos,
Felipe Hurtado`

      const TO = 'xhormazabal@pholmes.cl,reembolso@pholmes.cl'
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(TO)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      window.open(gmailUrl, '_blank')

      setVumiPendingData({ subject, body, correlativo: correlativo! })
      setVumiConfirmOpen(true)
    } finally {
      setSendingVumi(false)
    }
  }

  async function confirmVumiSent() {
    if (!id || !vumiPendingData) return
    setConfirmingVumi(true)
    const now = new Date().toISOString()
    await supabase.from('medical_cases').update({
      vumi_sent_at: now,
      correlativo: vumiPendingData.correlativo,
      status: 'ENVIADO_VUMI',
    }).eq('id', id)
    await supabase.from('email_logs').insert({
      case_id: id,
      insurance: 'vumi',
      status: 'sent',
      subject: vumiPendingData.subject,
      recipient: 'xhormazabal@pholmes.cl,reembolso@pholmes.cl',
      sent_at: now,
      body_preview: vumiPendingData.body.slice(0, 200),
    })
    setVumiConfirmOpen(false)
    setVumiPendingData(null)
    setConfirmingVumi(false)
    await loadCase()
  }

  async function archiveCase() {
    if (!id) return
    setArchiving(true)
    await supabase.from('medical_cases').update({ status: 'ARCHIVADO' }).eq('id', id)
    setArchiving(false)
    await loadCase()
  }

  async function reopenCase(targets: string[]) {
    if (!id || !caseData) return
    setReopening(true)
    const note = reopenNote.trim()
    const updates: Record<string, null | string> = {
      status: 'NUEVA_INFO',
      notes: note || null,
    }
    if (targets.includes('banmedica')) updates.banmedica_sent_at = null
    if (targets.includes('metlife'))   updates.metlife_sent_at   = null
    if (targets.includes('vumi'))      updates.vumi_sent_at      = null
    await supabase.from('medical_cases').update(updates).eq('id', id)
    // Registrar en historial (ignorar error si la tabla no existe)
    await supabase.from('case_status_history').insert({
      case_id: id,
      from_status: caseData.status,
      to_status: 'NUEVA_INFO',
      reason: reopenNote.trim() || null,
    })
    setReopening(false)
    setReopenModalOpen(false)
    setReopenTargets([])
    setReopenNote('')
    await loadCase()
  }

  async function clearSentDate(field: 'banmedica_sent_at' | 'metlife_sent_at' | 'vumi_sent_at') {
    if (!id) return
    setClearingSentDate(field)
    const updates: Record<string, null | string> = { [field]: null }
    // Si se limpia VUMI, también revertir estado a LISTO_PARA_VUMI
    if (field === 'vumi_sent_at' && caseData?.status === 'ENVIADO_VUMI') {
      updates.status = 'LISTO_PARA_VUMI'
    }
    await supabase.from('medical_cases').update(updates).eq('id', id)
    setClearingSentDate(null)
    await loadCase()
  }

  // ── biblioteca de documentos ──────────────────────────────────────────
  async function openLibraryPicker(docType: DocumentType) {
    setLibraryPickerFor(docType)
    setLibrarySearch('')
    setLibraryLoading(true)
    const { data } = await supabase
      .from('documents')
      .select('*')
      .like('storage_path', '%/biblioteca/%')
      .order('created_at', { ascending: false })
    setLibraryDocs((data ?? []) as import('@/lib/types').Document[])
    setLibraryLoading(false)
  }

  async function linkDocToCase(doc: import('@/lib/types').Document, docType: DocumentType) {
    if (!id) return
    setLinkingDoc(doc.id)
    try {
      // Para roles principales, reemplazar el vínculo existente
      if (docType !== 'otro') {
        await supabase.from('case_documents').delete().eq('case_id', id).eq('role', docType)
      }
      const { error } = await supabase.from('case_documents').insert({
        case_id: id,
        document_id: doc.id,
        role: docType,
      })
      if (error) throw error
      // Actualizar flag del caso
      const flagMap: Partial<Record<DocumentType, string>> = {
        boleta: 'has_boleta',
        orden_medica: 'has_orden_medica',
        liquidacion_banmedica: 'has_liquidacion_banmedica',
        liquidacion_metlife: 'has_liquidacion_metlife',
      }
      const flagField = flagMap[docType]
      if (flagField) {
        await supabase.from('medical_cases').update({ [flagField]: true }).eq('id', id)
      }
      setLibraryPickerFor(null)
      await loadCase()
    } catch (err: any) {
      alert('Error al vincular documento: ' + err.message)
    } finally {
      setLinkingDoc(null)
    }
  }

  async function deleteOtroDoc(cd: CaseDocument) {
    const doc = cd.document as any
    if (!window.confirm(`¿Quitar "${doc?.original_name ?? 'este documento'}" del caso?`)) return
    await supabase.from('case_documents').delete().eq('id', cd.id)
    await loadCase()
  }

  async function uploadOtroFiles(files: File[]) {
    if (!files.length) return
    setUploadingOtro(true)
    try {
      for (const file of files) {
        await uploadDoc(file, 'otro')
      }
    } finally {
      setUploadingOtro(false)
    }
  }

  async function deleteCase() {
    if (!id || !window.confirm('¿Mover este caso a la papelera? Podrás restaurarlo o eliminarlo definitivamente desde allí.')) return
    setDeleting(true)
    const { error } = await supabase
      .from('medical_cases')
      .update({ status: 'ELIMINADO' })
      .eq('id', id)
    if (error) { alert('Error: ' + error.message); setDeleting(false); return }
    navigate('/cases')
  }

  // ─────────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="p-8 flex items-center justify-center h-64">
      <Loader2 size={24} className="animate-spin text-green-600" />
    </div>
  )
  if (!caseData) return <div className="p-8 text-gray-500">Caso no encontrado.</div>

  const patient = caseData.patient as any

  // ── Tipo de caso ─────────────────────────────────────────────────────
  const isMedicamento = caseData.case_type === 'medicamento'

  // ── Detección de bono con liquidación incluida ───────────────────────
  // Si la boleta tiene bonif_isapre > 0, el bono ya incluye la liquidación Banmédica
  // y es suficiente para complementario y VUMI también.
  const boletaDoc  = (docsByType['boleta']?.document as any)
  const boletaMeta = boletaDoc?.extracted_metadata as Record<string, any> | null
  const bonoIsapre        = (boletaMeta?.banmedica_bonification    ?? 0) as number
  const bonoComplementario = (boletaMeta?.complementario_bonification ?? 0) as number
  const isBono = bonoIsapre > 0  // bono con cobertura ISAPRE incluida

  // Step 1 (Isapre): para medicamentos siempre está completo (se salta)
  const step1Done   = isMedicamento || caseData.has_liquidacion_banmedica || (isBono && !!caseData.banmedica_sent_at)
  const step2Done   = !!caseData.metlife_sent_at
  const step3Done   = !!caseData.vumi_sent_at
  const needsVumi    = caseData.needs_vumi    !== false  // default true
  const needsMetlife = caseData.needs_metlife !== false  // default true

  // Para VUMI: boleta + orden médica siempre.
  // Liquidación: solo si es atención médica y no es bono con cobertura isapre.
  const hasAllDocs = caseData.has_boleta
    && caseData.has_orden_medica
    && (isMedicamento || isBono || caseData.has_liquidacion_banmedica)
  const canSendVumi = hasAllDocs && !caseData.vumi_sent_at

  // Caso "terminado": todos los pasos requeridos completados (misma lógica que Cases.tsx)
  const isCaseComplete = (!needsMetlife || step2Done) && (!needsVumi || step3Done)

  // Bonificaciones: leer desde liquidación si existe, sino desde boleta (bono)
  const liqBmDoc = (docsByType['liquidacion_banmedica']?.document as any)
  const liqBmMeta = liqBmDoc?.extracted_metadata as Record<string, any> | null
  const bonifIsapre        = (liqBmMeta?.banmedica_bonification    ?? bonoIsapre)        as number | undefined
  const bonifComplementario = (liqBmMeta?.complementario_bonification ?? bonoComplementario) as number | undefined
  const fmtCLP = (n: number) =>
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n)

  return (
    <>
    {/* ── Modal biblioteca de documentos ── */}
    {libraryPickerFor && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: '80vh' }}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-green-600" />
              <h3 className="font-semibold text-gray-900">Seleccionar desde biblioteca</h3>
            </div>
            <button onClick={() => setLibraryPickerFor(null)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
              <X size={16} />
            </button>
          </div>
          <div className="px-5 py-3 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                type="text"
                placeholder="Buscar por nombre…"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                className="input pl-8 text-sm py-1.5 w-full"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-3">
            {libraryLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-green-600" />
              </div>
            ) : (() => {
              const q = librarySearch.toLowerCase().trim()
              const filtered = libraryDocs.filter(d =>
                !q || d.original_name.toLowerCase().includes(q) ||
                (d.extracted_patient_name ?? '').toLowerCase().includes(q)
              )
              if (filtered.length === 0) return (
                <p className="text-sm text-gray-400 text-center py-8 italic">No hay documentos en la biblioteca.</p>
              )
              return (
                <div className="space-y-1.5">
                  {filtered.map(doc => (
                    <button
                      key={doc.id}
                      onClick={() => linkDocToCase(doc, libraryPickerFor!)}
                      disabled={!!linkingDoc}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-green-50 hover:border-green-200 border border-gray-100 transition-colors text-left"
                    >
                      {linkingDoc === doc.id
                        ? <Loader2 size={16} className="text-green-600 animate-spin shrink-0" />
                        : <FileText size={16} className="text-gray-400 shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate font-medium">{doc.original_name}</p>
                        {doc.extracted_patient_name && (
                          <p className="text-xs text-gray-400 truncate">{doc.extracted_patient_name}</p>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">
                        {doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} KB` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>
      </div>
    )}

    {/* ── Visor de documento ── */}
    {viewerUrl && (
      <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
        <div className="flex items-center justify-between px-4 py-3 bg-gray-900 shrink-0">
          <span className="text-sm text-gray-200 truncate max-w-sm">{viewerName}</span>
          <button
            onClick={() => { setViewerUrl(''); setViewerName('') }}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto flex items-start justify-center p-4">
          {viewerPdf
            ? <iframe src={viewerUrl} className="w-full max-w-3xl rounded" style={{ height: 'calc(100vh - 80px)' }} />
            : <img src={viewerUrl} alt={viewerName} className="max-w-3xl w-full rounded shadow-xl object-contain" />
          }
        </div>
      </div>
    )}

    {/* ── Modal confirmación VUMI ── */}
    {vumiConfirmOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <Send size={18} className="text-green-600" />
            </div>
            <h3 className="font-semibold text-gray-900">¿Enviaste el correo?</h3>
          </div>
          <p className="text-sm text-gray-500 mb-5">
            Los documentos se incluyen como links en el correo y se abrió Gmail. Confirmá solo si efectivamente enviaste el correo a VUMI.
          </p>
          <div className="flex gap-3">
            <button
              onClick={confirmVumiSent}
              disabled={confirmingVumi}
              className="btn-primary flex-1"
            >
              {confirmingVumi ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
              Sí, lo envié
            </button>
            <button
              onClick={() => { setVumiConfirmOpen(false); setVumiPendingData(null) }}
              className="btn-secondary flex-1"
            >
              Aún no
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Modal Reabrir ── */}
    {reopenModalOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <RotateCcw size={18} className="text-amber-600" />
            </div>
            <h3 className="font-semibold text-gray-900">Reabrir caso</h3>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            ¿Para cuál seguro necesitas enviar más información? Se limpiará la fecha de envío registrada para que puedas registrarla nuevamente.
          </p>
          <div className="space-y-2 mb-5">
            {[
              { key: 'banmedica', label: 'Banmédica (ISAPRE)',        show: !!(caseData.banmedica_sent_at) && caseData.case_type !== 'medicamento' },
              { key: 'metlife',   label: 'MetLife (Complementario)',  show: !!(caseData.metlife_sent_at) && caseData.needs_metlife !== false },
              { key: 'vumi',      label: 'VUMI',                      show: !!(caseData.vumi_sent_at) && caseData.needs_vumi !== false },
            ].filter(o => o.show).map(({ key, label }) => (
              <label key={key} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reopenTargets.includes(key)}
                  onChange={e => setReopenTargets(prev =>
                    e.target.checked ? [...prev, key] : prev.filter(t => t !== key)
                  )}
                  className="w-4 h-4 accent-green-600"
                />
                <span className="text-sm text-gray-700">{label}</span>
              </label>
            ))}
            {/* Si no hay ninguna fecha registrada (caso solo archivado) */}
            {!caseData.banmedica_sent_at && !caseData.metlife_sent_at && !caseData.vumi_sent_at && (
              <p className="text-xs text-gray-400 italic">No hay envíos registrados — el caso se reabrirá sin limpiar fechas.</p>
            )}
          </div>
          {/* Motivo / detalle */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-gray-600 mb-1">Motivo (opcional)</label>
            <textarea
              value={reopenNote}
              onChange={e => setReopenNote(e.target.value)}
              placeholder="Ej: Solicitaron documentación adicional del médico tratante…"
              rows={3}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 placeholder:text-gray-300"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => reopenCase(reopenTargets)}
              disabled={reopening}
              className="btn-primary flex-1"
            >
              {reopening ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
              Reabrir
            </button>
            <button
              onClick={() => { setReopenModalOpen(false); setReopenTargets([]); setReopenNote('') }}
              className="btn-secondary flex-1"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    )}

    <div className="p-6 max-w-3xl space-y-6">

      {/* ── Header ── */}
      <div>
        <Link to="/cases" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4">
          <ArrowLeft size={16} /> Casos
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              {caseData.correlativo ? (
                <span className="font-mono text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded">
                  {caseData.correlativo}
                </span>
              ) : (
                <button
                  onClick={async () => {
                    // Generar número simple, mínimo desde 10
                    const { data: allCases } = await supabase
                      .from('medical_cases').select('correlativo').not('correlativo', 'is', null)
                    const maxNum = (allCases ?? []).reduce((max: number, c: any) => {
                      const n = parseInt(c.correlativo ?? '0')
                      return isNaN(n) ? max : Math.max(max, n)
                    }, 0)
                    const newCorrelativo = String(Math.max(maxNum, 9) + 1)
                    await supabase.from('medical_cases').update({ correlativo: newCorrelativo }).eq('id', id!)
                    await loadCase()
                  }}
                  className="text-xs text-gray-400 hover:text-green-600 border border-dashed border-gray-200 hover:border-green-300 px-2 py-0.5 rounded transition-colors"
                >
                  + Asignar N°
                </button>
              )}
              {editingTitle ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const t = titleDraft.trim()
                    if (t && t !== caseData.title) {
                      await supabase.from('medical_cases').update({ title: t }).eq('id', id)
                      await loadCase()
                    }
                    setEditingTitle(false)
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    autoFocus
                    value={titleDraft}
                    onChange={e => setTitleDraft(e.target.value)}
                    className="input text-lg font-bold py-0.5 px-2 w-64"
                    onKeyDown={e => e.key === 'Escape' && setEditingTitle(false)}
                  />
                  <button type="submit" className="btn-primary text-xs py-1.5">Guardar</button>
                  <button type="button" onClick={() => setEditingTitle(false)} className="btn-secondary text-xs py-1.5">Cancelar</button>
                </form>
              ) : (
                <h1
                  className="text-xl font-bold text-gray-900 cursor-pointer hover:text-gray-600 group flex items-center gap-1.5"
                  onClick={() => { setTitleDraft(caseData.title ?? ''); setEditingTitle(true) }}
                  title="Haz clic para editar"
                >
                  {caseData.title}
                  <span className="text-gray-300 group-hover:text-gray-400 text-sm font-normal">✎</span>
                </h1>
              )}
              <StatusBadge
                status={caseData.status}
                label={isCaseComplete && !['ARCHIVADO','CERRADO','RECHAZADO','ELIMINADO'].includes(caseData.status) ? 'Completado' : undefined}
                color={isCaseComplete && !['ARCHIVADO','CERRADO','RECHAZADO','ELIMINADO'].includes(caseData.status) ? 'bg-green-100 text-green-700' : undefined}
              />
            </div>
            <p className="text-sm text-gray-400 flex items-center gap-2 mb-0.5">
              {caseData.event_date && <span>{fmtDate(caseData.event_date)}</span>}
              {caseData.boleta_number && (
                <>
                  {caseData.event_date && <span>·</span>}
                  <span>Boleta N° {caseData.boleta_number}</span>
                </>
              )}
            </p>
            <p className="text-sm text-gray-500 flex items-center gap-2">
              {patient?.full_name ?? <span className="italic text-amber-600">Sin paciente</span>}
              {patient && !changingPatient && (
                <button
                  onClick={() => { setChangingPatient(true); setAssignPatientId(caseData.patient_id ?? '') }}
                  className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
                >
                  Cambiar
                </button>
              )}
              {caseData.event_description && <span className="text-gray-400">· {caseData.event_description}</span>}
            </p>

            {/* Banner motivo reapertura */}
            {caseData.status === 'NUEVA_INFO' && !isCaseComplete && (
              <div className="mt-3 flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2.5 text-sm text-orange-800">
                <RotateCcw size={14} className="mt-0.5 shrink-0 text-orange-500" />
                {caseData.notes
                  ? <span><span className="font-medium">Motivo reapertura:</span> {caseData.notes}</span>
                  : <span className="font-medium">Caso en espera de información adicional</span>
                }
              </div>
            )}

            {/* Asignación / cambio de paciente */}
            {(!patient || changingPatient) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {suggestedPatient && !changingPatient ? (
                  <>
                    <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
                      <UserCheck size={13} /> OCR detectó: <strong>{suggestedPatient.full_name}</strong>
                    </span>
                    <button onClick={() => assignPatient(suggestedPatient.id)} disabled={assigningPatient}
                      className="btn-primary text-xs py-1.5">
                      {assigningPatient ? <Loader2 size={12} className="animate-spin" /> : '✓'} Confirmar
                    </button>
                    <button onClick={() => setSuggestedPatient(null)} className="btn-secondary text-xs py-1.5">
                      No es
                    </button>
                  </>
                ) : (
                  <>
                    <select value={assignPatientId} onChange={(e) => setAssignPatientId(e.target.value)}
                      className="select text-xs py-1.5">
                      <option value="">Seleccionar paciente…</option>
                      {patients.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.alias ? `${p.alias} — ${p.full_name}` : p.full_name}
                        </option>
                      ))}
                    </select>
                    {assignPatientId && assignPatientId !== caseData.patient_id && (
                      <button
                        onClick={async () => { await assignPatient(assignPatientId); setChangingPatient(false) }}
                        disabled={assigningPatient}
                        className="btn-primary text-xs py-1.5"
                      >
                        {assigningPatient ? <Loader2 size={12} className="animate-spin" /> : <Users size={13} />} Guardar
                      </button>
                    )}
                    {changingPatient && (
                      <button onClick={() => { setChangingPatient(false); setAssignPatientId('') }}
                        className="btn-secondary text-xs py-1.5">
                        Cancelar
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {(['ARCHIVADO', 'CERRADO', 'RECHAZADO'].includes(caseData.status) || isCaseComplete) ? (
              <button
                onClick={() => { setReopenTargets([]); setReopenModalOpen(true) }}
                className="btn-secondary text-green-600 hover:bg-green-50 hover:border-green-200 text-sm"
              >
                <RotateCcw size={14} />
                Reabrir
              </button>
            ) : (
              !caseData.vumi_sent_at && (
                <button
                  onClick={archiveCase}
                  disabled={archiving}
                  className="btn-secondary text-gray-600 text-sm"
                >
                  {archiving ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                  Archivar
                </button>
              )
            )}
            <button
              onClick={deleteCase}
              disabled={deleting}
              className="btn-secondary text-red-500 hover:bg-red-50 hover:border-red-200 text-sm"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Papelera
            </button>
          </div>
        </div>
      </div>

      {/* ── Aviso boleta duplicada ── */}
      {duplicateWarning && (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 text-sm rounded-xl px-4 py-3 flex items-start justify-between gap-3">
          <span>{duplicateWarning}</span>
          <button onClick={() => setDuplicateWarning(null)} className="shrink-0 text-amber-500 hover:text-amber-700 font-bold">✕</button>
        </div>
      )}

      {/* ── Alerta NUEVA_INFO ── */}
      {caseData.status === 'NUEVA_INFO' && !isCaseComplete && (
        <div className="rounded-2xl border-2 border-orange-300 bg-orange-50 p-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
            <AlertCircle size={20} className="text-orange-500" />
          </div>
          <div>
            <p className="font-semibold text-orange-900">En espera de información adicional</p>
            <p className="text-sm text-orange-700 mt-0.5">
              {caseData.notes
                ? caseData.notes
                : 'La aseguradora solicitó más antecedentes. Sube los documentos requeridos en la sección de abajo.'}
            </p>
          </div>
        </div>
      )}

      {/* ── 1. Documentos ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">1. Documentos</h2>
          <div className="flex gap-1.5">
            <DocPill label="Orden" present={!!docsByType['orden_medica']} />
            <DocPill label="Bono" present={!!docsByType['boleta']} />
            <DocPill
              label="Liquidación"
              present={isBono || !!docsByType['liquidacion_banmedica']}
              byBono={isBono && !docsByType['liquidacion_banmedica']}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {DOC_SLOTS.map((slot) => (
            <DocZone
              key={slot.type}
              slot={slot}
              existing={docsByType[slot.type]}
              uploading={uploadingType === slot.type}
              multi={slot.multi}
              onFile={(file) => uploadDoc(file, slot.type)}
              onDownload={() => { const cd = docsByType[slot.type]; if (cd) downloadDoc(cd) }}
              onDelete={() => { const cd = docsByType[slot.type]; if (cd) deleteDoc(cd) }}
              onView={() => { const cd = docsByType[slot.type]; if (cd) viewDoc(cd) }}
              onPickFromLibrary={() => openLibraryPicker(slot.type)}
            />
          ))}
        </div>

        {/* ── Documentos adicionales (tipo 'otro') ── */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Documentos adicionales</p>
            <button
              onClick={() => openLibraryPicker('otro')}
              className="text-xs text-gray-400 hover:text-green-600 flex items-center gap-1 transition-colors"
            >
              <BookOpen size={12} /> Usar existente
            </button>
          </div>

          {/* Lista de docs adicionales ya subidos */}
          {otroDocs.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {otroDocs.map((cd) => {
                const doc = cd.document as any
                return (
                  <div key={cd.id} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                    <FileText size={14} className="text-gray-400 shrink-0" />
                    <span className="text-xs text-gray-700 flex-1 truncate">{doc?.original_name ?? 'Documento'}</span>
                    <button onClick={() => viewDoc(cd)} className="text-blue-500 hover:text-blue-700" title="Ver"><Eye size={13} /></button>
                    <button onClick={() => downloadDoc(cd)} className="text-green-600 hover:text-green-700" title="Descargar"><Download size={13} /></button>
                    <button onClick={() => deleteOtroDoc(cd)} className="text-red-400 hover:text-red-600" title="Quitar"><Trash2 size={13} /></button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Zona drop */}
          <label
            htmlFor="otro-file-input"
            onDragOver={(e) => { e.preventDefault(); setOtroDragging(true) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOtroDragging(false) }}
            onDrop={(e) => {
              e.preventDefault(); setOtroDragging(false)
              const dropped = Array.from(e.dataTransfer.files)
              if (dropped.length && !uploadingOtro) uploadOtroFiles(dropped)
            }}
            className={clsx(
              'flex items-center justify-center gap-2 border-2 border-dashed rounded-xl py-3 cursor-pointer transition-all select-none',
              uploadingOtro ? 'opacity-60 cursor-wait border-gray-200' :
              otroDragging  ? 'border-green-400 bg-green-50 scale-[1.01]' :
                              'border-gray-200 hover:border-green-300 hover:bg-gray-50'
            )}
          >
            <input
              id="otro-file-input"
              type="file"
              accept="image/*,application/pdf,.pdf,.jpg,.jpeg,.png,.heic,.heif"
              multiple
              className="sr-only"
              disabled={uploadingOtro}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? [])
                e.target.value = ''
                if (picked.length) uploadOtroFiles(picked)
              }}
            />
            {uploadingOtro
              ? <><Loader2 size={14} className="animate-spin text-green-600" /><span className="text-xs text-gray-500">Subiendo…</span></>
              : otroDragging
                ? <><Upload size={14} className="text-green-600" /><span className="text-xs font-medium text-green-700">Suelta aquí</span></>
                : <><Plus size={14} className="text-gray-400" /><span className="text-xs text-gray-500">Arrastra o haz clic para agregar documentos</span></>
            }
          </label>
        </div>
      </div>

      {/* ── 2. Datos de la prestación ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">2. Datos de la prestación</h2>
          {!editMode
            ? <button onClick={() => setEditMode(true)} className="text-xs text-green-600 hover:text-green-700 font-medium">Editar</button>
            : (
              <div className="flex gap-2">
                <button onClick={saveFields} disabled={savingFields} className="btn-primary text-xs py-1.5">
                  {savingFields ? <Loader2 size={13} className="animate-spin" /> : 'Guardar'}
                </button>
                <button onClick={() => setEditMode(false)} className="btn-secondary text-xs py-1.5">Cancelar</button>
              </div>
            )
          }
        </div>

        {/* Hints del OCR: qué extrajo vs. qué está guardado */}
        {(() => {
          const bd = docsByType['boleta']?.document as any
          const ocrHints: Record<string, string | null> = bd ? {
            boleta_number:     bd.extracted_receipt_number ?? null,
            event_date:        bd.extracted_date ?? null,
            total_amount:      bd.extracted_amount != null ? String(bd.extracted_amount) : null,
            rut_centro_medico: bd.extracted_metadata?.provider_rut ?? null,
            rut_medico:        bd.extracted_metadata?.doctor_rut ?? null,
          } : {}
          const hint = (field: string) => ocrHints[field] ?? undefined

          return (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Field label="N° de boleta / bono" edit={editMode}
                value={fields.boleta_number} display={caseData.boleta_number ?? '—'}
                hint={hint('boleta_number')}
                onChange={(v) => setFields((f) => ({ ...f, boleta_number: v }))} />
              <Field label="Fecha de prestación" edit={editMode}
                value={fields.event_date} display={fmtDate(caseData.event_date)}
                hint={hint('event_date')}
                type="date" onChange={(v) => setFields((f) => ({ ...f, event_date: v }))} />
              <Field label="Monto (CLP)" edit={editMode}
                value={fields.total_amount}
                display={caseData.total_amount
                  ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(caseData.total_amount)
                  : '—'}
                hint={hint('total_amount')}
                type="number" onChange={(v) => setFields((f) => ({ ...f, total_amount: v }))} />
              <Field label="RUT centro médico" edit={editMode}
                value={fields.rut_centro_medico} display={caseData.rut_centro_medico ?? '—'}
                hint={hint('rut_centro_medico')}
                onChange={(v) => setFields((f) => ({ ...f, rut_centro_medico: v }))} />
              <Field label="RUT médico" edit={editMode} className="col-span-2"
                value={fields.rut_medico} display={caseData.rut_medico ?? '—'}
                hint={hint('rut_medico')}
                onChange={(v) => setFields((f) => ({ ...f, rut_medico: v }))} />
            </div>
          )
        })()}
      </div>

      {/* ── 3. Reembolsos ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-gray-900">3. Reembolsos</h2>
            {/* Badge tipo de caso — editable */}
            <button
              onClick={async (e) => {
                e.stopPropagation()
                const next = isMedicamento ? 'atencion_medica' : 'medicamento'
                const { error } = await supabase.from('medical_cases').update({ case_type: next }).eq('id', id)
                if (error) { alert('Error al guardar: ' + error.message); return }
                await loadCase()
              }}
              title="Cambiar tipo de caso"
              className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-colors ${
                isMedicamento
                  ? 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                  : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
              }`}
            >
              {isMedicamento ? '💊 Medicamentos' : '🏥 Atención médica'}
            </button>
          </div>
          {/* Pills clickeables — click en rojo/gris para marcar como N/A y viceversa */}
          <div className="flex gap-1.5">
            {!isMedicamento && (
              <DocPill
                label="Isapre" present={step1Done} pending={!!caseData.banmedica_sent_at && !step1Done}
                onToggleNa={!step1Done ? async () => {
                  const { error } = await supabase.from('medical_cases').update({ case_type: 'medicamento' }).eq('id', id)
                  if (error) alert('Error: ' + error.message); else await loadCase()
                } : undefined}
              />
            )}
            {isMedicamento && (
              <DocPill
                label="Isapre" na={true}
                onToggleNa={async () => {
                  const { error } = await supabase.from('medical_cases').update({ case_type: 'atencion_medica' }).eq('id', id)
                  if (error) alert('Error: ' + error.message); else await loadCase()
                }}
              />
            )}
            <DocPill
              label="Complementario" present={step2Done} na={!needsMetlife}
              onToggleNa={!step2Done ? async () => {
                const { error } = await supabase.from('medical_cases').update({ needs_metlife: needsMetlife ? false : true }).eq('id', id)
                if (error) alert('Error: ' + error.message); else await loadCase()
              } : undefined}
            />
            <DocPill
              label="Vumi" present={step3Done} na={!needsVumi}
              onToggleNa={!step3Done ? async () => {
                const { error } = await supabase.from('medical_cases').update({ needs_vumi: needsVumi ? false : true }).eq('id', id)
                if (error) alert('Error: ' + error.message); else await loadCase()
              } : undefined}
            />
          </div>
        </div>
        <div className="space-y-4">

          {/* Banmédica — solo para atención médica */}
          {!isMedicamento && (
          <ReimbursementStep
            number={1}
            label="Banmédica (ISAPRE)"
            done={step1Done}
            pending={!step1Done && !!caseData.banmedica_sent_at}
            doneLabel={isBono ? "Bono incluye liquidación" : "Liquidación subida"}
            sentAt={caseData.banmedica_sent_at}
            onClearDate={step1Done && caseData.banmedica_sent_at ? () => clearSentDate('banmedica_sent_at') : undefined}
          >
            {!step1Done && (
              <div className="mt-3 space-y-2">
                {!caseData.banmedica_sent_at ? (
                  <>
                    <p className="text-xs text-gray-500">
                      Sube la boleta a Banmédica para obtener la liquidación. Cuando lo hagas, registra la fecha.
                    </p>
                    <div className="flex gap-2">
                      <input type="date" value={banmedicaDate} onChange={(e) => setBanmedicaDate(e.target.value)}
                        className="input text-sm py-1.5" />
                      <button onClick={recordBanmedicaSent} disabled={!banmedicaDate || savingStep === 'banmedica'}
                        className="btn-secondary text-sm py-1.5">
                        {savingStep === 'banmedica' ? <Loader2 size={13} className="animate-spin" /> : <Calendar size={13} />}
                        Registrar envío
                      </button>
                    </div>
                  </>
                ) : isBono ? (
                  <p className="text-xs text-blue-700 bg-blue-50 px-3 py-2 rounded-lg">
                    El bono incluye la liquidación Banmédica — no es necesario subir un documento adicional.
                  </p>
                ) : (
                  <p className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                    Enviado el {fmtDate(caseData.banmedica_sent_at)} · Esperando liquidación — súbela en los documentos de arriba
                  </p>
                )}
              </div>
            )}
          </ReimbursementStep>
          )}

          {/* MetLife */}
          {needsMetlife && <ReimbursementStep
            number={isMedicamento ? 1 : 2}
            label="MetLife (Complementario)"
            sublabel="Reembolso seguro complementario"
            done={step2Done}
            pending={!step2Done && !!caseData.metlife_sent_at}
            sentAt={caseData.metlife_sent_at}
            onClearDate={step2Done ? () => clearSentDate('metlife_sent_at') : undefined}
          >
            {/* Mostrar bonificaciones extraídas del bono Banmédica */}
            {(bonifIsapre != null || bonifComplementario != null) && (
              <div className="mt-2 mb-3 text-xs space-y-1 bg-gray-50 rounded-lg px-3 py-2">
                {bonifIsapre != null && (
                  <p className="text-gray-600">
                    <span className="text-gray-400">Bonif. Isapre:</span>{' '}
                    <span className="font-medium text-gray-800">{fmtCLP(bonifIsapre)}</span>
                  </p>
                )}
                {bonifComplementario != null && (
                  <p className={bonifComplementario === 0 ? 'text-amber-700' : 'text-gray-600'}>
                    <span className="text-gray-400">Bonif. Complementario:</span>{' '}
                    <span className="font-medium">{fmtCLP(bonifComplementario)}</span>
                    {bonifComplementario === 0 && (
                      <span className="ml-2 text-amber-700">⚠️ Gestionar manualmente</span>
                    )}
                  </p>
                )}
              </div>
            )}
            {!step2Done && (
              <div className="mt-1">
                <div className="flex gap-2">
                  <input type="date" value={metlifeDate} onChange={(e) => setMetlifeDate(e.target.value)}
                    className="input text-sm py-1.5" />
                  <button onClick={recordMetlifeSent} disabled={!metlifeDate || savingStep === 'metlife'}
                    className="btn-secondary text-sm py-1.5">
                    {savingStep === 'metlife' ? <Loader2 size={13} className="animate-spin" /> : <Calendar size={13} />}
                    Registrar envío
                  </button>
                </div>
              </div>
            )}
          </ReimbursementStep>}

          {/* VUMI */}
          {needsVumi && <ReimbursementStep
            number={(() => {
              let n = isMedicamento ? 0 : 1
              if (needsMetlife) n++
              return n + 1
            })()}
            label="VUMI"
            done={step3Done}
            pending={false}
            sentAt={caseData.vumi_sent_at}
            onClearDate={step3Done ? () => clearSentDate('vumi_sent_at') : undefined}
          >
            {!step3Done && (
              <div className="mt-3">
                {!canSendVumi ? (
                  <div className="text-xs text-red-500 space-y-0.5">
                    {!caseData.has_boleta       && <p>✗ Falta subir la boleta / bono</p>}
                    {!caseData.has_orden_medica  && <p>✗ Falta subir la orden médica</p>}
                    {!isMedicamento && !isBono && !caseData.has_liquidacion_banmedica && (
                      <p>✗ Falta la liquidación Banmédica (o sube un bono que la incluya)</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <button onClick={generateVumiEmail} disabled={sendingVumi} className="btn-primary">
                      {sendingVumi
                        ? <><Loader2 size={16} className="animate-spin" /> Generando...</>
                        : <><Send size={16} /> Generar email VUMI</>
                      }
                    </button>
                    <p className="text-xs text-gray-400">
                      Se abre Gmail con el borrador y los links a los documentos del caso.
                    </p>
                  </div>
                )}
              </div>
            )}
          </ReimbursementStep>}

        </div>
      </div>

    </div>
    </>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

function matchPatient(extractedName: string, patients: Patient[]): Patient | null {
  const normalize = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
  const words = normalize(extractedName).split(/\s+/).filter((w) => w.length > 2)
  if (words.length < 2) return null
  return (
    patients.find((p) => {
      const pWords = normalize(p.full_name).split(/\s+/)
      const matches = words.filter((w) => pWords.includes(w))
      return matches.length >= 2
    }) ?? null
  )
}

// ── Sub-componentes ────────────────────────────────────────────────────

function DocZone({ slot, existing, uploading, multi, onFile, onDownload, onDelete, onView, onPickFromLibrary }: {
  slot: { type: DocumentType; label: string; hint: string }
  existing?: CaseDocument
  uploading: boolean
  multi?: boolean
  onFile: (f: File) => void
  onDownload: () => void
  onDelete: () => void
  onView: () => void
  onPickFromLibrary?: () => void
}) {
  const [dragging,      setDragging]      = useState(false)
  const [previewFile,   setPreviewFile]   = useState<File | null>(null)
  const [previewUrl,    setPreviewUrl]    = useState('')
  const [multiFiles,    setMultiFiles]    = useState<File[]>([])
  const [merging,       setMerging]       = useState(false)
  const doc = (existing?.document as any)
  const inputId = `doc-input-${slot.type}`

  const showOcrStatus = slot.type === 'boleta'
  const ocrDone = showOcrStatus && doc?.ocr_status === 'done'
  const ocrFail = showOcrStatus && doc?.ocr_status === 'failed'
  const ocrProc = showOcrStatus && (doc?.ocr_status === 'processing' || doc?.ocr_status === 'pending')

  function openPreview(file: File) {
    setPreviewFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }
  function cancelPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewFile(null)
    setPreviewUrl('')
    setMultiFiles([])
  }
  function confirmUpload() {
    if (previewFile) { onFile(previewFile); cancelPreview() }
  }
  async function confirmMergeUpload() {
    setMerging(true)
    try {
      const blob   = await mergeFilesToPdf(multiFiles)
      const merged = new File([blob], 'orden_medica_combinada.pdf', { type: 'application/pdf' })
      onFile(merged)
      cancelPreview()
    } catch (e: any) {
      alert('Error al combinar: ' + e.message)
    } finally {
      setMerging(false)
    }
  }
  function moveMultiFile(index: number, direction: -1 | 1) {
    setMultiFiles(prev => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  function removeMultiFile(index: number) {
    setMultiFiles(prev => prev.filter((_, i) => i !== index))
  }

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setDragging(true) }
  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (!files.length || uploading) return
    if (multi && files.length > 1) setMultiFiles(files)
    else openPreview(files[0])
  }
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    if (multi && files.length > 1) setMultiFiles(files)
    else openPreview(files[0])
  }

  const isPdf = previewFile?.type === 'application/pdf'

  return (
    <>
    {/* ── Modal multi-archivo ── */}
    {multiFiles.length > 0 && (
      <div className="fixed inset-0 z-50 flex flex-col bg-black/80">
        <div className="flex items-center justify-between px-4 py-3 bg-gray-900 shrink-0">
          <span className="text-sm text-gray-200">{multiFiles.length} archivos seleccionados</span>
          <div className="flex gap-2 ml-4">
            <button onClick={cancelPreview} className="px-3 py-1.5 rounded-lg text-sm bg-gray-700 text-gray-200 hover:bg-gray-600">
              Cancelar
            </button>
            <button
              onClick={confirmMergeUpload}
              disabled={merging}
              className="px-3 py-1.5 rounded-lg text-sm bg-emerald-500 text-white hover:bg-emerald-600 font-medium flex items-center gap-1.5"
            >
              {merging ? <Loader2 size={14} className="animate-spin" /> : <Files size={14} />}
              {merging ? 'Combinando...' : 'Combinar en 1 PDF y subir'}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <p className="text-gray-400 text-xs mb-4">Se combinarán en este orden (usa las flechas para reordenar):</p>
          <div className="space-y-2 max-w-md">
            {multiFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-3 bg-gray-800 rounded-lg px-4 py-3">
                <span className="text-gray-500 text-xs w-5">{i + 1}</span>
                <FileText size={16} className="text-gray-400 shrink-0" />
                <span className="text-sm text-gray-200 truncate">{f.name}</span>
                <span className="text-xs text-gray-500 ml-auto shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveMultiFile(i, -1)}
                    disabled={i === 0}
                    className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-20 disabled:pointer-events-none"
                    title="Mover arriba"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveMultiFile(i, 1)}
                    disabled={i === multiFiles.length - 1}
                    className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-20 disabled:pointer-events-none"
                    title="Mover abajo"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeMultiFile(i)}
                    className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-gray-700"
                    title="Quitar archivo"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}

    {/* ── Modal preview ── */}
    {previewFile && (
      <div className="fixed inset-0 z-50 flex flex-col bg-black/80" onClick={cancelPreview}>
        <div className="flex items-center justify-between px-4 py-3 bg-gray-900 shrink-0"
             onClick={e => e.stopPropagation()}>
          <span className="text-sm text-gray-200 truncate max-w-xs">{previewFile.name}</span>
          <div className="flex gap-2 ml-4">
            <button
              onClick={cancelPreview}
              className="px-3 py-1.5 rounded-lg text-sm bg-gray-700 text-gray-200 hover:bg-gray-600"
            >
              Cancelar
            </button>
            <button
              onClick={confirmUpload}
              className="px-3 py-1.5 rounded-lg text-sm bg-emerald-500 text-white hover:bg-emerald-600 font-medium"
            >
              Subir este archivo
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto flex items-start justify-center p-4"
             onClick={e => e.stopPropagation()}>
          {isPdf
            ? <iframe src={previewUrl} className="w-full max-w-3xl rounded" style={{ height: 'calc(100vh - 80px)' }} />
            : <img src={previewUrl} alt="preview" className="max-w-3xl w-full rounded shadow-xl object-contain" />
          }
        </div>
      </div>
    )}

    <label
      htmlFor={uploading ? undefined : inputId}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={clsx(
        'block border-2 border-dashed rounded-xl p-4 text-center transition-all select-none',
        uploading ? 'cursor-wait opacity-70' : 'cursor-pointer',
        dragging && 'border-green-400 bg-green-50 scale-[1.02]',
        !dragging && existing && !uploading && 'border-green-200 bg-green-50/40',
        !dragging && !existing && !uploading && 'border-gray-200 hover:border-green-300 hover:bg-gray-50',
      )}
    >
      <input
        id={inputId}
        type="file"
        accept="image/*,application/pdf,.pdf,.jpg,.jpeg,.png,.heic,.heif"
        className="sr-only"
        disabled={uploading}
        multiple={multi}
        onChange={handleChange}
      />

      {uploading ? (
        <div className="py-3 flex flex-col items-center gap-2 text-purple-600">
          <Loader2 size={22} className="animate-spin" />
          <span className="text-xs">Procesando…</span>
        </div>
      ) : dragging ? (
        <div className="py-3 flex flex-col items-center gap-2 text-green-600">
          <Upload size={22} />
          <span className="text-xs font-medium">Suelta aquí</span>
        </div>
      ) : existing ? (
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-1.5">
            {ocrDone && <CheckCircle size={14} className="text-green-600" />}
            {ocrFail && <XCircle size={14} className="text-red-500" />}
            {ocrProc && <Clock size={14} className="text-yellow-500 animate-pulse" />}
            <span className="text-xs font-semibold text-gray-700">{slot.label}</span>
          </div>
          <p className="text-xs text-gray-500 truncate max-w-full">{doc?.original_name}</p>
          <div className="flex items-center justify-center gap-3">
            <span className="text-xs text-gray-400 hover:text-green-600 underline underline-offset-2">
              Reemplazar
            </span>
            {onPickFromLibrary && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPickFromLibrary() }}
                className="text-xs text-gray-400 hover:text-green-600 flex items-center gap-0.5 underline underline-offset-2"
                title="Usar documento de biblioteca"
              >
                <BookOpen size={11} /> Biblioteca
              </button>
            )}
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onView() }}
              className="text-xs text-blue-500 hover:text-blue-700"
              title="Ver"
            >
              <Eye size={12} />
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDownload() }}
              className="text-xs text-green-600 hover:text-green-700"
              title="Descargar"
            >
              <Download size={12} />
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete() }}
              className="text-xs text-red-400 hover:text-red-600"
              title="Eliminar"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ) : (
        <div>
          <Upload size={20} className="mx-auto text-gray-300 mb-2" />
          <p className="text-xs font-medium text-gray-600">{slot.label}</p>
          <p className="text-xs text-gray-400 mt-0.5">{slot.hint}</p>
          {onPickFromLibrary && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPickFromLibrary() }}
              className="mt-2 text-xs text-gray-400 hover:text-green-600 flex items-center gap-1 mx-auto transition-colors"
            >
              <BookOpen size={11} /> Usar existente
            </button>
          )}
        </div>
      )}
    </label>
    </>
  )
}

function Field({ label, value, display, type = 'text', edit, onChange, hint, className }: {
  label: string
  value: string
  display: string
  type?: string
  edit: boolean
  onChange: (v: string) => void
  hint?: string
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-gray-400 mb-1">{label}</dt>
      {edit ? (
        <div>
          <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
            className="input w-full text-sm py-1.5" />
          {hint && hint !== value && (
            <p className="text-xs text-gray-400 mt-0.5">OCR detectó: <span className="font-mono">{hint}</span></p>
          )}
        </div>
      ) : (
        <dd className={`text-sm font-medium ${display === '—' ? 'text-gray-300' : 'text-gray-800'}`}>{display}</dd>
      )}
    </div>
  )
}

function DocPill({ label, present, byBono, pending, na, onToggleNa }: {
  label: string; present?: boolean; byBono?: boolean; pending?: boolean; na?: boolean
  onToggleNa?: () => void
}) {
  const clickable = !!onToggleNa
  const title = na
    ? `Marcar ${label} como necesario`
    : (!present && clickable ? `Marcar ${label} como no necesario` : undefined)

  if (na) return (
    <span
      onClick={onToggleNa}
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-gray-50 text-gray-300 border-gray-100',
        clickable && 'cursor-pointer hover:bg-gray-100 hover:text-gray-400 transition-colors'
      )}
    >
      <span className="w-2.5 text-center">—</span>
      {label}
    </span>
  )
  const colorClass = present
    ? byBono
      ? 'bg-blue-50 text-blue-600 border-blue-200'
      : 'bg-green-50 text-green-700 border-green-200'
    : pending
      ? 'bg-amber-50 text-amber-600 border-amber-200'
      : 'bg-red-50 text-red-500 border-red-200'
  const Icon = present ? Check : pending ? Clock : X
  return (
    <span
      onClick={!present ? onToggleNa : undefined}
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border',
        colorClass,
        !present && clickable && 'cursor-pointer hover:opacity-70 transition-opacity'
      )}
    >
      <Icon size={11} strokeWidth={2.5} />
      {label}
    </span>
  )
}

function ReimbursementStep({ number, label, sublabel, done, doneLabel, sentAt, pending, onClearDate, children }: {
  number: number
  label: string
  sublabel?: string
  done: boolean
  doneLabel?: string
  sentAt?: string | null
  pending?: boolean
  onClearDate?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className={clsx(
      'rounded-xl border p-4',
      done    ? 'border-green-200 bg-green-50/40' :
      pending ? 'border-amber-200 bg-amber-50/30' :
                'border-gray-100 bg-white'
    )}>
      <div className="flex items-start gap-3">
        <div className={clsx(
          'w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 mt-0.5',
          done    ? 'bg-green-500 text-white' :
          pending ? 'bg-amber-400 text-white' :
                    'bg-gray-100 text-gray-400'
        )}>
          {done ? <CheckCircle size={15} /> : number}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={clsx('font-medium text-sm',
              done ? 'text-green-800' : pending ? 'text-amber-800' : 'text-gray-800'
            )}>{label}</p>
            {!done && !pending && (
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Pendiente</span>
            )}
          </div>
          {sublabel && <p className="text-xs text-gray-400 mt-0.5">{sublabel}</p>}
          {done && sentAt && (
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs text-green-600">
                {doneLabel ?? 'Enviado'} · {format(new Date(sentAt), 'dd/MM/yyyy')}
              </p>
              {onClearDate && (
                <button
                  onClick={onClearDate}
                  className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
                  title="Registrar un reenvío"
                >
                  Reenviar
                </button>
              )}
            </div>
          )}
          {pending && sentAt && (
            <p className="text-xs text-amber-600 mt-1">
              Enviado el {format(new Date(sentAt), 'dd/MM/yyyy')} · esperando respuesta
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
