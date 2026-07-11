import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import type { Patient } from '@/lib/types'
import { Loader2, Pencil, Check, X, UserPlus } from 'lucide-react'

const RELATIONSHIPS = ['Titular', 'Cónyuge', 'Hijo/a', 'Padre', 'Madre', 'Otro']

export default function Patients() {
  const { userId } = useStore()
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showNew, setShowNew] = useState(false)

  // edit state
  const [editFields, setEditFields] = useState<Partial<Patient>>({})

  // new patient state
  const [newFields, setNewFields] = useState({ full_name: '', alias: '', initials: '', rut: '', birth_date: '', relationship: '' })
  const [creating, setCreating] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('patients')
      .select('*')
      .eq('user_id', userId!)
      .order('full_name')
    setPatients(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function startEdit(p: Patient) {
    setEditingId(p.id)
    setEditFields({
      full_name:    p.full_name,
      alias:        p.alias ?? '',
      initials:     p.initials ?? '',
      rut:          p.rut ?? '',
      birth_date:   p.birth_date ?? '',
      relationship: p.relationship ?? '',
    })
  }

  async function saveEdit() {
    if (!editingId) return
    setSaving(true)
    await supabase.from('patients').update({
      full_name:    editFields.full_name,
      alias:        editFields.alias        || null,
      initials:     editFields.initials     || null,
      rut:          editFields.rut          || null,
      birth_date:   editFields.birth_date   || null,
      relationship: editFields.relationship || null,
    }).eq('id', editingId)
    setSaving(false)
    setEditingId(null)
    await load()
  }

  async function createPatient() {
    if (!newFields.full_name.trim()) return
    setCreating(true)
    await supabase.from('patients').insert({
      user_id:      userId,
      full_name:    newFields.full_name.trim(),
      alias:        newFields.alias.trim()    || null,
      initials:     newFields.initials.trim() || null,
      rut:          newFields.rut.trim()      || null,
      birth_date:   newFields.birth_date      || null,
      relationship: newFields.relationship    || null,
      is_active:    true,
    })
    setCreating(false)
    setShowNew(false)
    setNewFields({ full_name: '', alias: '', initials: '', rut: '', birth_date: '', relationship: '' })
    await load()
  }

  if (loading) return (
    <div className="p-8 flex items-center gap-2 text-gray-400">
      <Loader2 size={18} className="animate-spin" /> Cargando...
    </div>
  )

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Pacientes</h1>
          <p className="text-sm text-gray-500 mt-0.5">Familia cubierta por VUMI</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary">
          <UserPlus size={16} /> Agregar
        </button>
      </div>

      {/* Formulario nuevo paciente */}
      {showNew && (
        <div className="card mb-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Nuevo paciente</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">Nombre completo *</label>
              <input className="input w-full" value={newFields.full_name}
                onChange={(e) => setNewFields((f) => ({ ...f, full_name: e.target.value }))}
                placeholder="Felipe Hurtado Vial" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Alias</label>
              <input className="input w-full" value={newFields.alias}
                onChange={(e) => setNewFields((f) => ({ ...f, alias: e.target.value }))}
                placeholder="Felipe" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">
                Iniciales <span className="text-gray-400">(para nombre de archivos)</span>
              </label>
              <input className="input w-full" value={newFields.initials}
                onChange={(e) => setNewFields((f) => ({ ...f, initials: e.target.value.toUpperCase() }))}
                placeholder="FHV" maxLength={5} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">RUT</label>
              <input className="input w-full" value={newFields.rut}
                onChange={(e) => setNewFields((f) => ({ ...f, rut: e.target.value }))}
                placeholder="12.345.678-9" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Fecha nacimiento</label>
              <input type="date" className="input w-full" value={newFields.birth_date}
                onChange={(e) => setNewFields((f) => ({ ...f, birth_date: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Relación</label>
              <select className="select w-full" value={newFields.relationship}
                onChange={(e) => setNewFields((f) => ({ ...f, relationship: e.target.value }))}>
                <option value="">Seleccionar</option>
                {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={createPatient} disabled={creating || !newFields.full_name.trim()} className="btn-primary disabled:opacity-50">
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Guardar
            </button>
            <button onClick={() => setShowNew(false)} className="btn-secondary">Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      <div className="space-y-3">
        {patients.map((p) => (
          <div key={p.id} className="card">
            {editingId === p.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500 mb-1 block">Nombre completo</label>
                    <input className="input w-full" value={editFields.full_name ?? ''}
                      onChange={(e) => setEditFields((f) => ({ ...f, full_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Alias</label>
                    <input className="input w-full" value={editFields.alias ?? ''}
                      onChange={(e) => setEditFields((f) => ({ ...f, alias: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">
                      Iniciales <span className="text-gray-400">(archivos)</span>
                    </label>
                    <input className="input w-full" value={editFields.initials ?? ''}
                      onChange={(e) => setEditFields((f) => ({ ...f, initials: e.target.value.toUpperCase() }))}
                      placeholder="FHV" maxLength={5} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">RUT</label>
                    <input className="input w-full" value={editFields.rut ?? ''}
                      onChange={(e) => setEditFields((f) => ({ ...f, rut: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Fecha nacimiento</label>
                    <input type="date" className="input w-full" value={editFields.birth_date ?? ''}
                      onChange={(e) => setEditFields((f) => ({ ...f, birth_date: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Relación</label>
                    <select className="select w-full" value={editFields.relationship ?? ''}
                      onChange={(e) => setEditFields((f) => ({ ...f, relationship: e.target.value }))}>
                      <option value="">Seleccionar</option>
                      {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEdit} disabled={saving} className="btn-primary disabled:opacity-50">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Guardar
                  </button>
                  <button onClick={() => setEditingId(null)} className="btn-secondary">
                    <X size={14} /> Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-sm font-bold text-green-700">
                    {p.initials ?? p.full_name.split(' ').map((n) => n[0]).join('').slice(0, 3)}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 text-sm">
                      {p.full_name}
                      {p.alias && <span className="text-gray-400 font-normal ml-2">({p.alias})</span>}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {p.relationship && <span>{p.relationship}</span>}
                      {p.rut && <span className="ml-2">· RUT {p.rut}</span>}
                      {p.initials
                        ? <span className="ml-2 text-green-600 font-medium">· Iniciales: {p.initials}</span>
                        : <span className="ml-2 text-amber-500">· Sin iniciales</span>
                      }
                    </p>
                  </div>
                </div>
                <button onClick={() => startEdit(p)} className="btn-secondary text-xs py-1.5 px-3">
                  <Pencil size={13} /> Editar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
