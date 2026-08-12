import { Plus, Trash2, CheckCircle2 } from 'lucide-react'

export interface ValorRow {
  nombre_valor: string
  valor: string      // como texto mientras se edita, se convierte a numeric al guardar
  unidad: string
  rango_min: string
  rango_max: string
}

interface Props {
  rows: ValorRow[]
  onChange: (rows: ValorRow[]) => void
  aiExtracted?: boolean
}

const EMPTY_ROW: ValorRow = { nombre_valor: '', valor: '', unidad: '', rango_min: '', rango_max: '' }

export default function ValoresEditor({ rows, onChange, aiExtracted }: Props) {
  function updateRow(i: number, field: keyof ValorRow, value: string) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r))
    onChange(next)
  }

  function addRow() {
    onChange([...rows, { ...EMPTY_ROW }])
  }

  function removeRow(i: number) {
    onChange(rows.filter((_, idx) => idx !== i))
  }

  function isOutOfRange(r: ValorRow): boolean {
    const v = parseFloat(r.valor)
    const min = parseFloat(r.rango_min)
    const max = parseFloat(r.rango_max)
    if (isNaN(v) || isNaN(min) || isNaN(max)) return false
    return v < min || v > max
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <label className="text-xs font-medium text-gray-600">Valores del examen (opcional)</label>
        {aiExtracted && rows.length > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium">
            <CheckCircle2 size={10} /> IA
          </span>
        )}
      </div>

      {rows.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden mb-2">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left font-medium px-2 py-1.5">Nombre</th>
                <th className="text-left font-medium px-2 py-1.5 w-20">Valor</th>
                <th className="text-left font-medium px-2 py-1.5 w-20">Unidad</th>
                <th className="text-left font-medium px-2 py-1.5 w-16">Mín</th>
                <th className="text-left font-medium px-2 py-1.5 w-16">Máx</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`border-t border-gray-100 ${isOutOfRange(r) ? 'bg-red-50' : ''}`}>
                  <td className="p-1">
                    <input
                      value={r.nombre_valor}
                      onChange={(e) => updateRow(i, 'nombre_valor', e.target.value)}
                      className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs"
                      placeholder="Glucosa"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      value={r.valor}
                      onChange={(e) => updateRow(i, 'valor', e.target.value)}
                      className={`w-full px-1.5 py-1 border rounded text-xs ${isOutOfRange(r) ? 'border-red-300 text-red-700 font-medium' : 'border-gray-200'}`}
                      placeholder="107"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      value={r.unidad}
                      onChange={(e) => updateRow(i, 'unidad', e.target.value)}
                      className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs"
                      placeholder="mg/dL"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      value={r.rango_min}
                      onChange={(e) => updateRow(i, 'rango_min', e.target.value)}
                      className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs"
                      placeholder="70"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      value={r.rango_max}
                      onChange={(e) => updateRow(i, 'rango_max', e.target.value)}
                      className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs"
                      placeholder="99"
                    />
                  </td>
                  <td className="p-1 text-center">
                    <button onClick={() => removeRow(i)} className="text-gray-300 hover:text-red-500" title="Quitar fila">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        type="button"
        onClick={addRow}
        className="text-xs text-gray-400 hover:text-green-600 flex items-center gap-1"
      >
        <Plus size={13} /> Agregar valor
      </button>
    </div>
  )
}
