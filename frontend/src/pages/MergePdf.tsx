import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import {
  Upload as UploadIcon, X, FileText, Loader2, ChevronUp, ChevronDown,
  Download, Layers,
} from 'lucide-react'
import { mergeFilesToPdf } from '@/lib/mergeFiles'
import clsx from 'clsx'

const ACCEPTED_TYPES = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function MergePdf() {
  const [files, setFiles]     = useState<File[]>([])
  const [merging, setMerging] = useState(false)
  const [fileName, setFileName] = useState('documento-combinado')

  const onDrop = useCallback((accepted: File[]) => {
    setFiles(prev => [...prev, ...accepted])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    multiple: true,
  })

  function moveFile(index: number, direction: -1 | 1) {
    setFiles(prev => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  async function handleMergeAndDownload() {
    if (files.length === 0) return
    setMerging(true)
    try {
      const blob = await mergeFilesToPdf(files)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(fileName || 'documento-combinado').trim()}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert('Error al combinar: ' + e.message)
    } finally {
      setMerging(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Layers size={22} className="text-green-600" />
          Unir archivos en un PDF
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Combina imágenes y PDFs en un solo archivo y descárgalo directamente a tu computador.
          No queda guardado en ningún caso — es una herramienta independiente.
        </p>
      </div>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={clsx(
          'border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors mb-6',
          isDragActive
            ? 'border-green-500 bg-green-50'
            : 'border-gray-200 hover:border-green-400 hover:bg-gray-50'
        )}
      >
        <input {...getInputProps()} />
        <UploadIcon
          size={32}
          className={clsx('mx-auto mb-3', isDragActive ? 'text-green-600' : 'text-gray-300')}
        />
        {isDragActive ? (
          <p className="text-green-700 font-medium">Suelta los archivos aquí</p>
        ) : (
          <>
            <p className="text-gray-600 font-medium mb-1">Arrastra archivos aquí</p>
            <p className="text-sm text-gray-400">o haz clic para seleccionarlos (PDF, JPG, PNG, HEIC)</p>
          </>
        )}
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="card mb-6">
          <p className="text-gray-400 text-xs mb-4">Se combinarán en este orden (usa las flechas para reordenar):</p>
          <div className="space-y-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-lg px-4 py-3">
                <span className="text-gray-400 text-xs w-5">{i + 1}</span>
                <FileText size={16} className="text-gray-400 shrink-0" />
                <span className="text-sm text-gray-700 truncate">{f.name}</span>
                <span className="text-xs text-gray-400 ml-auto shrink-0">{formatSize(f.size)}</span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveFile(i, -1)}
                    disabled={i === 0}
                    className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-20 disabled:pointer-events-none"
                    title="Mover arriba"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveFile(i, 1)}
                    disabled={i === files.length - 1}
                    className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-20 disabled:pointer-events-none"
                    title="Mover abajo"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-gray-200"
                    title="Quitar archivo"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {files.length > 0 && (
        <div className="card">
          <label className="block text-xs text-gray-500 mb-1.5">Nombre del archivo final</label>
          <div className="flex items-center gap-2 mb-4">
            <input
              type="text"
              value={fileName}
              onChange={e => setFileName(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500"
              placeholder="documento-combinado"
            />
            <span className="text-sm text-gray-400">.pdf</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleMergeAndDownload}
              disabled={merging}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {merging ? (
                <><Loader2 size={16} className="animate-spin" /> Combinando...</>
              ) : (
                <><Download size={16} /> Combinar y descargar</>
              )}
            </button>

            <button
              onClick={() => setFiles([])}
              disabled={merging}
              className="btn-secondary ml-auto disabled:opacity-50"
            >
              Limpiar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
