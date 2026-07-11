import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import StatusBadge from '@/components/ui/StatusBadge'
import type { MedicalCase } from '@/lib/types'
import { format, startOfMonth, endOfMonth, eachMonthOfInterval, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'

export default function Timeline() {
  const [cases, setCases] = useState<MedicalCase[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadCases()
  }, [])

  async function loadCases() {
    setLoading(true)
    const { data } = await supabase
      .from('medical_cases')
      .select('*, patient:patients(full_name, alias)')
      .order('event_date', { ascending: false })
    if (data) setCases(data as MedicalCase[])
    setLoading(false)
  }

  // Group by month
  const grouped = cases.reduce<Record<string, MedicalCase[]>>((acc, c) => {
    const key = c.event_date
      ? format(new Date(c.event_date), 'yyyy-MM')
      : format(new Date(c.created_at), 'yyyy-MM')
    if (!acc[key]) acc[key] = []
    acc[key].push(c)
    return acc
  }, {})

  const months = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Timeline de reembolsos</h1>
        <p className="text-sm text-gray-500 mt-1">Historial cronológico de todos los casos</p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : months.length === 0 ? (
        <p className="text-gray-400 text-center py-16">No hay casos todavía</p>
      ) : (
        <div className="space-y-8">
          {months.map((month) => (
            <div key={month}>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
                {format(new Date(month + '-01'), "MMMM yyyy", { locale: es })}
              </h2>
              <div className="space-y-3">
                {grouped[month].map((c) => (
                  <Link
                    key={c.id}
                    to={`/cases/${c.id}`}
                    className="card hover:border-green-200 hover:shadow-sm transition-all block"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-xs font-bold text-green-700">
                          {((c.patient as any)?.alias || (c.patient as any)?.full_name || '?')[0]}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {(c.patient as any)?.alias || (c.patient as any)?.full_name}
                          </p>
                          <p className="text-xs text-gray-400">
                            {c.provider || 'Sin proveedor'} ·{' '}
                            {c.event_date ? format(new Date(c.event_date), 'dd/MM/yyyy') : '—'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {c.total_amount && (
                          <span className="text-sm font-medium text-gray-700">
                            {new Intl.NumberFormat('es-CL', {
                              style: 'currency',
                              currency: c.currency,
                            }).format(c.total_amount)}
                          </span>
                        )}
                        <StatusBadge status={c.status} size="sm" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
