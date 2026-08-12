import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import type { Patient } from '@/lib/types'
import type { HistorialInforme, TipoExamen } from '../lib/types'
import { ArrowLeft, Plus, Loader2, FileText, AlertTriangle, UploadCloud, Trash2, Clock, Sparkles, TrendingUp, ListChecks } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import PerfilPaciente from '../components/PerfilPaciente'

export default function Historial() {
  const { patientId } = useParams<{ patientId: string }>()
  const navigate = useNavigate()
  const { userId, setPendingHistorialFiles } = useStore()
  const [patient, setPatient] = useState<Patient | null>(null)
  const [informes, setInformes] = useState<HistorialInforme[]>([])
  const [tipos, setTipos] = useState<TipoExamen[]>([])
  const [filtroTipo, setFiltroTipo] = useState<number | ''>('')
  const [loading, setLoading] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!userId || !patientId) return
    async function load() {
      const [{ data: p }, { data: inf }, { data: t }] = await Promise.all([
        supabase.from('patients').select('*').eq('id', patientId).single(),
        supabase.from('historial_informes')
          .select('*, tipo_examen:historial_tipos_examen(*)')
          .eq('user_id', userId).eq('patient_id', patientId)
          .order('fecha_examen', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false }),
        supabase.from('historial_tipos_examen').select('*').order('nombre'),
      ])
      setPatient(p ?? null)
      setInformes((inf ?? []) as HistorialInforme[])
      setTipos(t ?? [])
      setLoading(false)
    }
    load()
  }, [userId, patientId])

  const pendientes = informes.filter((i) => i.tipo_examen_id == null)
  const filtered = filtroTipo === '' ? informes : informes.filter((i) => i.tipo_examen_id === filtroTipo)

  async function handleDelete(e: React.MouseEvent, inf: HistorialInforme) {
    e.preventDefault() // no navegar al detalle
    e.stopPropagation()
    if (!confirm('¿Eliminar este informe del historial? Esta acción no se puede deshacer.')) return
    setDeletingId(inf.id)
    await supabase.storage.from(inf.storage_bucket).remove([inf.storage_path])
    await supabase.from('historial_informes').delete().eq('id', inf.id)
    setInformes((prev) => prev.filter((i) => i.id !== inf.id))
    setDeletingId(null)
  }

  // Arrastrar uno o varios archivos directo sobre el historial → salta a
  // "Subir informe" con los archivos ya cargados, evitando el paso extra de
  // seleccionarlos ahí. Se procesan de a uno, en cola.
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    setPendingHistorialFiles(files)
    navigate(`/hoja-de-vida/${patientId}/subir`)
  }, [patientId, navigate, setPendingHistorialFiles])

  if (loading) return (
    <div className="p-8 flex items-center gap-2 text-gray-400">
      <Loader2 size={18} className="animate-spin" /> Cargando...
    </div>
  )

  return (
    <div
      className="p-6 max-w-3xl relative min-h-[calc(100vh-64px)]"
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
    >
      {dragOver && (
        <div className="fixed inset-0 z-50 bg-emerald-50/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3 pointer-events-none">
          <UploadCloud size={48} className="text-emerald-500" />
          <p className="text-lg font-semibold text-emerald-700">Suelta el informe aquí</p>
        </div>
      )}

      <Link to="/hoja-de-vida" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-4">
        <ArrowLeft size={14} /> Todos los pacientes
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{patient?.full_name ?? 'Paciente'}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Historial médico</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/hoja-de-vida/resumen/${patientId}`} className="btn-secondary">
            <ListChecks size={16} /> Ficha resumen
          </Link>
          <Link to={`/hoja-de-vida/tendencias/${patientId}`} className="btn-secondary">
            <TrendingUp size={16} /> Tendencias
          </Link>
          <Link to={`/hoja-de-vida/${patientId}/subir`} className="btn-primary">
            <Plus size={16} /> Subir informe
          </Link>
        </div>
      </div>

      {patientId && <PerfilPaciente patientId={patientId} />}

      {pendientes.length > 0 && (
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
          <Clock size={14} className="shrink-0 text-gray-400" />
          <span className="flex-1">
            {pendientes.length === 1 ? '1 informe pendiente de procesar' : `${pendientes.length} informes pendientes de procesar`}
          </span>
          <Link to={`/hoja-de-vida/${patientId}/informes/${pendientes[0].id}/procesar`} className="text-xs font-medium text-green-700 hover:text-green-800 underline underline-offset-2 shrink-0">
            Procesar ahora
          </Link>
        </div>
      )}

      {informes.length > 0 && (
        <div className="mb-4">
          <select
            className="select text-sm w-56"
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Todos los tipos</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>
      )}

      {informes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Sin informes registrados"
          description="Sube el primer informe médico de este paciente."
          action={
            <Link to={`/hoja-de-vida/${patientId}/subir`} className="btn-primary">
              <Plus size={16} /> Subir informe
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No hay informes de este tipo.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((inf) => {
            const pendiente = inf.tipo_examen_id == null
            return (
              <Link
                key={inf.id}
                to={pendiente ? `/hoja-de-vida/${patientId}/informes/${inf.id}/procesar` : `/hoja-de-vida/${patientId}/informes/${inf.id}`}
                className={`card flex items-start gap-4 hover:shadow-sm transition-all block ${pendiente ? 'hover:border-gray-300 border-dashed' : 'hover:border-green-300'}`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${pendiente ? 'bg-gray-100' : 'bg-green-50'}`}>
                  {pendiente ? <Clock size={18} className="text-gray-400" /> : <FileText size={18} className="text-green-600" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900 text-sm">
                      {inf.tipo_examen?.nombre ?? (pendiente ? 'Sin procesar' : 'Examen')}
                    </p>
                    {pendiente ? (
                      <span className="flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 border border-gray-200 rounded-full px-2 py-0.5">
                        <Clock size={9} /> Pendiente de procesar
                      </span>
                    ) : inf.needs_review && (
                      <span className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                        <AlertTriangle size={9} /> Revisar
                      </span>
                    )}
                  </div>
                  {pendiente ? (
                    <p className="text-xs text-green-700 mt-0.5 inline-flex items-center gap-1">
                      <Sparkles size={11} /> Haz clic para procesar con IA
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {inf.fecha_examen
                          ? new Date(inf.fecha_examen + 'T00:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })
                          : 'Sin fecha'}
                        {inf.institucion && <span> · {inf.institucion}</span>}
                      </p>
                      {inf.interpretacion && (
                        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{inf.interpretacion}</p>
                      )}
                    </>
                  )}
                </div>
                <button
                  onClick={(e) => handleDelete(e, inf)}
                  disabled={deletingId === inf.id}
                  className="shrink-0 text-gray-300 hover:text-red-500 p-1.5 disabled:opacity-50"
                  title="Eliminar informe"
                >
                  {deletingId === inf.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                </button>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
