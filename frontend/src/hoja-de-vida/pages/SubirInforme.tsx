import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { analyzeInforme } from '../lib/ocrInformes'
import type { InformeOCRResult } from '../lib/ocrInformes'
import type { TipoExamen, HistorialInforme, HistorialValor } from '../lib/types'
import { hashArrayBuffer } from '../lib/fileHash'
import TipoExamenSelect from '../components/TipoExamenSelect'
import ValoresEditor from '../components/ValoresEditor'
import type { ValorRow } from '../components/ValoresEditor'
import {
  Upload, Loader2, Save, ArrowLeft, Sparkles, AlertCircle, CheckCircle2, SkipForward, Copy, ExternalLink, Clock, Zap,
} from 'lucide-react'

type Step = 'idle' | 'processing' | 'review' | 'saving' | 'uploading'

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

export default function SubirInforme() {
  const { patientId, id: existingInformeId } = useParams<{ patientId: string; id?: string }>()
  const { userId, pendingHistorialFiles, setPendingHistorialFiles } = useStore()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  // Guarda los datos del informe existente cuando estamos en modo "procesar"
  // (informe ya subido antes, pendiente de análisis), para reutilizar su
  // storage_path/bucket al guardar en vez de subir el archivo de nuevo.
  const existingRef = useRef<HistorialInforme | null>(null)

  const [step, setStep] = useState<Step>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState('')
  const [ocr, setOcr] = useState<InformeOCRResult | null>(null)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [showSkip, setShowSkip] = useState(false)
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cola de archivos cuando se suben varios a la vez: se procesan y revisan
  // de a uno, en orden, guardando cada uno antes de pasar al siguiente.
  const [queue, setQueue] = useState<File[]>([])
  const [queueIndex, setQueueIndex] = useState(0)

  // Archivos recién elegidos, a la espera de que el usuario decida si
  // procesarlos ahora (con IA, en vivo) o subirlos todos de inmediato y
  // procesarlos después, uno por uno, cuando quiera.
  const [pendingSelection, setPendingSelection] = useState<File[] | null>(null)
  const [deferredDone, setDeferredDone] = useState(0)
  const [deferredTotal, setDeferredTotal] = useState(0)

  // Detección de duplicados: hash del archivo actual y, si ya existía, el
  // informe con el que coincide.
  const [fileHash, setFileHash] = useState<string | null>(null)
  const [duplicado, setDuplicado] = useState<HistorialInforme | null>(null)

  // formulario
  const [tipoExamenId, setTipoExamenId] = useState<number | null>(null)
  const [fecha, setFecha] = useState('')
  const [institucion, setInstitucion] = useState('')
  const [medico, setMedico] = useState('')
  const [interpretacion, setInterpretacion] = useState('')
  const [notas, setNotas] = useState('')
  const [valores, setValores] = useState<ValorRow[]>([])

  // Si llegamos con archivo(s) soltado(s) en la pantalla de historial, procesarlos de inmediato.
  useEffect(() => {
    if (existingInformeId) {
      loadExistingForProcessing(existingInformeId)
      return
    }
    if (pendingHistorialFiles.length > 0) {
      const files = pendingHistorialFiles
      setPendingHistorialFiles([])
      startQueue(files)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingInformeId])

  // Modo "procesar": el archivo ya está subido (quedó pendiente de un envío
  // diferido); lo descargamos del storage y lo analizamos, sin volver a
  // subirlo ni chequear duplicados (es el mismo documento).
  async function loadExistingForProcessing(id: string) {
    setStep('processing')
    setError('')
    const { data } = await supabase.from('historial_informes').select('*').eq('id', id).single()
    if (!data) { setError('Informe no encontrado'); setStep('review'); return }
    const inf = data as HistorialInforme
    existingRef.current = inf
    const { data: blob, error: dlErr } = await supabase.storage.from(inf.storage_bucket).download(inf.storage_path)
    if (dlErr || !blob) { setError('No se pudo descargar el archivo del informe'); setStep('review'); return }
    const f = new File([blob], inf.storage_path.split('/').pop() || 'informe', { type: inf.mime_type })
    await processFile(f, { skipDuplicateCheck: true })
    // Las notas son manuales del usuario, no las toca la IA — se preservan
    // tal cual estaban, ya que processFile() las resetea como parte del
    // formulario en blanco antes de analizar el archivo de nuevo.
    setNotas(inf.notas ?? '')
  }

  function startQueue(files: File[]) {
    setQueue(files)
    setQueueIndex(0)
    processFile(files[0])
  }

  // Sube todos los archivos de inmediato sin analizarlos, marcados como
  // pendientes (sin tipo de examen todavía). Útil para lotes grandes de
  // informes de laboratorio: no hay que esperar ni completar nada a mano
  // ahora, se procesan más adelante desde el historial, de a uno, cuando
  // la IA esté disponible.
  async function uploadDeferred(files: File[]) {
    if (!userId || !patientId) return
    setStep('uploading')
    setDeferredTotal(files.length)
    setDeferredDone(0)

    for (const f of files) {
      try {
        const buf = await f.arrayBuffer()
        const hash = await hashArrayBuffer(buf)
        const { data: existing } = await supabase
          .from('historial_informes')
          .select('id')
          .eq('patient_id', patientId)
          .eq('file_hash', hash)
          .maybeSingle()
        if (!existing) {
          const ext = f.name.split('.').pop() || 'jpg'
          const path = `${userId}/${patientId}/${Date.now()}-informe.${ext}`
          const { error: upErr } = await supabase.storage.from('hoja-de-vida').upload(path, f)
          if (upErr) throw upErr
          const { error: insErr } = await supabase.from('historial_informes').insert({
            user_id: userId,
            patient_id: patientId,
            tipo_examen_id: null,
            storage_path: path,
            storage_bucket: 'hoja-de-vida',
            mime_type: f.type,
            file_size: f.size,
            file_hash: hash,
            ai_extracted: false,
            needs_review: true,
          })
          if (insErr) throw insErr
        }
      } catch (e: any) {
        console.warn('[HojaDeVida] Error subiendo diferido:', e?.message ?? e)
      }
      setDeferredDone((d) => d + 1)
    }
    navigate(`/hoja-de-vida/${patientId}`)
  }

  // Descarta el archivo actual sin guardarlo y sigue con el próximo de la
  // cola (o vuelve al historial si era el último). Útil si un archivo da
  // error o simplemente no se quiere subir.
  async function skipCurrentFile() {
    clearTimeout(skipTimerRef.current!)
    const nextIndex = queueIndex + 1
    if (nextIndex < queue.length) {
      setQueueIndex(nextIndex)
      await processFile(queue[nextIndex])
    } else {
      navigate(`/hoja-de-vida/${patientId}`)
    }
  }

  function resetForm() {
    setOcr(null)
    setTipoExamenId(null)
    setFecha('')
    setInstitucion('')
    setMedico('')
    setInterpretacion('')
    setNotas('')
    setValores([])
    setFileHash(null)
    setDuplicado(null)
  }

  // Copia los datos de un informe ya existente al formulario, para el caso
  // en que el usuario decida revisar/reutilizar un duplicado detectado.
  async function prefillFromExisting(inf: HistorialInforme) {
    setTipoExamenId(inf.tipo_examen_id)
    setFecha(inf.fecha_examen ?? '')
    setInstitucion(inf.institucion ?? '')
    setMedico(inf.medico_nombre ?? '')
    setInterpretacion(inf.interpretacion ?? '')
    const { data: vals } = await supabase.from('historial_valores').select('*').eq('informe_id', inf.id)
    setValores(((vals ?? []) as HistorialValor[]).map((v) => ({
      nombre_valor: v.nombre_valor,
      valor: v.valor != null ? String(v.valor) : '',
      unidad: v.unidad ?? '',
      rango_min: v.rango_min != null ? String(v.rango_min) : '',
      rango_max: v.rango_max != null ? String(v.rango_max) : '',
    })))
  }

  async function processFile(f: File, opts: { skipDuplicateCheck?: boolean } = {}) {
    setFile(f)
    setFileUrl(URL.createObjectURL(f))
    setStep('processing')
    setError('')
    setShowSkip(false)
    resetForm()

    // Mostrar botón "Saltar" después de 8 segundos, igual que en el flujo de boletas.
    skipTimerRef.current = setTimeout(() => setShowSkip(true), 8_000)

    try {
      const buf = await f.arrayBuffer()
      const hash = await hashArrayBuffer(buf)
      setFileHash(hash)

      // Si ya subimos este mismo archivo antes para este paciente, avisar
      // y no gastar cuota de IA analizándolo de nuevo — se reutilizan sus
      // datos ya guardados como punto de partida. (Se omite en modo
      // "procesar": ahí el archivo YA es ese mismo informe pendiente.)
      if (patientId && !opts.skipDuplicateCheck) {
        const { data: existing } = await supabase
          .from('historial_informes')
          .select('*, tipo_examen:historial_tipos_examen(*)')
          .eq('patient_id', patientId)
          .eq('file_hash', hash)
          .maybeSingle()
        if (existing) {
          clearTimeout(skipTimerRef.current!)
          setShowSkip(false)
          const inf = existing as HistorialInforme
          setDuplicado(inf)
          await prefillFromExisting(inf)
          setStep('review')
          return
        }
      }

      const EMPTY: InformeOCRResult = {
        paciente_nombre: null, fecha_examen: null, tipo_examen_codigo: null,
        institucion: null, medico_nombre: null, interpretacion: null, valores: [], confidence: 0,
        fuente: 'ia',
      }
      // 45s: con varios proveedores de respaldo en cadena (texto y luego
      // visión), el peor caso puede tomar más que los 25s que se usaban
      // antes — un límite muy corto hacía que se descartara una respuesta
      // que iba a llegar bien, solo un poco más tarde.
      const result = await withTimeout(analyzeInforme(buf, f.type), 45_000, EMPTY)
      clearTimeout(skipTimerRef.current!)
      setShowSkip(false)
      // analyzeInforme puede resolver a null si todos los proveedores de IA
      // fallaron (no solo por timeout) — en ese caso se sigue a mano, sin error.
      await applyOcrResult(result ?? EMPTY)
      setStep('review')
    } catch (e: any) {
      clearTimeout(skipTimerRef.current!)
      setShowSkip(false)
      setError(e.message ?? 'Error al analizar el informe')
      setStep('review')
    }
  }

  async function applyOcrResult(result: InformeOCRResult) {
    setOcr(result.confidence > 0 ? result : null)

    if (result.fecha_examen) setFecha(result.fecha_examen)
    if (result.institucion) setInstitucion(result.institucion)
    if (result.medico_nombre) setMedico(result.medico_nombre)
    if (result.interpretacion) setInterpretacion(result.interpretacion)

    if (result.tipo_examen_codigo) {
      const { data: tipo } = await supabase
        .from('historial_tipos_examen').select('*')
        .eq('codigo', result.tipo_examen_codigo).single()
      if (tipo) setTipoExamenId((tipo as TipoExamen).id)
    }

    if (result.valores.length > 0) {
      setValores(result.valores.map((v) => ({
        nombre_valor: v.nombre_valor,
        valor: v.valor != null ? String(v.valor) : '',
        unidad: v.unidad ?? '',
        rango_min: v.rango_min != null ? String(v.rango_min) : '',
        rango_max: v.rango_max != null ? String(v.rango_max) : '',
      })))
    }
  }

  function handleSkipAnalysis() {
    clearTimeout(skipTimerRef.current!)
    setShowSkip(false)
    setOcr(null)
    setStep('review')
  }

  async function handleSave() {
    if (!tipoExamenId) { setError('Selecciona el tipo de examen'); return }
    if (!file || !userId || !patientId) return

    setStep('saving')
    setError('')

    try {
      let informeId: string

      if (existingInformeId && existingRef.current) {
        // Modo "procesar": el archivo ya está en storage, solo actualizamos
        // los datos del informe pendiente — no se sube nada de nuevo.
        const { error: updErr } = await supabase.from('historial_informes').update({
          tipo_examen_id: tipoExamenId,
          fecha_examen: fecha || null,
          institucion: institucion.trim() || null,
          medico_nombre: medico.trim() || null,
          interpretacion: interpretacion.trim() || null,
          notas: notas.trim() || null,
          ai_extracted: !!ocr,
          ai_confidence: ocr?.confidence ?? null,
          needs_review: !ocr || ocr.confidence < 0.6,
          updated_at: new Date().toISOString(),
        }).eq('id', existingInformeId)
        if (updErr) throw updErr
        informeId = existingInformeId
        // Reemplazar valores estructurados por si se procesa más de una vez.
        await supabase.from('historial_valores').delete().eq('informe_id', informeId)
      } else {
        const ext = file.name.split('.').pop() || 'jpg'
        const path = `${userId}/${patientId}/${Date.now()}-informe.${ext}`
        const { error: upErr } = await supabase.storage.from('hoja-de-vida').upload(path, file)
        if (upErr) throw upErr

        const { data: row, error: insErr } = await supabase.from('historial_informes').insert({
          user_id: userId,
          patient_id: patientId,
          tipo_examen_id: tipoExamenId,
          fecha_examen: fecha || null,
          institucion: institucion.trim() || null,
          medico_nombre: medico.trim() || null,
          interpretacion: interpretacion.trim() || null,
          notas: notas.trim() || null,
          storage_path: path,
          storage_bucket: 'hoja-de-vida',
          mime_type: file.type,
          file_size: file.size,
          file_hash: fileHash,
          ai_extracted: !!ocr,
          ai_confidence: ocr?.confidence ?? null,
          needs_review: !ocr || ocr.confidence < 0.6,
        }).select().single()
        if (insErr) throw insErr
        informeId = row.id
      }

      // Guardar valores estructurados (filas con al menos nombre y un número válido)
      const valoresValidos = valores
        .filter((v) => v.nombre_valor.trim() && v.valor.trim() && !isNaN(parseFloat(v.valor)))
        .map((v) => ({
          informe_id: informeId,
          nombre_valor: v.nombre_valor.trim(),
          valor: parseFloat(v.valor),
          unidad: v.unidad.trim() || null,
          rango_min: v.rango_min.trim() && !isNaN(parseFloat(v.rango_min)) ? parseFloat(v.rango_min) : null,
          rango_max: v.rango_max.trim() && !isNaN(parseFloat(v.rango_max)) ? parseFloat(v.rango_max) : null,
        }))
      if (valoresValidos.length > 0) {
        const { error: valErr } = await supabase.from('historial_valores').insert(valoresValidos)
        if (valErr) throw valErr
      }

      const nextIndex = queueIndex + 1
      if (!existingInformeId && nextIndex < queue.length) {
        // Quedan más archivos en la cola: pasar al siguiente automáticamente.
        setQueueIndex(nextIndex)
        await processFile(queue[nextIndex])
      } else {
        navigate(`/hoja-de-vida/${patientId}/informes/${informeId}`)
      }
    } catch (e: any) {
      setError(e.message ?? 'Error al guardar el informe')
      setStep('review')
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) setPendingSelection(files)
  }, [])

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (files.length > 0) setPendingSelection(files)
    e.target.value = ''
  }

  const isPdf = file?.type === 'application/pdf'

  if (step === 'idle' && pendingSelection) return (
    <div className="p-8 max-w-xl">
      <button onClick={() => setPendingSelection(null)} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft size={16} /> Volver
      </button>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        {pendingSelection.length === 1 ? '1 archivo seleccionado' : `${pendingSelection.length} archivos seleccionados`}
      </h1>
      <p className="text-sm text-gray-500 mb-8">¿Cómo quieres procesarlos?</p>

      <div className="space-y-3">
        <button
          onClick={() => { const files = pendingSelection; setPendingSelection(null); startQueue(files) }}
          className="w-full text-left border border-gray-200 rounded-2xl p-4 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors flex items-start gap-3"
        >
          <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
            <Sparkles size={16} className="text-emerald-600" />
          </div>
          <div>
            <p className="font-medium text-gray-900 text-sm">Procesar ahora con IA</p>
            <p className="text-xs text-gray-500 mt-0.5">Revisas y confirmas los datos de cada archivo al momento, uno por uno.</p>
          </div>
        </button>

        <button
          onClick={() => { const files = pendingSelection; setPendingSelection(null); uploadDeferred(files) }}
          className="w-full text-left border border-gray-200 rounded-2xl p-4 hover:border-gray-300 hover:bg-gray-50 transition-colors flex items-start gap-3"
        >
          <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
            <Clock size={16} className="text-gray-500" />
          </div>
          <div>
            <p className="font-medium text-gray-900 text-sm">Subir todo y procesar después</p>
            <p className="text-xs text-gray-500 mt-0.5">Se suben de inmediato, sin esperar. Los procesas con IA cuando quieras desde el historial.</p>
          </div>
        </button>
      </div>
    </div>
  )

  if (step === 'uploading') return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gray-500" />
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold text-gray-800">Subiendo archivos...</p>
        <p className="text-sm text-gray-500 mt-1">{deferredDone} de {deferredTotal}</p>
      </div>
    </div>
  )

  if (step === 'idle') return (
    <div className="p-8 max-w-xl">
      <Link to={`/hoja-de-vida/${patientId}`} className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft size={16} /> Volver al historial
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Subir informe médico</h1>
      <p className="text-sm text-gray-500 mb-8">
        Sube el informe de resultado (PDF o foto) — la IA extrae los datos automáticamente.
        Puedes seleccionar o arrastrar varios archivos a la vez; se revisan y guardan de a uno.
      </p>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          <AlertCircle size={15} className="shrink-0" /> {error}
        </div>
      )}

      <div
        className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors
          ${dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50 hover:bg-white'}`}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => inputRef.current?.click()}
      >
        <Upload size={40} className={`mx-auto mb-4 ${dragOver ? 'text-emerald-500' : 'text-gray-400'}`} />
        <p className="text-base font-medium text-gray-700 mb-1">Arrastra el informe aquí</p>
        <p className="text-sm text-gray-500 mb-4">o haz clic para seleccionar</p>
        <span className="text-xs text-gray-400 bg-white border border-gray-200 rounded-full px-3 py-1">
          JPG · PNG · PDF
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/heic,.pdf"
        onChange={handleInput}
        className="hidden"
      />
    </div>
  )

  if (step === 'processing') return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-5">
      <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-emerald-500" />
      </div>
      <div className="text-center">
        {queue.length > 1 && (
          <p className="text-xs font-medium text-emerald-600 mb-1">Archivo {queueIndex + 1} de {queue.length}</p>
        )}
        <p className="text-lg font-semibold text-gray-800">Analizando informe...</p>
        <p className="text-sm text-gray-500 mt-1">La IA está leyendo el documento</p>
      </div>
      {showSkip && (
        <div className="flex flex-col items-center gap-2 mt-2">
          <button
            onClick={handleSkipAnalysis}
            className="text-sm text-gray-400 hover:text-gray-600 underline underline-offset-2"
          >
            Saltar análisis IA y continuar a mano
          </button>
          {queue.length > 1 && (
            <button
              onClick={skipCurrentFile}
              className="text-sm text-gray-400 hover:text-red-500 underline underline-offset-2 inline-flex items-center gap-1"
            >
              <SkipForward size={13} /> Saltar este archivo y seguir con el siguiente
            </button>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
      <div className="w-[45%] overflow-y-auto bg-gray-100 border-r border-gray-200 p-4">
        {isPdf
          ? <iframe src={fileUrl} className="w-full rounded-lg shadow" style={{ height: 'calc(100vh - 100px)' }} />
          : <img src={fileUrl} alt="Informe" className="w-full rounded-lg shadow-md" />
        }
      </div>

      <div className="w-[55%] overflow-y-auto p-6 space-y-5">
        <div>
          <div className="flex items-center gap-3 mb-3">
            {existingInformeId ? (
              <button onClick={() => navigate(`/hoja-de-vida/${patientId}`)} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600">
                <ArrowLeft size={14} /> Volver al historial
              </button>
            ) : (
              <button onClick={() => { setQueue([]); setQueueIndex(0); setStep('idle') }} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600">
                <ArrowLeft size={14} /> Cambiar archivo
              </button>
            )}
            {queue.length > 1 && (
              <button onClick={skipCurrentFile} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-500">
                <SkipForward size={14} /> Saltar este archivo
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900">Datos del informe</h2>
            {queue.length > 1 && (
              <span className="text-xs font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                {queueIndex + 1} de {queue.length}
              </span>
            )}
          </div>
        </div>

        {duplicado ? (
          <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <Copy size={14} className="shrink-0 mt-0.5" />
            <div className="flex-1">
              <p>
                Este mismo archivo ya fue subido{duplicado.fecha_examen
                  ? ` (examen del ${new Date(duplicado.fecha_examen + 'T00:00:00').toLocaleDateString('es-CL')})`
                  : ''}. Se precargaron sus datos abajo — puedes revisarlos o subirlo de todas formas.
              </p>
              <div className="flex items-center gap-3 mt-1.5">
                <Link to={`/hoja-de-vida/${patientId}/informes/${duplicado.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2">
                  <ExternalLink size={11} /> Ver informe existente
                </Link>
                {queue.length > 1 && (
                  <button onClick={skipCurrentFile} className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-2">
                    <SkipForward size={11} /> Saltar este archivo
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : ocr?.fuente === 'local' ? (
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
            <Zap size={14} className="shrink-0" />
            <span>Leído automáticamente al instante, sin IA (formato reconocido). Revisa y corrige si es necesario.</span>
          </div>
        ) : ocr ? (
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
            <Sparkles size={14} className="shrink-0" />
            <span>IA extrajo los datos del informe. Revisa y corrige si es necesario.</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <AlertCircle size={14} className="shrink-0" />
            <span>No se pudo leer el informe automáticamente. Completa los datos a mano.</span>
          </div>
        )}

        {ocr?.paciente_nombre && (
          <p className="text-xs text-gray-500 -mt-2">
            IA detectó paciente: <strong>"{ocr.paciente_nombre}"</strong> — verifica que corresponde a este historial.
          </p>
        )}

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2.5">
            <AlertCircle size={14} className="shrink-0" /> {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Tipo de examen <span className="text-red-400">*</span>
          </label>
          <TipoExamenSelect
            value={tipoExamenId}
            onChange={(id) => setTipoExamenId(id)}
            detected={!!ocr?.tipo_examen_codigo}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label className="text-xs font-medium text-gray-600">Fecha del examen</label>
              {ocr?.fecha_examen && <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium"><CheckCircle2 size={10} /> IA</span>}
            </div>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="input w-full text-sm" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label className="text-xs font-medium text-gray-600">Institución</label>
              {ocr?.institucion && <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium"><CheckCircle2 size={10} /> IA</span>}
            </div>
            <input value={institucion} onChange={(e) => setInstitucion(e.target.value)} className="input w-full text-sm" placeholder="Laboratorio, clínica..." />
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <label className="text-xs font-medium text-gray-600">Médico</label>
            {ocr?.medico_nombre && <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium"><CheckCircle2 size={10} /> IA</span>}
          </div>
          <input value={medico} onChange={(e) => setMedico(e.target.value)} className="input w-full text-sm" placeholder="Dr./Dra. ..." />
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <label className="text-xs font-medium text-gray-600">Interpretación / hallazgos</label>
            {ocr?.interpretacion && <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium"><CheckCircle2 size={10} /> IA</span>}
          </div>
          <textarea value={interpretacion} onChange={(e) => setInterpretacion(e.target.value)} className="input w-full text-sm" rows={3} placeholder="Resumen del informe..." />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notas (opcional)</label>
          <textarea value={notas} onChange={(e) => setNotas(e.target.value)} className="input w-full text-sm" rows={2} placeholder="Notas adicionales..." />
        </div>

        <ValoresEditor rows={valores} onChange={setValores} aiExtracted={!!ocr} />

        <button onClick={handleSave} disabled={step === 'saving'} className="btn-primary w-full disabled:opacity-50">
          {step === 'saving'
            ? <><Loader2 size={16} className="animate-spin" /> Guardando...</>
            : queueIndex + 1 < queue.length
              ? <><Save size={16} /> Guardar y continuar con el siguiente</>
              : <><Save size={16} /> Guardar en historial</>
          }
        </button>
      </div>
    </div>
  )
}
