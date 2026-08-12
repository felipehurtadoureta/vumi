import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import type { Patient } from '@/lib/types'
import { Loader2, HeartPulse, TrendingUp, ListChecks } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'

export default function HojaDeVidaPacientes() {
  const { userId } = useStore()
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return
    supabase.from('patients').select('*')
      .eq('user_id', userId).eq('is_active', true)
      .order('full_name')
      .then(({ data }: { data: Patient[] | null }) => { setPatients(data ?? []); setLoading(false) })
  }, [userId])

  if (loading) return (
    <div className="p-8 flex items-center gap-2 text-gray-400">
      <Loader2 size={18} className="animate-spin" /> Cargando...
    </div>
  )

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Hoja de Vida Médica</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Historial clínico por persona — órdenes, exámenes y resultados
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/hoja-de-vida/resumen" className="btn-secondary text-sm">
            <ListChecks size={15} /> Ficha resumen
          </Link>
          <Link to="/hoja-de-vida/tendencias" className="btn-secondary text-sm">
            <TrendingUp size={15} /> Tendencias
          </Link>
        </div>
      </div>

      {patients.length === 0 ? (
        <EmptyState
          icon={HeartPulse}
          title="No hay pacientes registrados"
          description="Agrega pacientes desde la sección Pacientes del sistema de reembolsos."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {patients.map((p) => (
            <Link
              key={p.id}
              to={`/hoja-de-vida/${p.id}`}
              className="card flex items-center gap-4 hover:border-green-300 hover:shadow-sm transition-all"
            >
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-sm font-bold text-green-700 shrink-0">
                {p.initials ?? p.full_name.split(' ').map((n) => n[0]).join('').slice(0, 3)}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-gray-900 text-sm truncate">{p.full_name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {p.relationship ?? 'Familiar'}
                  {p.alias && <span> · {p.alias}</span>}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
