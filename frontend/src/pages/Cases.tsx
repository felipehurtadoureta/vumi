import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderOpen, Search, Filter, Check, X, Clock, AlertCircle } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import EmptyState from '@/components/ui/EmptyState'
import type { MedicalCase } from '@/lib/types'
import { format } from 'date-fns'

// ── Estado pendiente computado ─────────────────────────────────────────
type PendingKey = 'sin_documentos' | 'falta_liq' | 'falta_compl' | 'falta_vumi' | 'enviado' | 'nueva_info'

interface PendingInfo { label: string; key: PendingKey; color: string }

function isCompleto(c: MedicalCase): boolean {
  // needs_* !== false → requerido (null o true). === false → no requerido.
  const needsMetlife = c.needs_metlife !== false
  const needsVumi    = c.needs_vumi    !== false
  return (!needsMetlife || !!c.metlife_sent_at) && (!needsVumi || !!c.vumi_sent_at)
}

function isHistorico(c: MedicalCase): boolean {
  return isCompleto(c) || c.status === 'CERRADO' || c.status === 'ARCHIVADO'
}

function getPendingInfo(c: MedicalCase): PendingInfo {
  if (c.status === 'ARCHIVADO')
    return { label: 'Archivado', key: 'enviado', color: 'bg-gray-100 text-gray-500' }
  if (c.status === 'CERRADO' || isCompleto(c))
    return { label: 'Completado', key: 'enviado', color: 'bg-green-100 text-green-700' }
  if (c.status === 'NUEVA_INFO')
    return { label: 'Agregar Nueva Info', key: 'nueva_info', color: 'bg-orange-100 text-orange-700' }

  if (!c.has_boleta || !c.has_orden_medica)
    return { label: 'Sin documentos', key: 'sin_documentos', color: 'bg-red-100 text-red-700' }

  const liqOk  = c.has_liquidacion_banmedica || !!c.banmedica_sent_at
  const complOk = !!c.metlife_sent_at

  if (!liqOk)
    return { label: 'Incompleta: Liquidación · Complementario · Vumi', key: 'falta_liq', color: 'bg-amber-100 text-amber-700' }

  if (!complOk)
    return { label: 'Complementario · Vumi', key: 'falta_compl', color: 'bg-blue-100 text-blue-700' }

  return { label: 'Falta Vumi', key: 'falta_vumi', color: 'bg-purple-100 text-purple-700' }
}

// ── Opciones de filtro ─────────────────────────────────────────────────
const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '',               label: 'Todos'                      },
  { value: 'sin_documentos', label: 'Sin documentos'             },
  { value: 'falta_liq',      label: 'Incompleta (falta liq.)'    },
  { value: 'falta_compl',    label: 'Falta complementario'       },
  { value: 'falta_vumi',     label: 'Pendiente Vumi'             },
  { value: 'nueva_info',     label: 'Agregar nueva info'         },
]

// ── Componente principal ───────────────────────────────────────────────
function StatusIcon({ label, ok, pending, na }: { label: string; ok: boolean; pending?: boolean; na?: boolean }) {
  if (na) return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-300">
      <span className="shrink-0 w-3 text-center">—</span>
      <span>{label}</span>
    </span>
  )
  const colorClass = ok ? 'text-green-600' : pending ? 'text-amber-500' : 'text-red-500'
  const Icon = ok ? Check : pending ? Clock : X
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs font-medium', colorClass)}>
      <Icon size={12} strokeWidth={2.5} className="shrink-0" />
      <span>{label}</span>
    </span>
  )
}

function ReimbolsoIcon({ ok, pending, na }: { ok: boolean; pending?: boolean; na?: boolean }) {
  if (na)      return <span className="text-gray-300 text-sm leading-none">—</span>
  if (ok)      return <Check size={14} strokeWidth={2.5} className="text-green-600" />
  if (pending) return <Clock size={14} strokeWidth={2.5} className="text-amber-500" />
  return <X size={14} strokeWidth={2.5} className="text-red-400" />
}

function CaseTable({ rows }: { rows: MedicalCase[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
        <tr className="text-xs text-gray-400">
          <th className="text-left px-4 py-3 font-medium w-16">N°</th>
          <th className="text-left px-4 py-3 font-medium">Paciente / Caso</th>
          <th className="text-left px-4 py-3 font-medium w-28">Fecha</th>
          <th className="text-left px-4 py-3 font-medium w-28">Monto</th>
          <th className="text-center px-3 py-3 font-medium w-16">Isapre</th>
          <th className="text-center px-3 py-3 font-medium w-16">Compl.</th>
          <th className="text-center px-3 py-3 font-medium w-16">Vumi</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {rows.map((c) => {
          const patient     = c.patient as any
          const patientName = patient?.alias || patient?.full_name || '—'
          const isapreNa    = c.case_type === 'medicamento'
          const isapre      = !isapreNa && c.has_liquidacion_banmedica
          const isaprePend  = !isapreNa && !!c.banmedica_sent_at && !c.has_liquidacion_banmedica
          return (
            <tr key={c.id} className={clsx(
              'hover:bg-gray-50 transition-colors',
              c.status === 'NUEVA_INFO' && !isCompleto(c) && 'bg-orange-50/60 hover:bg-orange-50'
            )}>
              <td className="px-4 py-3">
                <Link to={`/cases/${c.id}`}
                  className="font-mono text-xs font-semibold text-green-700 hover:text-green-800">
                  {c.correlativo || <span className="text-gray-300">—</span>}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Link to={`/cases/${c.id}`} className="hover:text-green-700 block">
                  <div className="flex items-center gap-1.5">
                    {c.status === 'NUEVA_INFO' && !isCompleto(c) && (
                      <span title="En espera de información adicional">
                        <AlertCircle size={13} className="text-orange-500 shrink-0" />
                      </span>
                    )}
                    <p className="font-medium text-gray-900 text-sm leading-snug">{patientName}</p>
                  </div>
                  <p className="text-xs text-gray-400 leading-snug truncate max-w-xs">{c.title || '—'}</p>
                </Link>
              </td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {c.event_date ? format((() => { const [y,m,d] = c.event_date!.split('-').map(Number); return new Date(y,m-1,d) })(), 'dd/MM/yyyy') : '—'}
                {c.boleta_number && <p className="text-gray-400">N° {c.boleta_number}</p>}
              </td>
              <td className="px-4 py-3 text-xs font-medium text-gray-700">
                {c.total_amount
                  ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: c.currency, maximumFractionDigits: 0 }).format(c.total_amount)
                  : '—'}
              </td>
              <td className="px-3 py-3 text-center">
                <ReimbolsoIcon ok={isapre} pending={isaprePend} na={isapreNa} />
              </td>
              <td className="px-3 py-3 text-center">
                <ReimbolsoIcon ok={!!c.metlife_sent_at} na={c.needs_metlife === false} />
              </td>
              <td className="px-3 py-3 text-center">
                <ReimbolsoIcon ok={!!c.vumi_sent_at} na={c.needs_vumi === false} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function Cases() {
  const { cases, setCases } = useStore()
  const [loading,       setLoading]       = useState(true)
  const [search,        setSearch]        = useState('')
  const [pendingFilter, setPendingFilter] = useState('')
  const [showHistoric,  setShowHistoric]  = useState(false)

  useEffect(() => { loadCases() }, [])

  async function loadCases() {
    setLoading(true)
    const { data } = await supabase
      .from('medical_cases')
      .select('*, patient:patients(full_name, alias)')
      .order('created_at', { ascending: false })
    if (data) setCases(data.filter((c: any) => c.status !== 'ELIMINADO') as MedicalCase[])
    setLoading(false)
  }

  function matchSearch(c: MedicalCase): boolean {
    const q = search.toLowerCase().trim()
    if (!q) return true
    const patient     = c.patient as any
    const patientName = (patient?.alias || patient?.full_name || '').toLowerCase()
    return (
      patientName.includes(q)                                         ||
      (c.title          || '').toLowerCase().includes(q)              ||
      (c.boleta_number  || '').toLowerCase().includes(q)              ||
      (c.correlativo    || '').toLowerCase().includes(q)              ||
      (c.provider       || '').toLowerCase().includes(q)              ||
      (c.rut_centro_medico || '').toLowerCase().includes(q)           ||
      (c.rut_medico     || '').toLowerCase().includes(q)              ||
      (c.nombre_medico  || '').toLowerCase().includes(q)              ||
      (c.total_amount != null && String(c.total_amount).includes(q))
    )
  }

  const activeCases   = cases.filter(c => !isHistorico(c) && matchSearch(c) && (!pendingFilter || getPendingInfo(c).key === pendingFilter))
  const historicCases = cases.filter(c => isHistorico(c)  && matchSearch(c))

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Casos médicos</h1>
          <p className="text-sm text-gray-500 mt-1">{cases.length} casos en total</p>
        </div>
        <Link to="/cases/new" className="btn-primary">
          <FolderOpen size={16} /> Nuevo caso
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Paciente, boleta, título, monto, RUT, proveedor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9"
          />
        </div>
        <div className="relative">
          <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <select
            value={pendingFilter}
            onChange={(e) => setPendingFilter(e.target.value)}
            className="select pl-9 pr-8"
          >
            {FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : activeCases.length === 0 && historicCases.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No hay casos"
          description="Sube documentos médicos para crear tu primer caso."
          action={<Link to="/upload" className="btn-primary">Subir documentos</Link>}
        />
      ) : (
        <div className="space-y-6">
          {/* Casos activos */}
          {activeCases.length > 0 && (
            <div className="card p-0 overflow-hidden">
              <CaseTable rows={activeCases} />
            </div>
          )}
          {activeCases.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No hay casos activos con ese filtro.</p>
          )}

          {/* Historial */}
          {historicCases.length > 0 && (
            <div>
              <button
                onClick={() => setShowHistoric(v => !v)}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-3"
              >
                <span className={`transition-transform ${showHistoric ? 'rotate-90' : ''}`}>▶</span>
                Historial ({historicCases.length} casos)
              </button>
              {showHistoric && (
                <div className="card p-0 overflow-hidden opacity-80">
                  <CaseTable rows={historicCases} />
                </div>
              )}
            
            </div>
          )}
        </div>
      )}
    </div>
  )
}
