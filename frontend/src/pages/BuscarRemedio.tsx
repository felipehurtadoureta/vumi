import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Pill, Search, Eye, X, ExternalLink, RefreshCw, Pencil, Save, AlertTriangle, FolderOpen, Loader2,
} from 'lucide-react'
import { format } from 'date-fns'
import clsx from 'clsx'
import { supabase } from '@/lib/supabase'
import { indexDocument, isIndexed, normalize, saveManualMeds, type MedIndex } from '@/lib/medIndex'

// ─────────────────────────────────────────────
// Tipos locales
// ─────────────────────────────────────────────

interface CaseRef {
  id: string
  title: string | null
  correlativo: string | null
  event_date: string | null
  event_description: string | null
  status: string
  patientName: string | null
}

interface OrderDoc {
  id: string
  original_name: string
  mime_type: string
  storage_path: string
  drive_link: string | null
  ocr_raw_text: string | null
  extracted_metadata: Record<string, unknown> | null
  created_at: string
  cases: CaseRef[]
}

interface Hit {
  doc: OrderDoc
  meds: string[]        // medicamentos que calzan
  snippet: string | null
  where: string[]       // en qué campos calzó
}

const SNIPPET_RADIUS = 70

function metaOf(doc: OrderDoc): MedIndex {
  return (doc.extracted_metadata ?? {}) as MedIndex
}

function docDate(doc: OrderDoc): string {
  return doc.cases.map((c) => c.event_date).find(Boolean) ?? doc.created_at
}

function makeSnippet(text: string, term: string): string | null {
  const nText = normalize(text)
  const i = nText.indexOf(term)
  if (i < 0) return null
  const start = Math.max(0, i - SNIPPET_RADIUS)
  const end = Math.min(text.length, i + term.length + SNIPPET_RADIUS)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`
}

/** Resalta el término en un texto (sin tildes ni mayúsculas para comparar). */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>
  const nText = normalize(text)
  const parts: React.ReactNode[] = []
  let from = 0
  let i = nText.indexOf(term, from)
  while (i >= 0) {
    if (i > from) parts.push(text.slice(from, i))
    parts.push(<mark key={i} className="bg-yellow-200 text-gray-900 rounded px-0.5">{text.slice(i, i + term.length)}</mark>)
    from = i + term.length
    i = nText.indexOf(term, from)
  }
  if (from < text.length) parts.push(text.slice(from))
  return <>{parts}</>
}

function searchDocs(docs: OrderDoc[], rawTerm: string): Hit[] {
  const term = normalize(rawTerm.trim())
  if (term.length < 3) return []
  const hits: Hit[] = []
  for (const doc of docs) {
    const meta = metaOf(doc)
    const where: string[] = []
    const meds = (meta.medicamentos ?? []).filter((m) => normalize(m).includes(term))
    if (meds.length) where.push('remedios')

    const texto = meta.texto_indexado ?? ''
    let snippet = texto ? makeSnippet(texto, term) : null
    if (snippet) where.push('texto de la orden')

    if (!snippet && doc.ocr_raw_text) {
      snippet = makeSnippet(doc.ocr_raw_text, term)
      if (snippet) where.push('texto de la orden')
    }
    if (normalize(doc.original_name).includes(term)) where.push('nombre del archivo')
    const caseMatch = doc.cases.some((c) =>
      normalize(`${c.title ?? ''} ${c.event_description ?? ''}`).includes(term),
    )
    if (caseMatch) where.push('título del caso')

    if (where.length) hits.push({ doc, meds, snippet, where })
  }
  // Primero los que calzan en la lista de remedios, luego por fecha descendente
  return hits.sort((a, b) => {
    if (!!b.meds.length !== !!a.meds.length) return b.meds.length ? 1 : -1
    return docDate(b.doc).localeCompare(docDate(a.doc))
  })
}

// ─────────────────────────────────────────────
// Página
// ─────────────────────────────────────────────

export default function BuscarRemedio() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [patientFilter, setPatientFilter] = useState('')
  const [docs, setDocs] = useState<OrderDoc[]>([])
  const [loading, setLoading] = useState(true)

  // Indexación en lote
  const [indexing, setIndexing] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const cancelRef = useRef(false)
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  // Visor
  const [viewer, setViewer] = useState<{ url: string; name: string; pdf: boolean } | null>(null)

  // Edición manual de remedios
  const [editing, setEditing] = useState<OrderDoc | null>(null)
  const [editMeds, setEditMeds] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const docCols = 'id, original_name, mime_type, storage_path, drive_link, ocr_raw_text, extracted_metadata, created_at'
    const [{ data: linked }, { data: loose }] = await Promise.all([
      supabase
        .from('case_documents')
        .select(`role, case:medical_cases(id, title, correlativo, event_date, event_description, status, patient:patients(full_name, alias)), document:documents(${docCols})`)
        .in('role', ['orden_medica', 'otro']),
      // Órdenes en la biblioteca que aún no están en ningún caso
      supabase.from('documents').select(docCols).eq('doc_type', 'orden_medica'),
    ])

    const byId = new Map<string, OrderDoc>()
    for (const row of (linked ?? []) as any[]) {
      const d = row.document
      const c = row.case
      if (!d || !c || c.status === 'ELIMINADO') continue
      const entry = byId.get(d.id) ?? { ...d, cases: [] }
      entry.cases.push({
        id: c.id,
        title: c.title,
        correlativo: c.correlativo,
        event_date: c.event_date,
        event_description: c.event_description,
        status: c.status,
        patientName: c.patient?.alias || c.patient?.full_name || null,
      })
      byId.set(d.id, entry)
    }
    for (const d of (loose ?? []) as any[]) {
      if (!byId.has(d.id)) byId.set(d.id, { ...d, cases: [] })
    }
    setDocs([...byId.values()])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Mantener ?q= en la URL para poder guardar o compartir el link de búsqueda
  useEffect(() => {
    const t = setTimeout(() => {
      const q = query.trim()
      setParams(q ? { q } : {}, { replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [query, setParams])

  const patients = useMemo(() => {
    const s = new Set<string>()
    docs.forEach((d) => d.cases.forEach((c) => c.patientName && s.add(c.patientName)))
    return [...s].sort()
  }, [docs])

  const scopedDocs = useMemo(
    () => (patientFilter ? docs.filter((d) => d.cases.some((c) => c.patientName === patientFilter)) : docs),
    [docs, patientFilter],
  )
  const hits = useMemo(() => searchDocs(scopedDocs, query), [scopedDocs, query])
  const term = normalize(query.trim())

  const pending = useMemo(() => docs.filter((d) => !isIndexed(d.extracted_metadata)), [docs])
  const failed = useMemo(() => docs.filter((d) => !!metaOf(d).indice_error), [docs])

  function patchDoc(id: string, meta: Record<string, unknown>) {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, extracted_metadata: meta } : d)))
  }

  async function indexPending() {
    cancelRef.current = false
    setIndexing(true)
    const list = [...pending]
    setProgress({ done: 0, total: list.length })
    for (let i = 0; i < list.length; i++) {
      if (cancelRef.current) break
      const meta = await indexDocument(list[i])
      patchDoc(list[i].id, meta)
      setProgress({ done: i + 1, total: list.length })
    }
    setIndexing(false)
  }

  async function reindexOne(doc: OrderDoc) {
    setRowBusy(doc.id)
    const meta = await indexDocument(doc)
    patchDoc(doc.id, meta)
    setRowBusy(null)
  }

  async function view(doc: OrderDoc) {
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.storage_path, 3600)
    if (!data?.signedUrl) { alert('No se pudo abrir el archivo.'); return }
    setViewer({ url: data.signedUrl, name: doc.original_name, pdf: doc.mime_type === 'application/pdf' })
  }

  function openEdit(doc: OrderDoc) {
    setEditing(doc)
    setEditMeds((metaOf(doc).medicamentos ?? []).join('\n'))
  }

  async function saveEdit() {
    if (!editing) return
    setSavingEdit(true)
    try {
      const meds = editMeds.split(/\n|,/).map((m) => m.trim()).filter(Boolean)
      const meta = await saveManualMeds(editing.id, editing.extracted_metadata, meds)
      patchDoc(editing.id, meta)
      setEditing(null)
    } catch (e: any) {
      alert(`No se pudo guardar: ${e.message}`)
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <Pill size={20} className="text-green-600" /> Buscar remedio
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Busca un medicamento dentro de las órdenes médicas y recetas guardadas, y abre el archivo donde aparece.
        </p>
      </div>

      {/* Buscador */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ej.: rosuvastatina, Planiden, celecoxib…"
            className="w-full pl-9 pr-9 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={patientFilter}
          onChange={(e) => setPatientFilter(e.target.value)}
          className="py-2.5 px-3 rounded-lg border border-gray-300 text-sm bg-white"
        >
          <option value="">Todos los pacientes</option>
          {patients.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Estado del índice */}
      {!loading && (pending.length > 0 || indexing) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1 text-amber-800">
            {indexing
              ? <>Leyendo órdenes… {progress.done} de {progress.total}</>
              : <>
                  {pending.length} de {docs.length} órdenes todavía no se han leído, así que la búsqueda no las encuentra por su contenido.
                  {failed.length > 0 && <> ({failed.length} con error de lectura)</>}
                </>}
          </div>
          {indexing
            ? <button onClick={() => { cancelRef.current = true }} className="px-3 py-1.5 rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100">Detener</button>
            : <button onClick={indexPending} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 flex items-center gap-1.5">
                <RefreshCw size={14} /> Leer órdenes pendientes
              </button>}
        </div>
      )}

      {/* Resultados */}
      {loading ? (
        <div className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando órdenes…</div>
      ) : term.length < 3 ? (
        <p className="text-sm text-gray-400">Escribe al menos 3 letras. Se buscan nombres comerciales y genéricos; las tildes y mayúsculas no importan.</p>
      ) : hits.length === 0 ? (
        <p className="text-sm text-gray-500">
          No se encontró «{query.trim()}» en {scopedDocs.length} órdenes. Prueba con el nombre genérico o el comercial
          {pending.length > 0 && ', o lee primero las órdenes pendientes'}.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">{hits.length} {hits.length === 1 ? 'documento' : 'documentos'}</p>
          {hits.map(({ doc, meds, snippet, where }) => {
            const meta = metaOf(doc)
            const date = docDate(doc)
            return (
              <div key={doc.id} className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{doc.original_name}</div>
                    <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                      {date && <span>{format(new Date(date.length === 10 ? `${date}T12:00:00` : date), 'dd-MM-yyyy')}</span>}
                      {[...new Set(doc.cases.map((c) => c.patientName).filter(Boolean))].map((p) => <span key={p!}>{p}</span>)}
                      <span className="text-gray-400">calza en: {where.join(', ')}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => view(doc)} className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs hover:bg-green-700 flex items-center gap-1">
                      <Eye size={13} /> Ver archivo
                    </button>
                    {doc.drive_link && (
                      <a href={doc.drive_link} target="_blank" rel="noreferrer" title="Abrir en Drive"
                         className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><ExternalLink size={15} /></a>
                    )}
                    <button onClick={() => openEdit(doc)} title="Corregir remedios" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Pencil size={15} /></button>
                    <button onClick={() => reindexOne(doc)} disabled={rowBusy === doc.id} title="Volver a leer" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50">
                      <RefreshCw size={15} className={clsx(rowBusy === doc.id && 'animate-spin')} />
                    </button>
                  </div>
                </div>

                {(meta.medicamentos?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {meta.medicamentos!.map((m, i) => (
                      <span key={i} className={clsx(
                        'text-xs px-2 py-0.5 rounded-full border',
                        meds.includes(m) ? 'bg-yellow-50 border-yellow-300 text-gray-900' : 'bg-gray-50 border-gray-200 text-gray-600',
                      )}>
                        <Highlight text={m} term={term} />
                      </span>
                    ))}
                  </div>
                )}

                {snippet && !meds.length && (
                  <p className="text-xs text-gray-600 bg-gray-50 rounded p-2"><Highlight text={snippet} term={term} /></p>
                )}

                {doc.cases.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {doc.cases.map((c) => (
                      <Link key={c.id} to={`/cases/${c.id}`} className="text-xs text-green-700 hover:underline flex items-center gap-1">
                        <FolderOpen size={12} /> {c.correlativo ? `${c.correlativo} · ` : ''}{c.title ?? 'Caso sin título'}
                      </Link>
                    ))}
                  </div>
                )}
                {meta.indice_fuente === 'manual' && <p className="text-[11px] text-gray-400">Remedios corregidos a mano</p>}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-gray-400 flex items-start gap-1.5">
        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
        La lectura automática de recetas manuscritas puede equivocarse. Si un remedio no aparece donde debería, ábrelo y corrige la lista con el lápiz.
      </p>

      {/* Visor */}
      {viewer && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/90">
          <div className="flex items-center justify-between px-4 py-3 bg-gray-900 shrink-0 gap-3">
            <span className="text-sm text-gray-200 truncate">{viewer.name}</span>
            <div className="flex items-center gap-1">
              <a href={viewer.url} target="_blank" rel="noreferrer" title="Abrir en pestaña nueva"
                 className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700"><ExternalLink size={18} /></a>
              <button onClick={() => setViewer(null)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700"><X size={18} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-auto flex items-start justify-center p-4">
            {viewer.pdf
              ? <iframe src={viewer.url} className="w-full max-w-3xl rounded" style={{ height: 'calc(100vh - 80px)' }} />
              : <img src={viewer.url} alt={viewer.name} className="max-w-3xl w-full rounded shadow-xl object-contain" />}
          </div>
        </div>
      )}

      {/* Edición manual */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Remedios de esta orden</h2>
              <button onClick={() => setEditing(null)} className="p-1 text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <p className="text-xs text-gray-500 truncate">{editing.original_name}</p>
            <textarea
              value={editMeds}
              onChange={(e) => setEditMeds(e.target.value)}
              rows={6}
              placeholder={'Uno por línea, por ejemplo:\nTopictal (topiramato)\nPlaniden (clotiazepam)'}
              className="w-full rounded-lg border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <div className="flex justify-between gap-2">
              <button onClick={() => view(editing)} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-1">
                <Eye size={14} /> Ver archivo
              </button>
              <button onClick={saveEdit} disabled={savingEdit} className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700 disabled:opacity-50 flex items-center gap-1">
                <Save size={14} /> {savingEdit ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
