import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, Send, Clock, FileWarning, CheckCircle2, ChevronRight,
  TrendingUp, AlertCircle, FolderOpen,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { MedicalCase } from '@/lib/types'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

// ── Helpers ───────────────────────────────────────────────────────────────
function fmtCLP(n: number) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
  }).format(n)
}

function isCompleto(c: MedicalCase): boolean {
  const metlifeDone = c.needs_metlife === false || !!c.metlife_sent_at
  const vumiDone    = c.needs_vumi    === false || !!c.vumi_sent_at
  return metlifeDone && vumiDone
}

// ── Subcomponente: tarjeta de acción ──────────────────────────────────────
function ActionCard({
  cases, label, sublabel, icon: Icon, iconColor, linkColor, emptyMsg, renderRow,
}: {
  cases: MedicalCase[]
  label: string
  sublabel?: string
  icon: React.ElementType
  iconColor: string
  linkColor: string
  emptyMsg: string
  renderRow: (c: MedicalCase) => React.ReactNode
}) {
  if (cases.length === 0) return null
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconColor}`}>
          <Icon size={14} />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900 text-sm">{label}</h2>
          {sublabel && <p className="text-xs text-gray-400">{sublabel}</p>}
        </div>
        <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${iconColor}`}>
          {cases.length}
        </span>
      </div>
      <div className="space-y-2">
        {cases.slice(0, 5).map(renderRow)}
        {cases.length > 5 && (
          <Link to="/cases" className={`text-xs ${linkColor} flex items-center gap-1`}>
            Ver {cases.length - 5} más <ChevronRight size={12} />
          </Link>
        )}
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────
export default function Dashboard() {
  const [cases, setCases] = useState<MedicalCase[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const { data } = await supabase
      .from('medical_cases')
      .select('*, patient:patients(full_name, alias)')
      .order('created_at', { ascending: false })
    if (data) setCases(data.filter((c: any) => c.status !== 'ELIMINADO') as MedicalCase[])
    setLoading(false)
  }

  // ── Segmentar casos por prioridad ────────────────────────────────────
  const active = cases.filter(c => c.status !== 'ARCHIVADO' && !isCompleto(c))

  // 1. Listos para enviar VUMI: tiene todos los docs y aún no fue enviado
  const listos = active.filter(c => {
    const isMedicamento = c.case_type === 'medicamento'
    const hasAllDocs = c.has_boleta && c.has_orden_medica &&
      (isMedicamento || c.has_liquidacion_banmedica)
    return hasAllDocs && !c.vumi_sent_at && c.needs_vumi !== false
  })

  // 2. Esperando liquidación Banmédica (enviado a BM, aún no tiene liq.)
  const esperandoLiq = active.filter(c =>
    !!c.banmedica_sent_at && !c.has_liquidacion_banmedica && c.case_type !== 'medicamento'
  )

  // 3. Sin documentos (falta boleta o falta orden)
  const sinDocs = active.filter(c => !c.has_boleta || !c.has_orden_medica)

  // 4. Casos completados (estadística)
  const completados = cases.filter(c => isCompleto(c))

  // ── Montos ───────────────────────────────────────────────────────────
  const montoActivo = active
    .filter(c => c.total_amount)
    .reduce((sum, c) => sum + (c.total_amount ?? 0), 0)

  const montoEnviado = completados
    .filter(c => c.total_amount)
    .reduce((sum, c) => sum + (c.total_amount ?? 0), 0)

  // ── Render ────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="p-8 space-y-4">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
      ))}
    </div>
  )

  const today = format(new Date(), "EEEE d 'de' MMMM", { locale: es })

  return (
    <div className="p-8 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 capitalize">{today}</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {active.length > 0
              ? `${active.length} caso${active.length > 1 ? 's' : ''} activo${active.length > 1 ? 's' : ''}`
              : 'Sin casos pendientes'}
            {listos.length > 0 && (
              <span className="ml-2 text-green-600 font-medium">
                · {listos.length} listo{listos.length > 1 ? 's' : ''} para enviar
              </span>
            )}
          </p>
        </div>
        <Link to="/cases/new" className="btn-primary">
          <Plus size={16} /> Nuevo caso
        </Link>
      </div>

      {/* Stats compactos */}
      {(montoActivo > 0 || montoEnviado > 0 || cases.length > 0) && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card py-3 px-4">
            <p className="text-xs text-gray-400 mb-1">En proceso</p>
            <p className="text-xl font-bold text-gray-900">
              {montoActivo > 0 ? fmtCLP(montoActivo) : `${active.length} casos`}
            </p>
          </div>
          <div className="card py-3 px-4">
            <p className="text-xs text-gray-400 mb-1">Gestionados</p>
            <p className="text-xl font-bold text-green-700">
              {montoEnviado > 0 ? fmtCLP(montoEnviado) : `${completados.length} casos`}
            </p>
          </div>
          <div className="card py-3 px-4">
            <p className="text-xs text-gray-400 mb-1">Total histórico</p>
            <p className="text-xl font-bold text-gray-700">
              {cases.length} casos
            </p>
          </div>
        </div>
      )}

      {/* Estado vacío */}
      {cases.length === 0 && (
        <div className="card text-center py-16">
          <FolderOpen size={36} className="mx-auto text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium mb-1">No hay casos todavía</p>
          <p className="text-sm text-gray-400 mb-4">Crea tu primer caso para empezar a gestionar reembolsos.</p>
          <Link to="/cases/new" className="btn-primary inline-flex">
            <Plus size={15} /> Nuevo caso
          </Link>
        </div>
      )}

      {/* 1. Listos para enviar VUMI */}
      <ActionCard
        cases={listos}
        label="Listos para enviar a VUMI"
        sublabel="Tienen todos los documentos"
        icon={Send}
        iconColor="bg-green-100 text-green-700"
        linkColor="text-green-600 hover:text-green-700"
        emptyMsg=""
        renderRow={(c) => {
          const patient = c.patient as any
          return (
            <Link
              key={c.id}
              to={`/cases/${c.id}`}
              className="flex items-center justify-between p-3 rounded-xl border border-green-100 bg-green-50/40 hover:bg-green-50 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {patient?.alias || patient?.full_name || 'Sin paciente'}
                </p>
                <p className="text-xs text-gray-500 truncate">{c.title || '—'}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                {c.total_amount && (
                  <span className="text-sm font-semibold text-green-700">{fmtCLP(c.total_amount)}</span>
                )}
                <ChevronRight size={14} className="text-gray-300" />
              </div>
            </Link>
          )
        }}
      />

      {/* 2. Esperando liquidación Banmédica */}
      <ActionCard
        cases={esperandoLiq}
        label="Esperando liquidación Banmédica"
        sublabel="Enviados a Banmédica, pendiente subir liquidación"
        icon={Clock}
        iconColor="bg-amber-100 text-amber-700"
        linkColor="text-amber-600 hover:text-amber-700"
        emptyMsg=""
        renderRow={(c) => {
          const patient = c.patient as any
          const daysSinceSent = c.banmedica_sent_at
            ? Math.floor((Date.now() - new Date(c.banmedica_sent_at).getTime()) / 86400000)
            : null
          return (
            <Link
              key={c.id}
              to={`/cases/${c.id}`}
              className="flex items-center justify-between p-3 rounded-xl border border-amber-100 bg-amber-50/30 hover:bg-amber-50 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {patient?.alias || patient?.full_name || 'Sin paciente'}
                </p>
                <p className="text-xs text-gray-500 truncate">{c.title || '—'}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                {daysSinceSent !== null && (
                  <span className="text-xs text-amber-600">
                    {daysSinceSent === 0 ? 'Hoy' : `${daysSinceSent}d`}
                  </span>
                )}
                <ChevronRight size={14} className="text-gray-300" />
              </div>
            </Link>
          )
        }}
      />

      {/* 3. Sin documentos */}
      <ActionCard
        cases={sinDocs}
        label="Faltan documentos"
        sublabel="Necesitan boleta u orden médica"
        icon={FileWarning}
        iconColor="bg-red-100 text-red-600"
        linkColor="text-red-500 hover:text-red-600"
        emptyMsg=""
        renderRow={(c) => {
          const patient = c.patient as any
          const falta = [
            !c.has_boleta && 'boleta',
            !c.has_orden_medica && 'orden médica',
          ].filter(Boolean).join(' · ')
          return (
            <Link
              key={c.id}
              to={`/cases/${c.id}`}
              className="flex items-center justify-between p-3 rounded-xl border border-red-100 bg-red-50/30 hover:bg-red-50 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {patient?.alias || patient?.full_name || 'Sin paciente'}
                </p>
                <p className="text-xs text-red-400 truncate">Falta: {falta}</p>
              </div>
              <ChevronRight size={14} className="text-gray-300 shrink-0 ml-3" />
            </Link>
          )
        }}
      />

      {/* Todo ok */}
      {cases.length > 0 && listos.length === 0 && esperandoLiq.length === 0 && sinDocs.length === 0 && (
        <div className="card text-center py-10">
          <CheckCircle2 size={32} className="mx-auto text-green-500 mb-2" />
          <p className="font-medium text-gray-900">Sin pendientes</p>
          <p className="text-sm text-gray-400 mt-1">Todos los casos activos están al día.</p>
          <Link to="/cases" className="text-sm text-green-600 hover:text-green-700 mt-3 inline-flex items-center gap-1">
            Ver todos los casos <ChevronRight size={13} />
          </Link>
        </div>
      )}

      {/* Resumen si hay activos sin categoría */}
      {active.length > 0 && listos.length === 0 && esperandoLiq.length === 0 && sinDocs.length === 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={15} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900">Casos activos</h2>
          </div>
          <div className="space-y-2">
            {active.slice(0, 6).map(c => {
              const patient = c.patient as any
              return (
                <Link key={c.id} to={`/cases/${c.id}`}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {patient?.alias || patient?.full_name || 'Sin paciente'}
                    </p>
                    <p className="text-xs text-gray-400">{c.title || '—'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.total_amount && (
                      <span className="text-xs text-gray-500">{fmtCLP(c.total_amount)}</span>
                    )}
                    <ChevronRight size={13} className="text-gray-300" />
                  </div>
                </Link>
              )
            })}
          </div>
          {active.length > 6 && (
            <Link to="/cases" className="text-xs text-green-600 hover:text-green-700 flex items-center gap-1 mt-2">
              Ver {active.length - 6} más <ChevronRight size={12} />
            </Link>
          )}
        </div>
      )}

      {/* Link a resumen si hay casos completados */}
      {completados.length > 0 && (
        <div className="flex justify-end">
          <Link to="/resumen" className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
            <TrendingUp size={12} /> Ver resumen financiero
          </Link>
        </div>
      )}

    </div>
  )
}
