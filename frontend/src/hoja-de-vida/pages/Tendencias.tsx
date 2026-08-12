import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import type { Patient } from '@/lib/types'
import { ArrowLeft, Loader2, TrendingUp, AlertTriangle } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'

interface Punto {
  informeId: string
  fecha: string | null
  valor: number
  unidad: string | null
  rangoMin: number | null
  rangoMax: number | null
  fueraDeRango: boolean
}

interface OpcionValor {
  key: string        // nombre normalizado (minúsculas), usado como value del select
  label: string       // nombre tal como aparece más seguido, para mostrar
  count: number
}

export default function Tendencias() {
  const { patientId: patientIdParam } = useParams<{ patientId?: string }>()
  const navigate = useNavigate()
  const { userId } = useStore()

  const [patients, setPatients] = useState<Patient[]>([])
  const [patientId, setPatientId] = useState<string>('')
  const [loadingPatients, setLoadingPatients] = useState(true)

  const [opciones, setOpciones] = useState<OpcionValor[]>([])
  const [nombreSeleccionado, setNombreSeleccionado] = useState('')
  const [puntos, setPuntos] = useState<Punto[]>([])
  const [loadingValores, setLoadingValores] = useState(false)

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

  // Al cambiar de paciente: cargar las opciones de examen/valor disponibles
  // (nombres distintos de historial_valores, agrupados sin distinguir
  // mayúsculas/minúsculas ya que pueden venir del lector local o de la IA
  // con distinta capitalización).
  useEffect(() => {
    setNombreSeleccionado('')
    setPuntos([])
    setOpciones([])
    if (!patientId) return

    async function loadOpciones() {
      const { data: informes } = await supabase
        .from('historial_informes')
        .select('id')
        .eq('patient_id', patientId)
      const ids = (informes ?? []).map((i: { id: string }) => i.id)
      if (ids.length === 0) return

      const { data: valores } = await supabase
        .from('historial_valores')
        .select('nombre_valor')
        .in('informe_id', ids)

      const grupos = new Map<string, { label: string; count: number }>()
      for (const v of valores ?? []) {
        const key = v.nombre_valor.trim().toLowerCase()
        const prev = grupos.get(key)
        if (prev) prev.count++
        else grupos.set(key, { label: v.nombre_valor.trim(), count: 1 })
      }
      const lista = Array.from(grupos.entries())
        .map(([key, { label, count }]) => ({ key, label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      setOpciones(lista)
    }
    loadOpciones()
  }, [patientId])

  // Al cambiar de valor seleccionado: cargar la serie de tiempo completa.
  useEffect(() => {
    setPuntos([])
    if (!patientId || !nombreSeleccionado) return

    async function loadSerie() {
      setLoadingValores(true)
      const { data: informes } = await supabase
        .from('historial_informes')
        .select('id, fecha_examen')
        .eq('patient_id', patientId)
      const informesMap = new Map<string, string | null>(
        (informes ?? []).map((i: { id: string; fecha_examen: string | null }) => [i.id, i.fecha_examen])
      )
      const ids = Array.from(informesMap.keys())
      if (ids.length === 0) { setLoadingValores(false); return }

      const { data: valores } = await supabase
        .from('historial_valores')
        .select('*')
        .in('informe_id', ids)

      interface ValorRow {
        informe_id: string
        nombre_valor: string
        valor: number
        unidad: string | null
        rango_min: number | null
        rango_max: number | null
        fuera_de_rango: boolean
      }

      const filtrados = ((valores ?? []) as ValorRow[]).filter(
        (v) => v.nombre_valor.trim().toLowerCase() === nombreSeleccionado
      )

      const pts: Punto[] = filtrados.map((v) => ({
        informeId: v.informe_id,
        fecha: informesMap.get(v.informe_id) ?? null,
        valor: v.valor,
        unidad: v.unidad,
        rangoMin: v.rango_min,
        rangoMax: v.rango_max,
        fueraDeRango: v.fuera_de_rango,
      }))
      pts.sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''))
      setPuntos(pts)
      setLoadingValores(false)
    }
    loadSerie()
  }, [patientId, nombreSeleccionado])

  const labelSeleccionado = opciones.find((o) => o.key === nombreSeleccionado)?.label ?? ''

  // Rango de referencia "canónico" para dibujar la banda: el más reciente
  // que venga con ambos límites definidos.
  const rangoRef = useMemo(() => {
    for (let i = puntos.length - 1; i >= 0; i--) {
      if (puntos[i].rangoMin != null && puntos[i].rangoMax != null) {
        return { min: puntos[i].rangoMin as number, max: puntos[i].rangoMax as number }
      }
    }
    return null
  }, [puntos])

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
          <TrendingUp size={20} className="text-green-600" /> Tendencias
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Evolución de un examen o valor en el tiempo.</p>
      </div>

      {patients.length === 0 ? (
        <EmptyState icon={TrendingUp} title="No hay pacientes registrados" description="Agrega pacientes desde el sistema de reembolsos." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Paciente</label>
              <select
                className="select w-full text-sm"
                value={patientId}
                onChange={(e) => { setPatientId(e.target.value); navigate(`/hoja-de-vida/tendencias/${e.target.value}`, { replace: true }) }}
              >
                <option value="">Selecciona un paciente</option>
                {patients.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Examen / valor</label>
              <select
                className="select w-full text-sm"
                value={nombreSeleccionado}
                onChange={(e) => setNombreSeleccionado(e.target.value)}
                disabled={!patientId || opciones.length === 0}
              >
                <option value="">
                  {!patientId ? 'Primero elige un paciente' : opciones.length === 0 ? 'Sin valores registrados' : 'Selecciona un valor'}
                </option>
                {opciones.map((o) => (
                  <option key={o.key} value={o.key}>{o.label} ({o.count})</option>
                ))}
              </select>
            </div>
          </div>

          {loadingValores && (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-8">
              <Loader2 size={16} className="animate-spin" /> Cargando...
            </div>
          )}

          {!loadingValores && patientId && nombreSeleccionado && puntos.length === 0 && (
            <p className="text-sm text-gray-400 py-8 text-center">No hay datos suficientes para graficar.</p>
          )}

          {!loadingValores && puntos.length > 0 && (
            <div className="space-y-4">
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-gray-900">{labelSeleccionado}</h2>
                  {rangoRef && (
                    <span className="text-xs text-gray-400">Rango normal: {rangoRef.min} - {rangoRef.max} {puntos[puntos.length - 1]?.unidad ?? ''}</span>
                  )}
                </div>
                <TrendChart puntos={puntos} rangoRef={rangoRef} />
              </div>

              <div className="card overflow-hidden !p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-100 bg-gray-50">
                      <th className="text-left font-medium py-2 px-3">Fecha</th>
                      <th className="text-left font-medium py-2 px-3">Resultado</th>
                      <th className="text-left font-medium py-2 px-3">Rango</th>
                      <th className="text-left font-medium py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...puntos].reverse().map((p, i) => (
                      <tr key={i} className={`border-b border-gray-50 last:border-0 ${p.fueraDeRango ? 'bg-red-50' : ''}`}>
                        <td className="py-2 px-3 text-gray-600">{fmtFecha(p.fecha)}</td>
                        <td className={`py-2 px-3 font-medium ${p.fueraDeRango ? 'text-red-600' : 'text-gray-900'}`}>
                          {p.valor}{p.unidad ? ` ${p.unidad}` : ''}
                          {p.fueraDeRango && <AlertTriangle size={11} className="inline ml-1 -mt-0.5" />}
                        </td>
                        <td className="py-2 px-3 text-gray-400 text-xs">
                          {p.rangoMin != null && p.rangoMax != null ? `${p.rangoMin} - ${p.rangoMax}` : '—'}
                        </td>
                        <td className="py-2 px-3 text-xs">
                          <Link to={`/hoja-de-vida/${patientId}/informes/${p.informeId}`} className="text-green-700 hover:underline">Ver informe</Link>
                        </td>
                      </tr>
                    ))}
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

// Gráfico de línea simple en SVG, sin librerías externas. Muestra la banda
// de rango normal (si hay) y los puntos conectados, en rojo si están fuera
// de rango.
function TrendChart({ puntos, rangoRef }: { puntos: Punto[]; rangoRef: { min: number; max: number } | null }) {
  const W = 720
  const H = 220
  const PAD_L = 44
  const PAD_R = 16
  const PAD_T = 16
  const PAD_B = 28

  const valores = puntos.map((p) => p.valor)
  const candidatos = [...valores, ...(rangoRef ? [rangoRef.min, rangoRef.max] : [])]
  const dataMin = Math.min(...candidatos)
  const dataMax = Math.max(...candidatos)
  const span = dataMax - dataMin || 1
  const yMin = dataMin - span * 0.15
  const yMax = dataMax + span * 0.15

  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  function xFor(i: number) {
    return puntos.length === 1 ? PAD_L + innerW / 2 : PAD_L + (i / (puntos.length - 1)) * innerW
  }
  function yFor(v: number) {
    return PAD_T + innerH - ((v - yMin) / (yMax - yMin)) * innerH
  }

  const pathD = puntos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.valor)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 260 }}>
      {/* banda de rango normal */}
      {rangoRef && (
        <rect
          x={PAD_L} y={yFor(rangoRef.max)}
          width={innerW} height={Math.max(0, yFor(rangoRef.min) - yFor(rangoRef.max))}
          fill="#10b981" opacity={0.08}
        />
      )}

      {/* eje Y: min/max */}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + innerH} stroke="#e5e7eb" />
      <line x1={PAD_L} y1={PAD_T + innerH} x2={PAD_L + innerW} y2={PAD_T + innerH} stroke="#e5e7eb" />
      <text x={4} y={yFor(yMax) + 4} fontSize="10" fill="#9ca3af">{yMax.toFixed(1)}</text>
      <text x={4} y={yFor(yMin) + 4} fontSize="10" fill="#9ca3af">{yMin.toFixed(1)}</text>

      {/* línea de datos */}
      <path d={pathD} fill="none" stroke="#059669" strokeWidth={2} />

      {/* puntos */}
      {puntos.map((p, i) => (
        <circle
          key={i}
          cx={xFor(i)} cy={yFor(p.valor)} r={4}
          fill={p.fueraDeRango ? '#dc2626' : '#059669'}
        >
          <title>{`${p.fecha ?? 'sin fecha'}: ${p.valor}${p.unidad ?? ''}`}</title>
        </circle>
      ))}

      {/* etiquetas de fecha (primera, última y del medio si hay espacio) */}
      {puntos.map((p, i) => {
        const mostrar = puntos.length <= 6 || i === 0 || i === puntos.length - 1 || i === Math.floor(puntos.length / 2)
        if (!mostrar) return null
        const fecha = p.fecha ? new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''
        return (
          <text key={i} x={xFor(i)} y={H - 8} fontSize="9" fill="#9ca3af" textAnchor="middle">{fecha}</text>
        )
      })}
    </svg>
  )
}
