import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { analyzeFile } from '@/lib/ocr'
import type { OCRResult } from '@/lib/ocr'
import { uploadToDrive, getAccessToken, isDriveAvailable } from '@/lib/googleDrive'
import type { Patient } from '@/lib/types'
import {
  Upload, Loader2, FolderPlus, ArrowLeft,
  Sparkles, AlertCircle, CheckCircle2,
} from 'lucide-react'

// ── helpers ──────────────────────────────────────────────

function matchPatient(name: string, patients: Patient[]): Patient | null {
  if (!name || patients.length === 0) return null
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim()
  const words = norm(name).split(/\s+/).filter(w => w.length > 2)
  if (words.length < 2) return null
  return patients.find(p => {
    const pWords = norm(p.full_name).split(/\s+/)
    return words.filter(w => pWords.includes(w)).length >= 2
  }) ?? null
}

function getInitials(fullName: string): string {
  return fullName.split(/\s+/).map(w => w[0] ?? '').join('').toUpperCase().slice(0, 4) || 'XX'
}

// ── sub-component: campo con indicador IA ─────────────────

function Field({
  label, value, onChange, type = 'text', detected,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  detected?: boolean
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <label className="block text-xs font-medium text-gray-600">{label}</label>
        {detected && (
          <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium">
            <CheckCircle2 size={10} /> IA
          </span>
        )}
      </div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input w-full text-sm"
      />
    </div>
  )
}

// ── main ─────────────────────────────────────────────────

type Step = 'idle' | 'processing' | 'duplicate' | 'review' | 'creating'

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ])
}

interface DuplicateInfo { id: string; title: string; correlativo: string }

export default function NewCase() {
  const { userId } = useStore()
  const navigate   = useNavigate()
  const inputRef   = useRef<HTMLInputElement>(null)

  const [step,            setStep]          = useState<Step>('idle')
  const [file,            setFile]          = useState<File | null>(null)
  const [fileUrl,         setFileUrl]       = useState('')
  const [storagePath,     setStoragePath]   = useState('')
  const [ocr,             setOcr]           = useState<OCRResult | null>(null)
  const [patients,        setPatients]      = useState<Patient[]>([])
  const [error,           setError]         = useState('')
  const [dragOver,        setDragOver]      = useState(false)
  const [duplicateCase,   setDuplicateCase] = useState<DuplicateInfo | null>(null)
  const [showSkip,        setShowSkip]      = useState(false)
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // form fields
  const [title,     setTitle]     = useState('')
  const [caseType,  setCaseType]  = useState<'atencion_medica' | 'medicamento'>('atencion_medica')
  const [patientId, setPatientId] = useState('')
  const [boletaNum, setBoletaNum] = useState('')
  const [fecha,     setFecha]     = useState('')
  const [monto,     setMonto]     = useState('')
  const [rutCentro, setRutCentro] = useState('')
  const [rutMedico, setRutMedico] = useState('')
  const [numBanmedica, setNumBanmedica] = useState('')
  const [numComplementario, setNumComplementario] = useState('')

  useEffect(() => {
    if (!userId) return
    supabase.from('patients').select('*')
      .eq('user_id', userId).eq('is_active', true)
      .then(({ data }: { data: Patient[] | null }) => { if (data) setPatients(data) })
  }, [userId])

  // ── pre-rellenar formulario desde OCR ──────────────────
  function fillForm(result: OCRResult) {
    setBoletaNum(result.extracted_receipt_number ?? '')
    setFecha(result.extracted_date ?? '')
    setMonto(result.extracted_amount?.toString() ?? '')
    setRutCentro(result.extracted_metadata?.provider_rut ?? '')
    setRutMedico(result.extracted_metadata?.doctor_rut ?? '')
    if (result.extracted_patient_name) {
      const matched = matchPatient(result.extracted_patient_name, patients)
      if (matched) setPatientId(matched.id)
    }
  }

  // ── procesar archivo ────────────────────────────────────
  async function processFile(f: File) {
    setFile(f)
    setFileUrl(URL.createObjectURL(f))
    setStep('processing')
    setError('')
    setShowSkip(false)
    setDuplicateCase(null)

    // Mostrar botón "Saltar" después de 8 segundos
    skipTimerRef.current = setTimeout(() => setShowSkip(true), 8_000)

    try {
      // 1. OCR primero (antes de subir) — timeout de 45s
      const buf    = await f.arrayBuffer()
      const EMPTY: import('@/lib/ocr').OCRResult = {
        doc_type: 'otro', extracted_date: null, extracted_amount: null,
        extracted_currency: 'CLP', extracted_provider: null,
        extracted_receipt_number: null, extracted_patient_name: null,
        extracted_metadata: {}, insurance_hint: null, ai_confidence: 0, ocr_raw_text: '',
      }
      const result = await withTimeout(analyzeFile(buf, f.type), 45_000, EMPTY)
      clearTimeout(skipTimerRef.current!)
      setShowSkip(false)
      setOcr(result.ai_confidence > 0 ? result : null)
      if (result.ai_confidence > 0) fillForm(result)

      // 2. Verificar duplicado por número de boleta
      if (result.extracted_receipt_number && userId) {
        const { data: existing } = await supabase
          .from('medical_cases')
          .select('id, title, correlativo')
          .eq('user_id', userId)
          .eq('boleta_number', result.extracted_receipt_number)
          .limit(1)
        if (existing && existing.length > 0) {
          setDuplicateCase(existing[0] as DuplicateInfo)
          setStep('duplicate')
          return
        }
      }

      // 3. Subir a Supabase (solo si no es duplicado)
      await uploadAndContinue(f)
    } catch (e: any) {
      clearTimeout(skipTimerRef.current!)
      setShowSkip(false)
      setError(e.message ?? 'Error al procesar el archivo')
      setStep('idle')
    }
  }

  // ── subir archivo a Supabase ─────────────────────────────
  async function uploadAndContinue(f: File) {
    const ext  = f.name.split('.').pop() || 'jpg'
    const path = `${userId}/${Date.now()}-boleta.${ext}`
    const { error: upErr } = await supabase.storage.from('documents').upload(path, f)
    if (upErr) throw upErr
    setStoragePath(path)
    setStep('review')
  }

  // ── continuar aunque sea duplicado ───────────────────────
  async function handleContinueDuplicate() {
    if (!file) return
    setStep('processing')
    try {
      await uploadAndContinue(file)
    } catch (e: any) {
      setError(e.message ?? 'Error al subir el archivo')
      setStep('idle')
    }
  }

  // ── crear caso ──────────────────────────────────────────
  async function handleCreate() {
    if (!title.trim()) { setError('Escribe un título para el caso'); return }
    setStep('creating')
    setError('')

    // Pedir token Drive AHORA mientras estamos en contexto de click del usuario
    let driveReady = false
    if (isDriveAvailable()) {
      try { await getAccessToken(); driveReady = true }
      catch { /* no bloquear si Drive falla */ }
    }

    try {
      const patient  = patients.find(p => p.id === patientId)
      const initials = patient?.initials ?? (patient ? getInitials(patient.full_name) : 'XX')
      const ext      = file!.name.split('.').pop() || 'jpg'

      // 1. Generar correlativo: número simple (1, 2, 3...) mínimo desde 10
      const { data: allCases } = await supabase
        .from('medical_cases')
        .select('correlativo')
        .not('correlativo', 'is', null)
      const parseCorr = (s: string) => {
        // Formato viejo: "2026-000003" → tomar solo el número después del guion
        // Formato nuevo: "10", "11" → parsear directo
        const part = s.includes('-') ? (s.split('-')[1] ?? '0') : s
        return parseInt(part, 10)
      }
      const maxNum = (allCases ?? []).reduce((max: number, c: any) => {
        const n = parseCorr(c.correlativo ?? '0')
        return isNaN(n) ? max : Math.max(max, n)
      }, 0)
      const correlativo = String(Math.max(maxNum, 9) + 1)

      // 2. Crear caso con correlativo ya asignado
      const { data: mc, error: mcErr } = await supabase.from('medical_cases').insert({
        user_id:           userId,
        patient_id:        patientId || null,
        correlativo,
        case_type:         caseType,
        title:             title.trim(),
        boleta_number:     boletaNum || null,
        event_date:        fecha || null,
        total_amount:      monto ? parseInt(monto) : null,
        rut_centro_medico: rutCentro || null,
        rut_medico:        rutMedico || null,
        numero_banmedica:      numBanmedica      || null,
        numero_complementario: numComplementario || null,
        status:            'INCOMPLETO',
        currency:          'CLP',
      }).select().single()
      if (mcErr) throw mcErr

      const docName = `${correlativo}_Boleta_${initials}.${ext}`

      // 3. Crear documento
      const { data: doc, error: docErr } = await supabase.from('documents').insert({
        user_id:                  userId,
        filename:                 storagePath.split('/').pop(),
        original_name:            docName,
        mime_type:                file!.type,
        file_size:                file!.size,
        storage_path:             storagePath,
        storage_bucket:           'documents',
        doc_type:                 'boleta',
        ocr_status:               'done',
        extracted_receipt_number: ocr?.extracted_receipt_number ?? null,
        extracted_date:           ocr?.extracted_date ?? null,
        extracted_amount:         ocr?.extracted_amount ?? null,
        extracted_currency:       'CLP',
        extracted_patient_name:   ocr?.extracted_patient_name ?? null,
        extracted_metadata:       ocr?.extracted_metadata ?? null,
        insurance_hint:           ocr?.insurance_hint ?? null,
        ai_confidence:            ocr?.ai_confidence ?? null,
        ocr_raw_text:             ocr?.ocr_raw_text ?? null,
        needs_review:             false,
        is_duplicate:             false,
      }).select().single()
      if (docErr) throw docErr

      // Vincular al caso como boleta
      await supabase.from('case_documents').insert({
        case_id:     mc.id,
        document_id: doc.id,
        role:        'boleta',
      })

      // ── Lógica de bono Banmédica ──────────────────────────
      const bonifIsapre        = ocr?.extracted_metadata?.banmedica_bonification ?? 0
      const bonifComplementario = ocr?.extracted_metadata?.complementario_bonification ?? 0
      const isBono = bonifIsapre > 0 || bonifComplementario > 0

      if (isBono) {
        const caseUpdates: Record<string, string | null | boolean> = {}

        // Si la isapre ya bonificó → el bono incluye la liquidación, no hace
        // falta subir un documento aparte. NOTA: no se puede vincular el
        // mismo documento dos veces con otro rol (case_documents.document_id
        // es UNIQUE) — el trigger de la base de datos (update_case_completeness)
        // ya detecta este caso leyendo el monto de la boleta directamente,
        // así que acá solo hace falta autocompletar la fecha de envío.
        if (bonifIsapre > 0) {
          if (fecha) caseUpdates.banmedica_sent_at = fecha
        }

        // Si el complementario ya bonificó → marcar paso 2 como completo
        if (bonifComplementario > 0 && fecha) {
          caseUpdates.metlife_sent_at = fecha
        }

        if (Object.keys(caseUpdates).length > 0) {
          await supabase.from('medical_cases').update(caseUpdates).eq('id', mc.id)
        }
      }

      // Subir a Drive con el nombre ya calculado (en background, no bloquea)
      // IMPORTANTE: hay que guardar el drive_link resultante en el documento.
      // Si no se guarda, cualquier acción posterior que revise "¿tiene link
      // de Drive?" (ej. generar el correo a VUMI) cree que nunca se subió y
      // lo vuelve a subir — creando un archivo duplicado en Drive.
      if (driveReady && file) {
        const driveFile = new File([file], docName, { type: file.type })
        uploadToDrive(driveFile)
          .then(driveLink =>
            supabase.from('documents').update({ drive_link: driveLink }).eq('id', doc.id)
          )
          .catch(e => console.warn('[Drive] NewCase upload failed:', e.message))
      }

      navigate(`/cases/${mc.id}`)
    } catch (e: any) {
      setError(e.message ?? 'Error al crear el caso')
      setStep('review')
    }
  }

  // ── drag & drop ──────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }, [patients])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) processFile(f)
  }

  const patient = patients.find(p => p.id === patientId)
  const isPdf   = file?.type === 'application/pdf'

  // ─────────────────────────────────────────────────────────
  // RENDER: idle
  // ─────────────────────────────────────────────────────────
  if (step === 'idle') return (
    <div className="p-8 max-w-xl">
      <Link to="/cases" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft size={16} /> Volver a casos
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Nuevo caso</h1>
      <p className="text-sm text-gray-500 mb-8">
        Sube la boleta primero — la IA extrae los datos automáticamente.
      </p>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          <AlertCircle size={15} className="shrink-0" /> {error}
        </div>
      )}

      <div
        className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors
          ${dragOver
            ? 'border-emerald-400 bg-emerald-50'
            : 'border-gray-300 hover:border-gray-400 bg-gray-50 hover:bg-white'
          }`}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={40} className={`mx-auto mb-4 ${dragOver ? 'text-emerald-500' : 'text-gray-400'}`} />
        <p className="text-base font-medium text-gray-700 mb-1">Arrastra la boleta aquí</p>
        <p className="text-sm text-gray-500 mb-4">o haz clic para seleccionar</p>
        <span className="text-xs text-gray-400 bg-white border border-gray-200 rounded-full px-3 py-1">
          JPG · PNG · PDF
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,.pdf"
        onChange={handleInput}
        className="hidden"
      />
    </div>
  )

  // ─────────────────────────────────────────────────────────
  // RENDER: processing
  // ─────────────────────────────────────────────────────────
  if (step === 'processing') return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-5">
      <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-emerald-500" />
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold text-gray-800">Analizando boleta...</p>
        <p className="text-sm text-gray-500 mt-1">La IA está leyendo los datos</p>
      </div>
      {showSkip && (
        <button
          onClick={async () => {
            clearTimeout(skipTimerRef.current!)
            setShowSkip(false)
            setOcr(null)
            if (file) await uploadAndContinue(file)
          }}
          className="text-sm text-gray-400 hover:text-gray-600 underline underline-offset-2 mt-2"
        >
          Saltar análisis IA y continuar a mano
        </button>
      )}
    </div>
  )

  // ─────────────────────────────────────────────────────────
  // RENDER: duplicate warning
  // ─────────────────────────────────────────────────────────
  if (step === 'duplicate') return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-6 max-w-md mx-auto text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center">
        <AlertCircle size={32} className="text-amber-500" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Boleta ya registrada</h2>
        <p className="text-sm text-gray-600">
          La boleta <strong>N° {ocr?.extracted_receipt_number}</strong> ya existe en el caso:
        </p>
        <button
          onClick={() => navigate(`/cases/${duplicateCase?.id}`)}
          className="mt-2 text-sm font-medium text-emerald-600 hover:underline"
        >
          #{duplicateCase?.correlativo} — {duplicateCase?.title}
        </button>
      </div>
      <div className="flex flex-col gap-2 w-full">
        <button
          onClick={() => navigate(`/cases/${duplicateCase?.id}`)}
          className="btn-primary w-full"
        >
          Ir al caso existente
        </button>
        <button
          onClick={handleContinueDuplicate}
          className="text-sm text-gray-500 hover:text-gray-700 py-2"
        >
          Crear de todas formas
        </button>
        <button
          onClick={() => setStep('idle')}
          className="text-sm text-gray-400 hover:text-gray-600 py-1"
        >
          Cancelar
        </button>
      </div>
    </div>
  )

  // ─────────────────────────────────────────────────────────
  // RENDER: review — pantalla dividida
  // ─────────────────────────────────────────────────────────
  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>

      {/* ── Izquierda: preview imagen / PDF ── */}
      <div className="w-[45%] overflow-y-auto bg-gray-100 border-r border-gray-200 p-4">
        {isPdf
          ? <iframe
              src={fileUrl}
              className="w-full rounded-lg shadow"
              style={{ height: 'calc(100vh - 100px)' }}
            />
          : <img src={fileUrl} alt="Boleta" className="w-full rounded-lg shadow-md" />
        }
      </div>

      {/* ── Derecha: formulario ── */}
      <div className="w-[55%] overflow-y-auto p-6 space-y-5">

        <div>
          <button
            onClick={() => setStep('idle')}
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-3"
          >
            <ArrowLeft size={14} /> Cambiar archivo
          </button>
          <h2 className="text-xl font-bold text-gray-900">Datos del caso</h2>
        </div>

        {/* Banner IA */}
        {ocr && (
      
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
            <Sparkles size={14} className="shrink-0" />
            <span>IA extrajo los datos de la boleta. Revisa y corrige si es necesario.</span>
          </div>
        )}

        {/* Banner bono Banmédica */}
        {(() => {
          const bi = ocr?.extracted_metadata?.banmedica_bonification ?? 0
          const bc = ocr?.extracted_metadata?.complementario_bonification ?? 0
          if (!bi && !bc) return null
          const fmtCLP = (n: number) => n.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
          return (
            <div className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-xl px-3 py-2.5 space-y-1">
              <p className="font-medium">Bono con cobertura detectada:</p>
              {bi > 0 && <p className="text-xs">✓ Banmédica (ISAPRE): {fmtCLP(bi)} — paso 1 se marcará automáticamente</p>}
              {bc > 0 && <p className="text-xs">✓ Complementario: {fmtCLP(bc)} — paso 2 se marcará automáticamente</p>}
              {bc === 0 && <p className="text-xs text-amber-700">⚠ Complementario: $0 — quedará pendiente</p>}
              <p className="text-xs text-blue-600">Solo quedará pendiente el reembolso VUMI.</p>
            </div>
          )
        })()}

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2.5">
            <AlertCircle size={14} className="shrink-0" /> {error}
          </div>
        )}

        {/* Tipo de caso */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Tipo de caso</label>
          <div className="flex gap-2">
            {([
              { value: 'atencion_medica', label: '🏥 Atención médica', desc: 'Requiere liquidación Banmédica' },
              { value: 'medicamento',     label: '💊 Medicamentos',    desc: 'Va directo a Complementario y VUMI' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setCaseType(opt.value)}
                className={`flex-1 text-left px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                  caseType === opt.value
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                <p className="font-medium">{opt.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Título */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Título del caso <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Ej: Kinesiología HIP, Farmacia Liga Epilepsia..."
            className="input w-full"
            autoFocus
          />
        </div>

        {/* Paciente */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Paciente</label>
          <select
            value={patientId}
            onChange={e => setPatientId(e.target.value)}
            className="input w-full"
          >
            <option value="">Sin asignar</option>
            {patients.map(p => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
          {ocr?.extracted_patient_name && !patientId && (
            <p className="text-xs text-amber-600 mt-1">
              IA detectó: <strong>"{ocr.extracted_patient_name}"</strong> — selecciona el paciente arriba
            </p>
          )}
          {patientId && (
            <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
              <CheckCircle2 size={10} />
              {ocr?.extracted_patient_name ? 'Paciente detectado automáticamente' : 'Paciente asignado'}
            </p>
          )}
        </div>

        {/* Datos boleta — grid 2 col */}
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="N° boleta / bono"
            value={boletaNum}
            onChange={setBoletaNum}
            detected={!!ocr?.extracted_receipt_number}
          />
          <Field
            label="Fecha de prestación"
            value={fecha}
            onChange={setFecha}
            type="date"
            detected={!!ocr?.extracted_date}
          />
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label className="text-xs font-medium text-gray-600">Monto (CLP)</label>
              {ocr?.extracted_amount && (
                <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium">
                  <CheckCircle2 size={10} /> IA
                </span>
              )}
            </div>
            <input
              type="text"
              inputMode="numeric"
              value={monto ? parseInt(monto).toLocaleString('es-CL') : ''}
              onChange={e => setMonto(e.target.value.replace(/\D/g, ''))}
              placeholder="0"
              className="input w-full text-sm"
            />
          </div>
          <Field
            label="RUT centro médico"
            value={rutCentro}
            onChange={setRutCentro}
            detected={!!ocr?.extracted_metadata?.provider_rut}
          />
        </div>

        <Field
          label="RUT médico / profesional"
          value={rutMedico}
          onChange={setRutMedico}
          detected={!!ocr?.extracted_metadata?.doctor_rut}
        />

        {/* Números de referencia — llenado manual */}
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="N° Banmédica"
            value={numBanmedica}
            onChange={setNumBanmedica}
          />
          <Field
            label="N° Complementario"
            value={numComplementario}
            onChange={setNumComplementario}
          />
        </div>

        {/* Preview nombre del archivo */}
        <div className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
          <span className="font-medium text-gray-500">Archivo: </span>
          <span className="font-mono text-gray-600">
            {`[N°]_Boleta_${patient ? getInitials(patient.full_name) : 'XX'}.${file?.name.split('.').pop() ?? 'jpg'}`}
          </span>
          <span className="text-gray-400 ml-1">(el número se asigna al crear)</span>
        </div>

        {/* Botón */}
        <button
          onClick={handleCreate}
          disabled={step === 'creating'}
          className="btn-primary w-full disabled:opacity-50"
        >
          {step === 'creating'
            ? <><Loader2 size={16} className="animate-spin" /> Creando caso...</>
            : <><FolderPlus size={16} /> Crear caso</>
          }
        </button>

      </div>
    </div>
  )
}
