import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Trash2, RotateCcw, AlertTriangle, FolderOpen, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { MedicalCase } from '@/lib/types'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export default function Papelera() {
  const [cases, setCases] = useState<MedicalCase[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)

  useEffect(() => { loadDeleted() }, [])

  async function loadDeleted() {
    setLoading(true)
    // Cargamos todos y filtramos en JS — evita problemas si 'ELIMINADO' no está en el enum del DB
    const { data } = await supabase
      .from('medical_cases')
      .select('*, patient:patients(full_name, alias)')
      .order('updated_at', { ascending: false })
    if (data) setCases(data.filter((c: any) => c.status === 'ELIMINADO') as MedicalCase[])
    setLoading(false)
  }

  async function restoreCase(id: string) {
    setActionId(id)
    await supabase
      .from('medical_cases')
      .update({ status: 'SUBIDO' })
      .eq('id', id)
    await loadDeleted()
    setActionId(null)
  }

  async function deletePermanently(id: string, title: string) {
    if (!window.confirm(`¿Eliminar "${title}" para siempre? Esta acción no se puede deshacer.`)) return
    setActionId(id)
    // Eliminar documentos vinculados al caso
    const { data: caseDocs } = await supabase
      .from('case_documents')
      .select('*, document:documents(storage_path)')
      .eq('case_id', id)

    if (caseDocs && caseDocs.length > 0) {
      // Eliminar archivos del storage
      const paths = caseDocs
        .map((cd: any) => cd.document?.storage_path)
        .filter(Boolean) as string[]
      if (paths.length > 0) {
        await supabase.storage.from('documents').remove(paths)
      }
      // Eliminar registros de documentos
      const docIds = caseDocs.map((cd: any) => cd.document_id).filter(Boolean)
      if (docIds.length > 0) {
        await supabase.from('documents').delete().in('id', docIds)
      }
      // Eliminar case_documents
      await supabase.from('case_documents').delete().eq('case_id', id)
    }

    // Eliminar el caso
    await supabase.from('medical_cases').delete().eq('id', id)
    await loadDeleted()
    setActionId(null)
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <Trash2 size={20} className="text-red-400" />
          <h1 className="text-2xl font-bold text-gray-900">Papelera</h1>
        </div>
        <p className="text-sm text-gray-500">
          Los casos eliminados se guardan aquí. Puedes restaurarlos o eliminarlos definitivamente.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : cases.length === 0 ? (
        <div className="text-center py-20">
          <FolderOpen size={40} className="mx-auto text-gray-200 mb-3" />
          <p className="text-sm text-gray-400">La papelera está vacía</p>
          <Link to="/cases" className="text-sm text-green-600 hover:text-green-700 mt-2 inline-block">
            Volver a casos →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Aviso */}
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>Al eliminar definitivamente se borrarán también todos los documentos adjuntos del caso.</span>
          </div>

          {cases.map((c) => {
            const patient = c.patient as any
            const patientName = patient?.alias || patient?.full_name || 'Sin paciente'
            const isActing = actionId === c.id
            return (
              <div
                key={c.id}
                className="card flex items-center justify-between gap-4 opacity-80 hover:opacity-100 transition-opacity"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">
                    {c.title || 'Sin título'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {patientName}
                    {c.correlativo && <span className="ml-2 font-mono text-green-700">{c.correlativo}</span>}
                    {c.event_date && (
                      <span className="ml-2">
                        · {format(new Date(c.event_date + 'T12:00:00'), 'd MMM yyyy', { locale: es })}
                      </span>
                    )}
                    {c.total_amount && (
                      <span className="ml-2">
                        · {new Intl.NumberFormat('es-CL', { style: 'currency', currency: c.currency, maximumFractionDigits: 0 }).format(c.total_amount)}
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => restoreCase(c.id)}
                    disabled={isActing}
                    className="btn-secondary text-green-700 hover:bg-green-50 hover:border-green-200 text-xs py-1.5 px-3 flex items-center gap-1.5"
                    title="Restaurar caso"
                  >
                    {isActing ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    Restaurar
                  </button>
                  <button
                    onClick={() => deletePermanently(c.id, c.title || 'este caso')}
                    disabled={isActing}
                    className="btn-secondary text-red-600 hover:bg-red-50 hover:border-red-200 text-xs py-1.5 px-3 flex items-center gap-1.5"
                    title="Eliminar para siempre"
                  >
                    {isActing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    Eliminar siempre
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
