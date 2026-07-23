import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { FileText, AlertCircle, CheckCircle, Clock, Upload, RefreshCw, AlertTriangle, Trash2, Eye, Pencil, X, Save, FolderOpen, Copy, ClipboardCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Document, DocumentType } from '@/lib/types'
import { DOC_TYPE_LABELS } from '@/lib/types'
import { deleteFromDrive, renameInDrive, isDriveAvailable, driveFolderLink, localFilePath } from '@/lib/googleDrive'
import EmptyState from '@/components/ui/EmptyState'
import { format } from 'date-fns'
import clsx from 'clsx'

export default function Documents() {
  const [docs, setDocs] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)

  // Visor de documento
  const [viewerUrl, setViewerUrl] = useState('')
  const [viewerName, setViewerName] = useState('')
  const [viewerPdf, setViewerPdf] = useState(false)

  // Edición de documento
  const [editingDoc, setEditingDoc] = useState<Document | null>(null)
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState<DocumentType | ''>('')
  const [editPatient, setEditPatient] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // Copiar ruta local al portapapeles (los navegadores bloquean navegar a
  // links file:// desde una página web, así que copiarla es la alternativa
  // que sí funciona para abrirla en el Explorador de Windows)
  const [copiedPathId, setCopiedPathId] = useState<string | null>(null)
  async function copyLocalPath(id: string, path: string) {
    try {
      await navigator.clipboard.writeText(path)
    } catch {
      window.prompt('Copia esta ruta manualmente:', path)
      return
    }
    setCopiedPathId(id)
    setTimeout(() => setCopiedPathId((cur) => (cur === id ? null : cur)), 1500)
  }

  const allSelected = docs.length > 0 && selected.size === docs.length
  const someSelected = selected.size > 0

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(docs.map((d) => d.id)))
  }

  // Documentos de la biblioteca vinculados a algún caso no se pueden borrar
  // (la BD lo impide con una restricción de integridad) — hay que avisar
  // en vez de dejar el archivo a medio eliminar (storage borrado pero
  // el registro sigue existiendo, lo que rompe "Ver").
  async function findLinkedCases(docIds: string[]): Promise<Set<string>> {
    if (docIds.length === 0) return new Set()
    const { data } = await supabase
      .from('case_documents')
      .select('document_id')
      .in('document_id', docIds)
    return new Set((data ?? []).map((r: any) => r.document_id))
  }

  async function deleteSelected() {
    setDeleting(true)
    const toDelete = docs.filter((d) => selected.has(d.id))

    const linked = await findLinkedCases(toDelete.map((d) => d.id))
    const removable = toDelete.filter((d) => !linked.has(d.id))
    const blocked = toDelete.filter((d) => linked.has(d.id))

    if (blocked.length > 0) {
      window.alert(
        `${blocked.length} documento${blocked.length > 1 ? 's están' : ' está'} vinculado${blocked.length > 1 ? 's' : ''} a un caso y no se puede${blocked.length > 1 ? 'n' : ''} eliminar desde aquí:\n` +
        blocked.map((d) => `• ${d.original_name}`).join('\n') +
        `\n\nQuítalo${blocked.length > 1 ? 's' : ''} primero del caso correspondiente.`
      )
    }
    if (removable.length === 0) { setDeleting(false); return }
    if (!window.confirm(`¿Eliminar ${removable.length} documento${removable.length > 1 ? 's' : ''}? Esta acción no se puede deshacer.`)) {
      setDeleting(false)
      return
    }

    // 1. Borrar primero el registro en la BD (si falla, no tocar storage/Drive)
    const ids = removable.map((d) => d.id)
    const { error } = await supabase.from('documents').delete().in('id', ids)
    if (error) {
      window.alert('No se pudo eliminar: ' + error.message)
      setDeleting(false)
      return
    }

    // 2. Borrar del storage
    const storagePaths = removable.map((d) => d.storage_path)
    if (storagePaths.length > 0)
      await supabase.storage.from('documents').remove(storagePaths)

    // 3. Borrar de Drive
    if (isDriveAvailable()) {
      for (const d of removable) {
        if (d.drive_link) {
          deleteFromDrive(d.drive_link).catch(e =>
            console.warn('[Drive] delete failed:', e.message)
          )
        }
      }
    }

    setDocs((prev) => prev.filter((d) => !ids.includes(d.id)))
    setSelected(new Set())
    setDeleting(false)
  }

  async function deleteOne(doc: Document) {
    const linked = await findLinkedCases([doc.id])
    if (linked.has(doc.id)) {
      window.alert(`"${doc.original_name}" está vinculado a un caso y no se puede eliminar desde aquí. Quítalo primero del caso correspondiente.`)
      return
    }
    if (!window.confirm(`¿Eliminar "${doc.original_name}"?`)) return

    // 1. Borrar primero el registro en la BD (si falla, no tocar storage/Drive)
    const { error } = await supabase.from('documents').delete().eq('id', doc.id)
    if (error) {
      window.alert('No se pudo eliminar: ' + error.message)
      return
    }

    // 2. Borrar del storage
    await supabase.storage.from('documents').remove([doc.storage_path])

    // 3. Borrar de Drive
    if (doc.drive_link && isDriveAvailable()) {
      deleteFromDrive(doc.drive_link).catch(e =>
        console.warn('[Drive] delete failed:', e.message)
      )
    }

    setDocs((prev) => prev.filter((d) => d.id !== doc.id))
    setSelected((prev) => { const next = new Set(prev); next.delete(doc.id); return next })
  }

  async function viewDoc(doc: Document) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.storage_path, 3600)
    if (!data?.signedUrl) return
    setViewerUrl(data.signedUrl)
    setViewerName(doc.original_name)
    setViewerPdf(doc.mime_type === 'application/pdf')
  }

  function openEdit(doc: Document) {
    setEditingDoc(doc)
    setEditName(doc.original_name)
    setEditType(doc.doc_type ?? '')
    setEditPatient(doc.extracted_patient_name ?? '')
    setEditAmount(doc.extracted_amount != null ? String(doc.extracted_amount) : '')
  }

  function closeEdit() {
    setEditingDoc(null)
  }

  async function saveEdit() {
    if (!editingDoc) return
    const name = editName.trim()
    if (!name) return
    setSavingEdit(true)

    const updates: Partial<Document> = {
      original_name: name,
      doc_type: (editType || null) as DocumentType | null,
      extracted_patient_name: editPatient.trim() || null,
      extracted_amount: editAmount.trim() ? Number(editAmount.trim()) : null,
    }

    const { error } = await supabase.from('documents').update(updates).eq('id', editingDoc.id)
    if (!error) {
      // Renombrar también en Drive si el nombre cambió
      if (name !== editingDoc.original_name && editingDoc.drive_link && isDriveAvailable()) {
        renameInDrive(editingDoc.drive_link, name).catch(e =>
          console.warn('[Drive] rename failed:', e.message)
        )
      }
      setDocs((prev) => prev.map((d) => (d.id === editingDoc.id ? { ...d, ...updates } : d)))
      setEditingDoc(null)
    } else {
      window.alert('No se pudo guardar: ' + error.message)
    }
    setSavingEdit(false)
  }

  const loadDocs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)

    const { data } = await supabase
      .from('documents')
      .select('*')
      .like('storage_path', '%/biblioteca/%')
      .order('created_at', { ascending: false })

    if (data) setDocs(data as Document[])
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => { loadDocs() }, [loadDocs])

  useEffect(() => {
    const hasProcessing = docs.some(
      (d) => d.ocr_status === 'pending' || d.ocr_status === 'processing'
    )
    if (!hasProcessing) return
    const timer = setInterval(() => loadDocs(true), 3000)
    return () => clearInterval(timer)
  }, [docs, loadDocs])

  function ocrBadge(doc: Document) {
    switch (doc.ocr_status) {
      case 'done':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
            <CheckCircle size={11} /> Procesado
          </span>
        )
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full animate-pulse">
            <Clock size={11} /> Analizando...
          </span>
        )
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full">
            <Clock size={11} /> Pendiente
          </span>
        )
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full" title={doc.ocr_error ?? ''}>
            <AlertCircle size={11} /> Error OCR
          </span>
        )
    }
  }

  function confidenceDot(confidence: number | null) {
    if (confidence == null) return null
    const pct = Math.round(confidence * 100)
    const color = pct >= 85 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-red-500'
    return <span className={clsx('text-xs font-medium', color)}>{pct}%</span>
  }

  function formatAmount(doc: Document) {
    if (!doc.extracted_amount) return '—'
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: doc.extracted_currency ?? 'CLP',
      maximumFractionDigits: 0,
    }).format(doc.extracted_amount)
  }

  function formatSize(bytes: number | null) {
    if (!bytes) return '—'
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const processingCount = docs.filter(
    (d) => d.ocr_status === 'pending' || d.ocr_status === 'processing'
  ).length

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Biblioteca de documentos</h1>
          <p className="text-sm text-gray-500 mt-1">
            Documentos guardados aquí se pueden reusar en cualquier caso · {docs.length} documento{docs.length !== 1 ? 's' : ''}
            {processingCount > 0 && (
              <span className="ml-2 text-purple-600 animate-pulse">
                · {processingCount} analizando con IA...
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {someSelected && (
            <button
              onClick={deleteSelected}
              disabled={deleting}
              className="btn-secondary text-red-600 hover:bg-red-50 hover:border-red-200"
            >
              <Trash2 size={15} />
              {deleting ? 'Eliminando...' : `Eliminar ${selected.size}`}
            </button>
          )}
          <button
            onClick={() => loadDocs(true)}
            disabled={refreshing}
            className="btn-secondary"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            Actualizar
          </button>
          <Link to="/upload" className="btn-primary">
            <Upload size={16} /> Subir más
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No hay documentos"
          description="Sube documentos médicos para comenzar."
          action={<Link to="/upload" className="btn-secondary">Subir documentos</Link>}
        />
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-xs text-gray-400">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-300 text-green-600 cursor-pointer"
                    title="Seleccionar todos"
                  />
                </th>
                <th className="text-left px-5 py-3 font-medium">Archivo</th>
                <th className="text-left px-5 py-3 font-medium">Tipo detectado</th>
                <th className="text-left px-5 py-3 font-medium">Paciente</th>
                <th className="text-left px-5 py-3 font-medium">Monto</th>
                <th className="text-left px-5 py-3 font-medium">Confianza</th>
                <th className="text-left px-5 py-3 font-medium">Estado OCR</th>
                <th className="text-left px-5 py-3 font-medium">Subido</th>
                <th className="px-3 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {docs.map((d) => {
                const isSelected = selected.has(d.id)
                return (
                  <tr
                    key={d.id}
                    className={clsx(
                      'hover:bg-gray-50 transition-colors',
                      isSelected && 'bg-green-50/60',
                      !isSelected && d.needs_review && 'bg-yellow-50/40'
                    )}
                  >
                    <td className="px-4 py-4 w-10">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(d.id)}
                        className="rounded border-gray-300 text-green-600 cursor-pointer"
                      />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-gray-400 shrink-0" />
                        <div>
                          <p className="font-medium text-gray-900 truncate max-w-[200px]">
                            {d.original_name}
                          </p>
                          <p className="text-xs text-gray-400">{formatSize(d.file_size)}</p>
                        </div>
                        {d.needs_review && (
                          <span title="Requiere revisión manual">
                            <AlertTriangle size={14} className="text-yellow-500 shrink-0" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-600">
                      {d.doc_type
                        ? <span className="font-medium">{DOC_TYPE_LABELS[d.doc_type]}</span>
                        : <span className="text-gray-300 italic">Sin clasificar</span>
                      }
                    </td>
                    <td className="px-5 py-4 text-gray-600">
                      {d.extracted_patient_name || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-4 text-gray-700 font-medium">
                      {formatAmount(d)}
                    </td>
                    <td className="px-5 py-4">
                      {confidenceDot(d.ai_confidence)}
                    </td>
                    <td className="px-5 py-4">
                      {ocrBadge(d)}
                    </td>
                    <td className="px-5 py-4 text-gray-400 text-xs whitespace-nowrap">
                      {format(new Date(d.created_at), 'dd/MM/yy HH:mm')}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => viewDoc(d)}
                          className="text-gray-300 hover:text-blue-500 transition-colors"
                          title="Ver"
                        >
                          <Eye size={15} />
                        </button>
                        {d.drive_link && (
                          <a
                            href={driveFolderLink(d.drive_link)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-gray-300 hover:text-amber-500 transition-colors"
                            title="Ver ubicación en Drive"
                          >
                            <FolderOpen size={15} />
                          </a>
                        )}
                        {d.drive_link && localFilePath(d.original_name, 'Docs') && (
                          <button
                            onClick={() => copyLocalPath(d.id, localFilePath(d.original_name, 'Docs')!)}
                            className={copiedPathId === d.id ? 'text-green-600' : 'text-gray-300 hover:text-gray-600 transition-colors'}
                            title="Copiar ruta local (pégala en el Explorador)"
                          >
                            {copiedPathId === d.id ? <ClipboardCheck size={15} /> : <Copy size={15} />}
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(d)}
                          className="text-gray-300 hover:text-green-600 transition-colors"
                          title="Editar / renombrar"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => deleteOne(d)}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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

      {/* ── Editar / renombrar documento ── */}
      {editingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Editar documento</h2>
              <button onClick={closeEdit} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Nombre del archivo</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="input w-full"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Tipo de documento</label>
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as DocumentType | '')}
                  className="input w-full"
                >
                  <option value="">Sin clasificar</option>
                  {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Paciente</label>
                <input
                  type="text"
                  value={editPatient}
                  onChange={(e) => setEditPatient(e.target.value)}
                  className="input w-full"
                  placeholder="Nombre del paciente"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Monto</label>
                <input
                  type="number"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="input w-full"
                  placeholder="0"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={closeEdit} className="btn-secondary">Cancelar</button>
              <button onClick={saveEdit} disabled={savingEdit || !editName.trim()} className="btn-primary">
                <Save size={15} />
                {savingEdit ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
