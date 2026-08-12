import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { TipoExamen } from '../lib/types'
import { Plus, Check, X } from 'lucide-react'

interface Props {
  value: number | null
  onChange: (id: number, tipo: TipoExamen) => void
  detected?: boolean
}

// Dropdown de tipo de examen — lista cerrada (historial_tipos_examen) pero
// extensible: si el tipo que se necesita no está, se puede agregar aquí mismo.
export default function TipoExamenSelect({ value, onChange, detected }: Props) {
  const [tipos, setTipos] = useState<TipoExamen[]>([])
  const [loading, setLoading] = useState(true)
  const [addingNew, setAddingNew] = useState(false)
  const [newNombre, setNewNombre] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data } = await supabase.from('historial_tipos_examen').select('*').order('nombre')
    setTipos(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addTipo() {
    if (!newNombre.trim()) return
    setSaving(true)
    const codigo = newNombre.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const { data, error } = await supabase
      .from('historial_tipos_examen')
      .insert({ codigo, nombre: newNombre.trim() })
      .select().single()
    setSaving(false)
    if (!error && data) {
      await load()
      onChange(data.id, data as TipoExamen)
      setAddingNew(false)
      setNewNombre('')
    }
  }

  if (loading) return <div className="input w-full text-sm text-gray-400">Cargando tipos...</div>

  if (addingNew) {
    return (
      <div className="flex gap-2">
        <input
          autoFocus
          className="input flex-1 text-sm"
          placeholder="Nombre del nuevo tipo de examen"
          value={newNombre}
          onChange={(e) => setNewNombre(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTipo()}
        />
        <button onClick={addTipo} disabled={saving || !newNombre.trim()} className="btn-primary px-3 disabled:opacity-50">
          <Check size={14} />
        </button>
        <button onClick={() => setAddingNew(false)} className="btn-secondary px-3">
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={value ?? ''}
        onChange={(e) => {
          const id = Number(e.target.value)
          const tipo = tipos.find((t) => t.id === id)
          if (tipo) onChange(id, tipo)
        }}
        className="select w-full text-sm"
      >
        <option value="" disabled>Seleccionar tipo de examen</option>
        {tipos.map((t) => (
          <option key={t.id} value={t.id}>{t.nombre}</option>
        ))}
      </select>
      {detected && <span className="text-[10px] text-emerald-600 font-medium shrink-0">IA</span>}
      <button
        type="button"
        onClick={() => setAddingNew(true)}
        className="shrink-0 text-gray-400 hover:text-green-600 p-1.5"
        title="Agregar nuevo tipo de examen"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
