import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import type { Patient } from '@/lib/types'
import { ArrowLeft, Loader2, ListChecks, AlertTriangle } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'

interface PuntoResumen {
  informeId: string
  fecha: string | null
  valor: number
  unidad: string | null
  rangoMin: number | null
  rangoMax: number | null
  fueraDeRango: boolean
}

interface GrupoValor {
  key: string
  label: string
  puntos: PuntoResumen[] // orden cronológico ascendente
}

// Ficha resumen: para un paciente, agrupa TODOS los valores registrados
// (de todos sus informes) por nombre de examen, ordenados por fecha, para
// ver de un vistazo cómo ha evolucionado cada uno y cuáles están fuera de
// rango actualmente. A diferencia de "Tendencias" (que gráfica un solo
// valor a la vez), esta vista muestra todo junto.
export default function ResumenPaciente() {
  const { patientId: patientIdParam } = useParams<{ patientId?: string }>()
  const navigate = useNavigate()
  const { userId } = useStore()

  const [patients, setPatients] = useState<Patient[]>([])
  const [patientId, setPatientId] = useState<string>('')
  const [loadingPatients, setLoadingPatients] = useState(true)
  const [loadingDatos, setLoadingDatos] = useState(false)
  const [grupos, setGrupos] = useState<GrupoValor[]>([])

  useEffect(() => {
    if (!userId) return
    supabase.from('patients').select('*')
      .eq('user_id', userId).eq('is_active', true)
      .order('full_name')
      .then(({ data }: { data: Patient[] | null }) => {
        setPatients(data ?? [])
        setLoadingPatients(false)
        if (patientIdParam) setPatientId(patientIdParam)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    setGrupos([])
    if (!patientId) return

    async function loadResumen() {
      setLoadingDatos(true)
      const { data: informes } = await supabase
        .from('historial_informes')
        .select('id, fecha_examen')
        .eq('patient_id', patientId)
      const informesMap = new Map<string, string | null>(
        (informes ?? []).map((i: { id: string; fecha_examen: string | null }) => [i.id, i.fecha_examen])
      )
      const ids = Array.from(informesMap.keys())
      if (ids.length === 0) { setGrupos([]); setLoadingDatos(false); return }

      const { data: valores } = await supabase
        .from('historial_valores')
        .select('*')
        .in('informe_id', ids)

      const mapa = new Map<string, GrupoValor>()
      for (const v of valores ?? []) {
        if (v.valor == null) continue
        const key = v.nombre_valor.trim().toLowerCase()
        const punto: PuntoResumen = {
          informeId: v.informe_id,
          fecha: informesMap.get(v.informe_id) ?? null,
          valor: v.valor,
          unidad: v.unidad,
          rangoMin: v.rango_min,
          rangoMax: v.rango_max,
          fueraDeRango: v.fuera_de_rango,
        }
        const existente = mapa.get(key)
        if (existente) existente.puntos.push(punto)
        else mapa.set(key, { key, label: v.nombre_valor.trim(), puntos: [punto] })
      }

      const lista = Array.from(mapa.values())
      for (const g of lista) g.puntos.sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''))
      lista.sort((a, b) => a.label.localeCompare(b.label))

      setGrupos(lista)
      setLoadingDatos(false)
    }
    loadResumen()
  }, [patientId])

  // Valores cuya última medición está fuera de rango, para el resumen de alerta.
  const fueraDeRangoAhora = useMemo(
    () => grupos.filter((g) => g.puntos[g.puntos.length - 1]?.fueraDeRango),
    [grupos]
  )

  function fmtFecha(f: string | null) {
    if (!f) return 'Sin fecha'
    return new Date(f + 'T00:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  if (loadingPatients) return (
    <div className="p-8 flex items-center gap-2 text-gray-400">
      <Loader2 size={18} className="animate-spin" /> Cargando...
    </div>
  )

  return (
    <div className="p-6 max-w-4xl">
      <Link to="/hoja-de-vida" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 mb-4">
        <ArrowLeft size={14} /> Hoja de vida
      </Link>

      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <ListChecks size={20} className="text-green-600" /> Ficha resumen
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Todos los exámenes del paciente, agrupados y ordenados por fecha.</p>
      </div>

      {patients.length === 0 ? (
        <EmptyState icon={ListChecks} title="No hay pacientes registrados" description="Agrega pacientes desde el sistema de reembolsos." />
      ) : (
        <>
          <div className="mb-6">
            <label className="block text-xs font-medium text-gray-600 mb-1">Paciente</label>
            <select
              className="select w-full max-w-sm text-sm"
              value={patientId}
              onChange={(e) => { setPatientId(e.target.value); navigate(`/hoja-de-vida/resumen/${e.target.value}`, { replace: true }) }}
            >
              <option value="">Selecciona un paciente</option>
              {patients.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>

          {loadingDatos && (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-8">
              <Loader2 size={16} className="animate-spin" /> Cargando...
            </div>
          )}

          {!loadingDatos && patientId && grupos.length === 0 && (
            <p className="text-sm text-gray-400 py-8 text-center">Este paciente no tiene valores de examen registrados todavía.</p>
          )}

          {!loadingDatos && grupos.length > 0 && (
            <div className="space-y-5">
              {fueraDeRangoAhora.length > 0 && (
                <div className="card border-red-200 bg-red-50">
                  <p className="text-sm font-semibold text-red-700 flex items-center gap-1.5 mb-2">
                    <AlertTriangle size={14} /> Fuera de rango en la última medición
                  </p>
                  <ul className="text-sm text-red-700 space-y-1">
                    {fueraDeRangoAhora.map((g) => {
                      const ultimo = g.puntos[g.puntos.length - 1]
                      return (
                        <li key={g.key} className="flex items-center justify-between gap-2">
                          <span>{g.label}</span>
                          <span className="font-medium">
                            {ultimo.valor}{ultimo.unidad ? ` ${ultimo.unidad}` : ''} · {fmtFecha(ultimo.fecha)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              <div className="card overflow-hidden !p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                      <th className="text-left font-medium py-2 px-3">Examen</th>
                      <th className="text-left font-medium py-2 px-3">Último resultado</th>
                      <th className="text-left font-medium py-2 px-3">Fecha</th>
                      <th className="text-left font-medium py-2 px-3">Historial</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupos.map((g) => {
                      const ultimo = g.puntos[g.puntos.length - 1]
                      const anteriores = g.puntos.slice(0, -1).slice(-4) // hasta 4 previos, más recientes primero para leer
                      return (
                        <tr key={g.key} className="border-b border-gray-50 last:border-0 align-top">
                          <td className="py-2.5 px-3 text-gray-800 font-medium whitespace-nowrap">{g.label}</td>
                          <td className={`py-2.5 px-3 font-medium whitespace-nowrap ${ultimo.fueraDeRango ? 'text-red-600' : 'text-gray-900'}`}>
                            {ultimo.valor}{ultimo.unidad ? ` ${ultimo.unidad}` : ''}
                            {ultimo.fueraDeRango && <AlertTriangle size={11} className="inline ml-1 -mt-0.5" />}
                            {ultimo.rangoMin != null && ultimo.rangoMax != null && (
                              <span className="block text-xs text-gray-400 font-normal">Rango: {ultimo.rangoMin} - {ultimo.rangoMax}</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-gray-500 whitespace-nowrap">
                            <Link to={`/hoja-de-vida/${patientId}/informes/${ultimo.informeId}`} className="hover:underline hover:text-green-700">
                              {fmtFecha(ultimo.fecha)}
                            </Link>
                          </td>
                          <td className="py-2.5 px-3 text-xs text-gray-400">
                            {anteriores.length === 0 ? (
                              '—'
                            ) : (
                              [...anteriores].reverse().map((p, i) => (
                                <span key={i} className={p.fueraDeRango ? 'text-red-500' : ''}>
                                  {i > 0 && ', '}{p.valor}{p.unidad ? p.unidad : ''} ({fmtFecha(p.fecha)})
                                </span>
                              ))
                            )}
                            {g.puntos.length > 5 && <span className="text-gray-300"> +{g.puntos.length - 5} más</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
