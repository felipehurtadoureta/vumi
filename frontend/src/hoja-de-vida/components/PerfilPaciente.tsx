import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import type { HistorialPerfil, SexoBiologico } from '../lib/types'
import { calcularEdad } from '../lib/perfil'
import { UserRound, Pencil, Loader2, Save, ChevronDown, ChevronUp } from 'lucide-react'

interface Props {
  patientId: string
}

interface FormState {
  fecha_nacimiento: string
  sexo_biologico: SexoBiologico | ''
  condiciones_cronicas: string
  alergias: string
  medicamentos_habituales: string
  estatura_cm: string
  peso_kg: string
}

const EMPTY_FORM: FormState = {
  fecha_nacimiento: '', sexo_biologico: '', condiciones_cronicas: '',
  alergias: '', medicamentos_habituales: '', estatura_cm: '', peso_kg: '',
}

function toForm(p: HistorialPerfil): FormState {
  return {
    fecha_nacimiento: p.fecha_nacimiento ?? '',
    sexo_biologico: p.sexo_biologico ?? '',
    condiciones_cronicas: p.condiciones_cronicas ?? '',
    alergias: p.alergias ?? '',
    medicamentos_habituales: p.medicamentos_habituales ?? '',
    estatura_cm: p.estatura_cm != null ? String(p.estatura_cm) : '',
    peso_kg: p.peso_kg != null ? String(p.peso_kg) : '',
  }
}

export default function PerfilPaciente({ patientId }: Props) {
  const { userId } = useStore()
  const [perfil, setPerfil] = useState<HistorialPerfil | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  useEffect(() => {
    if (!patientId) return
    async function load() {
      const { data } = await supabase
        .from('historial_perfil_paciente')
        .select('*')
        .eq('patient_id', patientId)
        .maybeSingle()
      setPerfil(data as HistorialPerfil | null)
      setForm(data ? toForm(data as HistorialPerfil) : EMPTY_FORM)
      setLoading(false)
    }
    load()
  }, [patientId])

  function startEdit() {
    setForm(perfil ? toForm(perfil) : EMPTY_FORM)
    setEditing(true)
    setExpanded(true)
  }

  async function handleSave() {
    if (!userId || !patientId) return
    setSaving(true)
    const payload = {
      user_id: userId,
      patient_id: patientId,
      fecha_nacimiento: form.fecha_nacimiento || null,
      sexo_biologico: form.sexo_biologico || null,
      condiciones_cronicas: form.condiciones_cronicas.trim() || null,
      alergias: form.alergias.trim() || null,
      medicamentos_habituales: form.medicamentos_habituales.trim() || null,
      estatura_cm: form.estatura_cm.trim() && !isNaN(parseFloat(form.estatura_cm)) ? parseFloat(form.estatura_cm) : null,
      peso_kg: form.peso_kg.trim() && !isNaN(parseFloat(form.peso_kg)) ? parseFloat(form.peso_kg) : null,
    }
    const { data, error } = await supabase
      .from('historial_perfil_paciente')
      .upsert(payload, { onConflict: 'patient_id' })
      .select()
      .single()
    setSaving(false)
    if (!error && data) {
      setPerfil(data as HistorialPerfil)
      setEditing(false)
    }
  }

  if (loading) return null

  const edadActual = calcularEdad(perfil?.fecha_nacimiento ?? null, null)
  const tieneDatos = !!perfil && (
    perfil.fecha_nacimiento || perfil.sexo_biologico || perfil.condiciones_cronicas ||
    perfil.alergias || perfil.medicamentos_habituales || perfil.estatura_cm != null || perfil.peso_kg != null
  )

  return (
    <div className="card mb-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2">
          <UserRound size={16} className="text-green-600 shrink-0" />
          <span className="text-sm font-semibold text-gray-900">Perfil</span>
          {!tieneDatos && (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              Sin completar
            </span>
          )}
          {tieneDatos && !expanded && (
            <span className="text-xs text-gray-400">
              {edadActual != null ? `${edadActual} años` : null}
              {perfil?.sexo_biologico ? ` · ${perfil.sexo_biologico}` : ''}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {!editing ? (
            <>
              {tieneDatos ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <Row label="Fecha de nacimiento" value={perfil?.fecha_nacimiento ? new Date(perfil.fecha_nacimiento + 'T00:00:00').toLocaleDateString('es-CL') : null} />
                  <Row label="Edad actual" value={edadActual != null ? `${edadActual} años` : null} />
                  <Row label="Sexo biológico" value={perfil?.sexo_biologico ?? null} />
                  <Row label="Estatura" value={perfil?.estatura_cm != null ? `${perfil.estatura_cm} cm` : null} />
                  <Row label="Peso de referencia" value={perfil?.peso_kg != null ? `${perfil.peso_kg} kg` : null} />
                  <Row label="Condiciones crónicas" value={perfil?.condiciones_cronicas ?? null} span />
                  <Row label="Alergias" value={perfil?.alergias ?? null} span />
                  <Row label="Medicamentos habituales" value={perfil?.medicamentos_habituales ?? null} span />
                </div>
              ) : (
                <p className="text-sm text-gray-400">Aún no hay datos básicos registrados para este paciente.</p>
              )}
              <button onClick={startEdit} className="btn-secondary text-xs py-1.5 px-3">
                <Pencil size={12} /> {tieneDatos ? 'Editar perfil' : 'Completar perfil'}
              </button>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Fecha de nacimiento</label>
                  <input type="date" value={form.fecha_nacimiento} onChange={(e) => setForm({ ...form, fecha_nacimiento: e.target.value })} className="input w-full text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Sexo biológico</label>
                  <select value={form.sexo_biologico} onChange={(e) => setForm({ ...form, sexo_biologico: e.target.value as SexoBiologico | '' })} className="select w-full text-sm">
                    <option value="">Sin especificar</option>
                    <option value="femenino">Femenino</option>
                    <option value="masculino">Masculino</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Estatura (cm)</label>
                  <input value={form.estatura_cm} onChange={(e) => setForm({ ...form, estatura_cm: e.target.value })} className="input w-full text-sm" placeholder="170" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Peso de referencia (kg)</label>
                  <input value={form.peso_kg} onChange={(e) => setForm({ ...form, peso_kg: e.target.value })} className="input w-full text-sm" placeholder="70" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Condiciones crónicas / enfermedades previas</label>
                <textarea value={form.condiciones_cronicas} onChange={(e) => setForm({ ...form, condiciones_cronicas: e.target.value })} className="input w-full text-sm" rows={2} placeholder="Ej: hipertensión, diabetes tipo 2..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Alergias</label>
                <textarea value={form.alergias} onChange={(e) => setForm({ ...form, alergias: e.target.value })} className="input w-full text-sm" rows={2} placeholder="Ej: penicilina, mariscos..." />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Medicamentos habituales</label>
                <textarea value={form.medicamentos_habituales} onChange={(e) => setForm({ ...form, medicamentos_habituales: e.target.value })} className="input w-full text-sm" rows={2} placeholder="Ej: losartán 50mg diario..." />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving} className="btn-primary text-xs py-1.5 px-3 disabled:opacity-50">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Guardar
                </button>
                <button onClick={() => setEditing(false)} disabled={saving} className="text-xs text-gray-400 hover:text-gray-600 px-3">
                  Cancelar
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, span }: { label: string; value: string | null; span?: boolean }) {
  if (!value) return null
  return (
    <div className={span ? 'col-span-2' : ''}>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-gray-800">{value}</p>
    </div>
  )
}
