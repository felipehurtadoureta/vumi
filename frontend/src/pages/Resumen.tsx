import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { MedicalCase } from '@/lib/types'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

function fmtCLP(n: number) {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
  }).format(n)
}

interface PatientSummary {
  name: string
  total: number
  sent: number     // enviado a VUMI
  count: number
}

interface MonthSummary {
  key: string
  label: string
  count: number
  total: number
}

export default function Resumen() {
  const [cases, setCases] = useState<MedicalCase[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('medical_cases')
      .select('*, patient:patients(full_name, alias)')
      .order('event_date', { ascending: false })
    if (data) setCases(data.filter((c: any) => c.status !== 'ELIMINADO') as MedicalCase[])
    setLoading(false)
  }

  // ── Agregaciones ──────────────────────────────────────────────────────
  const withAmount = cases.filter(c => c.total_amount)

  const totalGlobal = withAmount.reduce((s, c) => s + (c.total_amount ?? 0), 0)
  const totalVumi   = cases.filter(c => c.vumi_sent_at && c.total_amount)
                           .reduce((s, c) => s + (c.total_amount ?? 0), 0)
  const totalMetlife = cases.filter(c => c.metlife_sent_at && c.total_amount)
                            .reduce((s, c) => s + (c.total_amount ?? 0), 0)

  // Por paciente
  const byPatient: Record<string, PatientSummary> = {}
  for (const c of cases) {
    const patient = c.patient as any
    const name = patient?.alias || patient?.full_name || 'Sin paciente'
    if (!byPatient[name]) byPatient[name] = { name, total: 0, sent: 0, count: 0 }
    byPatient[name].count++
    byPatient[name].total += c.total_amount ?? 0
    if (c.vumi_sent_at) byPatient[name].sent += c.total_amount ?? 0
  }
  const patientRows = Object.values(byPatient).sort((a, b) => b.total - a.total)

  // Por mes (últimos 12 meses con casos)
  const byMonth: Record<string, MonthSummary> = {}
  for (const c of cases) {
    const dateStr = c.event_date ?? c.created_at
    const key = dateStr.slice(0, 7) // YYYY-MM
    if (!byMonth[key]) {
      byMonth[key] = {
        key,
        label: format(new Date(key + '-01'), 'MMM yyyy', { locale: es }),
        count: 0,
        total: 0,
      }
    }
    byMonth[key].count++
    byMonth[key].total += c.total_amount ?? 0
  }
  const monthRows = Object.values(byMonth).sort((a, b) => b.key.localeCompare(a.key)).slice(0, 12)

  // Max para barra
  const maxMonthTotal = Math.max(...monthRows.map(m => m.total), 1)

  if (loading) return (
    <div className="p-8 space-y-4">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
      ))}
    </div>
  )

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Resumen</h1>
        <p className="text-sm text-gray-400 mt-0.5">{cases.length} casos en total</p>
      </div>

      {cases.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-16">No hay casos todavía.</p>
      ) : (
        <>
          {/* Totales por aseguradora */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 text-sm mb-4">Por aseguradora</h2>
            <div className="space-y-3">
              {/* Banmédica */}
              <AsegRow
                label="Banmédica (Isapre)"
                sentCount={cases.filter(c => c.banmedica_sent_at).length}
                doneCount={cases.filter(c => c.has_liquidacion_banmedica).length}
                totalCases={cases.filter(c => c.case_type !== 'medicamento').length}
                color="bg-indigo-500"
              />
              {/* MetLife */}
              <AsegRow
                label="MetLife (Complementario)"
                sentCount={cases.filter(c => c.metlife_sent_at).length}
                doneCount={cases.filter(c => c.metlife_sent_at).length}
                totalCases={cases.filter(c => c.needs_metlife !== false).length}
                amount={totalMetlife}
                color="bg-purple-500"
              />
              {/* VUMI */}
              <AsegRow
                label="VUMI"
                sentCount={cases.filter(c => c.vumi_sent_at).length}
                doneCount={cases.filter(c => c.vumi_sent_at).length}
                totalCases={cases.filter(c => c.needs_vumi !== false).length}
                amount={totalVumi}
                color="bg-green-500"
              />
            </div>

            {totalGlobal > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
                <span className="text-xs text-gray-400">Total gestionado</span>
                <span className="text-base font-bold text-gray-900">{fmtCLP(totalGlobal)}</span>
              </div>
            )}
          </div>

          {/* Por paciente */}
          {patientRows.length > 0 && (
            <div className="card">
              <h2 className="font-semibold text-gray-900 text-sm mb-4">Por paciente</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left pb-2 font-medium">Paciente</th>
                    <th className="text-center pb-2 font-medium w-16">Casos</th>
                    <th className="text-right pb-2 font-medium">Total prestaciones</th>
                    <th className="text-right pb-2 font-medium">Enviado VUMI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {patientRows.map(p => (
                    <tr key={p.name}>
                      <td className="py-2.5 font-medium text-gray-900">{p.name}</td>
                      <td className="py-2.5 text-center text-gray-500">{p.count}</td>
                      <td className="py-2.5 text-right text-gray-700">
                        {p.total > 0 ? fmtCLP(p.total) : '—'}
                      </td>
                      <td className="py-2.5 text-right text-green-700">
                        {p.sent > 0 ? fmtCLP(p.sent) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Por mes */}
          {monthRows.length > 0 && (
            <div className="card">
              <h2 className="font-semibold text-gray-900 text-sm mb-4">Por mes</h2>
              <div className="space-y-2">
                {monthRows.map(m => (
                  <div key={m.key} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-16 shrink-0 capitalize">{m.label}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-green-400 rounded-full transition-all"
                        style={{ width: `${Math.max((m.total / maxMonthTotal) * 100, m.count > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{m.count}</span>
                    {m.total > 0 && (
                      <span className="text-xs text-gray-700 w-24 text-right font-medium">{fmtCLP(m.total)}</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-3">Barras = monto total · Número = cantidad de casos</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Sub-componente ────────────────────────────────────────────────────────
function AsegRow({
  label, sentCount, doneCount, totalCases, amount, color,
}: {
  label: string
  sentCount: number
  doneCount: number
  totalCases: number
  amount?: number
  color: string
}) {
  const pct = totalCases > 0 ? Math.round((doneCount / totalCases) * 100) : 0
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-700">{label}</span>
        <div className="flex items-center gap-3">
          {amount != null && amount > 0 && (
            <span className="text-xs font-medium text-gray-600">{fmtCLP(amount)}</span>
          )}
          <span className="text-xs text-gray-400">
            {doneCount} / {totalCases}
          </span>
        </div>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
