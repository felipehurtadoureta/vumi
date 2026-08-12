import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { HistorialInforme, HistorialValor } from '../lib/types'
import ChatInforme from '../components/ChatInforme'
import { ArrowLeft, Loader2, AlertTriangle, Trash2, ExternalLink, RefreshCw } from 'lucide-react'

export default function DetalleInforme() {
  const { patientId, id } = useParams<{ patientId: string; id: string }>()
  const navigate = useNavigate()
  const [informe, setInforme] = useState<HistorialInforme | null>(null)
  const [valores, setValores] = useState<HistorialValor[]>([])
  const [fileUrl, setFileUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!id) return
    async function load() {
      const [{ data }, { data: vals }] = await Promise.all([
        supabase
          .from('historial_informes')
          .select('*, tipo_examen:historial_tipos_examen(*)')
          .eq('id', id).single(),
        supabase
          .from('historial_valores')
          .select('*')
          .eq('informe_id', id)
          .order('nombre_valor'),
      ])
      if (data) {
        setInforme(data as HistorialInforme)
        const { data: signed } = await supabase.storage
          .from(data.storage_bucket)
          .createSignedUrl(data.storage_path, 3600)
        if (signed) setFileUrl(signed.signedUrl)
      }
      setValores((vals ?? []) as HistorialValor[])
      setLoading(false)
    }
    load()
  }, [id])

  async function handleDelete() {
    if (!informe || !confirm('¿Eliminar este informe del historial? Esta acción no se puede deshacer.')) return
    setDeleting(true)
    await supabase.storage.from(informe.storage_bucket).remove([informe.storage_path])
    await supabase.from('historial_informes').delete().eq('id', informe.id)
    navigate(`/hoja-de-vida/${patientId}`)
  }

  if (loading) return (
    <div className="p-8 flex items-center gap-2 text-gray-400">
      <Loader2 size={18} className="animate-spin" /> Cargando...
    </div>
  )

  if (!informe) return (
    <div className="p-8 text-sm text-gray-500">Informe no encontrado.</div>
  )

  if (informe.tipo_examen_id == null) return (
    <div className="p-8 max-w-md text-center mx-auto">
      <p className="text-sm text-gray-600 mb-4">Este informe todavía no se ha procesado con IA.</p>
      <Link to={`/hoja-de-vida/${patientId}/informes/${informe.id}/procesar`} className="btn-primary inline-flex">
        Procesar ahora
      </Link>
    </div>
  )

  const isPdf = informe.mime_type === 'application/pdf'

  return (
    <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
      <div className="w-[45%] overflow-y-auto bg-gray-100 border-r border-gray-200 p-4">
        {fileUrl && (isPdf
          ? <iframe src={fileUrl} className="w-full rounded-lg shadow" style={{ height: 'calc(100vh - 100px)' }} />
          : <img src={fileUrl} alt="Informe" className="w-full rounded-lg shadow-md" />
        )}
      </div>

      <div className="w-[55%] overflow-y-auto p-6 space-y-5">
        <Link to={`/hoja-de-vida/${patientId}`} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600">
          <ArrowLeft size={14} /> Volver al historial
        </Link>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{informe.tipo_examen?.nombre ?? 'Examen'}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {informe.fecha_examen
                ? new Date(informe.fecha_examen + 'T00:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })
                : 'Sin fecha registrada'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link to={`/hoja-de-vida/${patientId}/informes/${informe.id}/procesar`} className="btn-secondary text-xs py-1.5 px-3">
              <RefreshCw size={13} /> Reprocesar con IA
            </Link>
            {fileUrl && (
              <a href={fileUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs py-1.5 px-3">
                <ExternalLink size={13} /> Abrir archivo
              </a>
            )}
          </div>
        </div>

        {informe.needs_review && (
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <AlertTriangle size={14} className="shrink-0" />
            <span className="flex-1">Este informe puede necesitar revisión manual de sus datos.</span>
            <Link to={`/hoja-de-vida/${patientId}/informes/${informe.id}/procesar`} className="text-xs font-medium underline underline-offset-2 shrink-0">
              Reprocesar
            </Link>
          </div>
        )}

        <div className="card space-y-3">
          <Row label="Institución" value={informe.institucion} />
          <Row label="Médico" value={informe.medico_nombre} />
          <Row label="Interpretación" value={informe.interpretacion} multiline />
          <Row label="Notas" value={informe.notas} multiline />
        </div>

        {valores.length > 0 && (
          <div className="card">
            <p className="text-xs font-medium text-gray-500 mb-2">Valores del examen</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left font-medium py-1.5">Valor</th>
                  <th className="text-left font-medium py-1.5">Resultado</th>
                  <th className="text-left font-medium py-1.5">Rango</th>
                </tr>
              </thead>
              <tbody>
                {valores.map((v) => (
                  <tr key={v.id} className={`border-b border-gray-50 last:border-0 ${v.fuera_de_rango ? 'bg-red-50' : ''}`}>
                    <td className="py-1.5 text-gray-700">{v.nombre_valor}</td>
                    <td className={`py-1.5 font-medium ${v.fuera_de_rango ? 'text-red-600' : 'text-gray-900'}`}>
                      {v.valor ?? '—'}{v.unidad ? ` ${v.unidad}` : ''}
                      {v.fuera_de_rango && <AlertTriangle size={11} className="inline ml-1 -mt-0.5" />}
                    </td>
                    <td className="py-1.5 text-gray-400 text-xs">
                      {v.rango_min != null && v.rango_max != null ? `${v.rango_min} - ${v.rango_max}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ChatInforme informe={informe} valores={valores} patientId={patientId!} />

        <div className="text-xs text-gray-400">
          Subido el {new Date(informe.created_at).toLocaleDateString('es-CL')}
          {informe.ai_extracted && <span> · leído por IA{informe.ai_confidence != null ? ` (${Math.round(informe.ai_confidence * 100)}% confianza)` : ''}</span>}
        </div>

        <button onClick={handleDelete} disabled={deleting} className="text-sm text-red-500 hover:text-red-700 inline-flex items-center gap-1.5 disabled:opacity-50">
          {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          Eliminar informe
        </button>
      </div>
    </div>
  )
}

function Row({ label, value, multiline }: { label: string; value: string | null; multiline?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 mb-0.5">{label}</p>
      <p className={`text-sm text-gray-800 ${multiline ? 'whitespace-pre-wrap' : ''}`}>
        {value || <span className="text-gray-300">—</span>}
      </p>
    </div>
  )
}
