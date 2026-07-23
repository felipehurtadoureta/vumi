import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import {
  Upload as UploadIcon, X, CheckCircle, AlertCircle,
  FileText, Loader2, Sparkles,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { processDocument } from '@/lib/ocr'
import { uploadToDrive, getAccessToken, isDriveAvailable } from '@/lib/googleDrive'
import { useStore } from '@/store/useStore'
import clsx from 'clsx'

type UploadStatus = 'pending' | 'uploading' | 'uploaded' | 'ocr_processing' | 'drive_uploading' | 'done' | 'error'

interface UploadFile {
  file: File
  status: UploadStatus
  error?: string
  docId?: string
  driveLink?: string
  ocrResult?: {
    doc_type?: string
    extracted_patient_name?: string | null
    extracted_amount?: number | null
    extracted_provider?: string | null
    ai_confidence?: number
  }
}

const ACCEPTED_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
}

const DOC_TYPE_LABELS: Record<string, string> = {
  boleta: 'Boleta',
  orden_medica: 'Orden médica',
  liquidacion_banmedica: 'Liq. Banmédica',
  liquidacion_metlife: 'Liq. MetLife',
  otro: 'Otro',
}

export default function Upload() {
  const { userId } = useStore()
  const [files, setFiles] = useState<UploadFile[]>([])
  const [uploading, setUploading] = useState(false)

  const onDrop = useCallback((accepted: File[]) => {
    const newFiles = accepted.map((f) => ({ file: f, status: 'pending' as const }))
    setFiles((prev) => [...prev, ...newFiles])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    multiple: true,
  })

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  function setFileStatus(idx: number, patch: Partial<UploadFile>) {
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
  }

  async function uploadAll() {
    if (!userId || files.filter((f) => f.status === 'pending').length === 0) return
    setUploading(true)

    // Obtener token de Drive AHORA, mientras estamos en el contexto del click del usuario
    // (después de awaits el browser puede bloquear el popup)
    let driveReady = false
    if (isDriveAvailable()) {
      try {
        await getAccessToken()
        driveReady = true
      } catch (e) {
        console.warn('[Drive] No se pudo obtener token — los archivos no se copiarán a Drive:', e)
      }
    }

    for (let i = 0; i < files.length; i++) {
      if (files[i].status !== 'pending') continue

      setFileStatus(i, { status: 'uploading' })

      try {
        const f = files[i].file
        const ext = f.name.split('.').pop()
        const filename = `${userId}/biblioteca/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

        // 1. Subir a Supabase Storage
        const { error: storageErr } = await supabase.storage
          .from('documents')
          .upload(filename, f, { contentType: f.type })

        if (storageErr) throw storageErr

        // 2. Crear registro en DB
        const { data: doc, error: dbErr } = await supabase
          .from('documents')
          .insert({
            user_id: userId,
            filename,
            original_name: f.name,
            mime_type: f.type,
            file_size: f.size,
            storage_path: filename,
            storage_bucket: 'documents',
            ocr_status: 'not_required',
          })
          .select()
          .single()

        if (dbErr) throw dbErr

        // Biblioteca: sin OCR, subir directo
        if (driveReady) {
          setFileStatus(i, { status: 'drive_uploading', docId: doc.id })
          try {
            const driveLink = await uploadToDrive(new File([f], f.name, { type: f.type }), 'Docs')
            await supabase.from('documents').update({ drive_link: driveLink }).eq('id', doc.id)
            setFileStatus(i, { status: 'done', driveLink, docId: doc.id })
          } catch {
            setFileStatus(i, { status: 'done', docId: doc.id })
          }
        } else {
          setFileStatus(i, { status: 'done', docId: doc.id })
        }
      } catch (err: any) {
        setFileStatus(i, { status: 'error', error: err.message })
      }
    }

    setUploading(false)
  }

  const pending = files.filter((f) => f.status === 'pending').length
  const done = files.filter((f) => f.status === 'done').length
  const anyProcessing = files.some((f) => f.status === 'uploading' || f.status === 'ocr_processing')

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatAmount(amount: number | null | undefined) {
    if (amount == null) return null
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(amount)
  }

  function statusIcon(f: UploadFile) {
    switch (f.status) {
      case 'pending':
        return (
          <button onClick={() => removeFile(files.indexOf(f))} className="text-gray-300 hover:text-red-500 transition-colors">
            <X size={16} />
          </button>
        )
      case 'uploading':
        return <Loader2 size={16} className="text-blue-500 animate-spin" />
      case 'ocr_processing':
        return <Sparkles size={16} className="text-purple-500 animate-pulse" />
      case 'drive_uploading':
        return <Loader2 size={16} className="text-blue-400 animate-spin" />
      case 'done':
        return <CheckCircle size={16} className="text-green-500" />
      case 'error':
        return (
          <div title={f.error}>
            <AlertCircle size={16} className="text-red-500" />
          </div>
        )
      default:
        return null
    }
  }

  function statusLabel(f: UploadFile) {
    switch (f.status) {
      case 'pending':     return null
      case 'uploading':      return <span className="text-xs text-blue-500">Subiendo...</span>
      case 'ocr_processing': return <span className="text-xs text-purple-500">Analizando con IA...</span>
      case 'drive_uploading': return <span className="text-xs text-blue-400">Copiando a Drive...</span>
      case 'error':       return <span className="text-xs text-red-500">{f.error}</span>
      case 'done': {
        const ocrParts: string[] = []
        if (f.ocrResult?.doc_type) ocrParts.push(DOC_TYPE_LABELS[f.ocrResult.doc_type] ?? f.ocrResult.doc_type)
        if (f.ocrResult?.extracted_patient_name) ocrParts.push(f.ocrResult.extracted_patient_name)
        if (f.ocrResult?.extracted_amount) ocrParts.push(formatAmount(f.ocrResult.extracted_amount) ?? '')
        return (
          <span className="text-xs">
            {ocrParts.length > 0
              ? <span className="text-green-700">{ocrParts.join(' · ')}</span>
              : <span className="text-green-600">Guardado en biblioteca</span>
            }
            {f.driveLink && (
              <a href={f.driveLink} target="_blank" rel="noreferrer"
                className="ml-2 text-blue-500 hover:underline">▲ Drive</a>
            )}
            {f.error && <span className="ml-2 text-amber-500" title={f.error}>⚠</span>}
          </span>
        )
      }
      default:
        return null
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Subir a biblioteca</h1>
        <p className="text-sm text-gray-500 mt-1">PDF, JPG o PNG — máx. 50 MB por archivo. Los documentos guardados aquí se pueden reusar en cualquier caso.</p>
      </div>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={clsx(
          'border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors mb-6',
          isDragActive
            ? 'border-green-500 bg-green-50'
            : 'border-gray-200 hover:border-green-400 hover:bg-gray-50'
        )}
      >
        <input {...getInputProps()} />
        <UploadIcon
          size={32}
          className={clsx('mx-auto mb-3', isDragActive ? 'text-green-600' : 'text-gray-300')}
        />
        {isDragActive ? (
          <p className="text-green-700 font-medium">Suelta los archivos aquí</p>
        ) : (
          <>
            <p className="text-gray-600 font-medium mb-1">Arrastra archivos aquí</p>
            <p className="text-sm text-gray-400">o haz clic para seleccionarlos</p>
          </>
        )}
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="card mb-6">
          <div className="space-y-4">
            {files.map((f, i) => (
              <div key={i} className="flex items-start gap-3">
                <FileText size={18} className="text-gray-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{f.file.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-400">{formatSize(f.file.size)}</span>
                    {statusLabel(f)}
                  </div>
                </div>
                <div className="shrink-0 mt-0.5">
                  {statusIcon(f)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {files.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={uploadAll}
            disabled={uploading || pending === 0}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {anyProcessing ? (
              <><Loader2 size={16} className="animate-spin" /> Procesando...</>
            ) : (
              <><UploadIcon size={16} /> Subir {pending} archivo{pending !== 1 ? 's' : ''}</>
            )}
          </button>

          {done > 0 && !uploading && (
            <span className="text-sm text-green-600 font-medium">
              ✓ {done} procesado{done !== 1 ? 's' : ''}
            </span>
          )}

          <button
            onClick={() => setFiles([])}
            disabled={uploading}
            className="btn-secondary ml-auto disabled:opacity-50"
          >
            Limpiar
          </button>
        </div>
      )}
    </div>
  )
}
