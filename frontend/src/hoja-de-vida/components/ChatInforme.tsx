import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { HistorialInforme, HistorialValor, HistorialPerfil } from '../lib/types'
import { askAboutInforme, buildContextForInforme, buildContextForHistorial } from '../lib/chatInforme'
import type { ChatMessage } from '../lib/chatInforme'
import { Send, Loader2, MessageCircleQuestion, AlertTriangle } from 'lucide-react'

interface Props {
  informe: HistorialInforme
  valores: HistorialValor[]
  patientId: string
}

type Scope = 'informe' | 'historial'

export default function ChatInforme({ informe, valores, patientId }: Props) {
  const [scope, setScope] = useState<Scope>('informe')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [perfil, setPerfil] = useState<HistorialPerfil | null>(null)

  useEffect(() => {
    async function loadPerfil() {
      const { data } = await supabase
        .from('historial_perfil_paciente')
        .select('*')
        .eq('patient_id', patientId)
        .maybeSingle()
      setPerfil(data as HistorialPerfil | null)
    }
    loadPerfil()
  }, [patientId])

  function changeScope(next: Scope) {
    setScope(next)
    setMessages([])
    setError('')
  }

  async function handleAsk() {
    const q = question.trim()
    if (!q || loading) return
    setQuestion('')
    setError('')
    const history = messages
    setMessages([...history, { role: 'user', text: q }])
    setLoading(true)

    try {
      let context: string
      if (scope === 'informe') {
        context = buildContextForInforme(informe, valores, perfil)
      } else {
        const { data: informes } = await supabase
          .from('historial_informes')
          .select('*, tipo_examen:historial_tipos_examen(*)')
          .eq('patient_id', patientId)
          .order('fecha_examen', { ascending: true })

        const ids = (informes ?? []).map((i: any) => i.id)
        const { data: todosValores } = ids.length > 0
          ? await supabase.from('historial_valores').select('*').in('informe_id', ids)
          : { data: [] as HistorialValor[] }

        const items = ((informes ?? []) as HistorialInforme[]).map((inf) => ({
          informe: inf,
          valores: ((todosValores ?? []) as HistorialValor[]).filter((v) => v.informe_id === inf.id),
        }))
        context = buildContextForHistorial(items, perfil)
      }

      const answer = await askAboutInforme(context, history, q)
      setMessages((prev) => [...prev, { role: 'model', text: answer }])
    } catch (e: any) {
      setError(e.message ?? 'Error al consultar la IA')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageCircleQuestion size={16} className="text-green-600 shrink-0" />
          <h3 className="text-sm font-semibold text-gray-900">Preguntar a la IA</h3>
        </div>
        <select
          value={scope}
          onChange={(e) => changeScope(e.target.value as Scope)}
          className="select text-xs py-1.5 px-2 w-auto"
        >
          <option value="informe">Sobre este informe</option>
          <option value="historial">Sobre todo el historial</option>
        </select>
      </div>

      <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
        <span>Esta respuesta es generada por IA con fines informativos y no reemplaza la evaluación de un profesional de la salud. Consulta estos resultados con tu médico.</span>
      </div>

      {messages.length > 0 && (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`text-sm rounded-lg px-3 py-2 whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-gray-100 text-gray-800 ml-8'
                  : 'bg-emerald-50 text-emerald-900 mr-8'
              }`}
            >
              {m.text}
            </div>
          ))}
          {loading && (
            <div className="text-sm text-gray-400 mr-8 flex items-center gap-1.5">
              <Loader2 size={13} className="animate-spin" /> Pensando...
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
          placeholder={scope === 'informe' ? 'Ej: ¿qué significa este resultado?' : 'Ej: ¿ha subido la glucosa en el tiempo?'}
          className="input flex-1 text-sm"
          disabled={loading}
        />
        <button onClick={handleAsk} disabled={loading || !question.trim()} className="btn-primary px-3 disabled:opacity-50">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
    </div>
  )
}
