import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Maximize2, RotateCw, Wand2, X } from 'lucide-react'
import {
  cropFileToJpeg, detectDocumentQuad, FULL_QUAD, loadImage,
  type Pt, type Quad,
} from '@/lib/docScan'

type Props = {
  file: File
  /** Se llama con el archivo ya recortado (o con el original si el usuario lo omite). */
  onConfirm: (f: File) => void
  onCancel: () => void
  title?: string
}

const CORNER_LABELS = ['Superior izq.', 'Superior der.', 'Inferior der.', 'Inferior izq.']

export default function ImageCropModal({ file, onConfirm, onCancel, title }: Props) {
  const [img,       setImg]       = useState<HTMLImageElement | null>(null)
  const [quad,      setQuad]      = useState<Quad>(FULL_QUAD)
  const [rotation,  setRotation]  = useState<0 | 90 | 180 | 270>(0)
  const [loading,   setLoading]   = useState(true)
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState('')
  const [autoFound, setAutoFound] = useState<boolean | null>(null)
  const [dragIdx,   setDragIdx]   = useState<number | null>(null)

  const boxRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const urlRef = useRef<string>('')

  // ── carga + detección automática ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    loadImage(file)
      .then(image => {
        if (cancelled) return
        urlRef.current = image.src
        setImg(image)
        let detected: Quad | null = null
        try { detected = detectDocumentQuad(image) } catch { detected = null }
        setQuad(detected ?? FULL_QUAD)
        setAutoFound(!!detected)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError('No se pudo abrir la imagen para editarla.')
        setLoading(false)
      })
    return () => {
      cancelled = true
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [file])

  // ── espacio disponible para el lienzo (la imagen debe caber completa) ─────
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const measure = () => setArea({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading])

  // ── arrastre de esquinas ──────────────────────────────────────────────────
  const moveCorner = useCallback((idx: number, clientX: number, clientY: number) => {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return
    const x = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    const y = Math.min(1, Math.max(0, (clientY - box.top)  / box.height))
    setQuad(prev => {
      const next = [...prev] as Quad
      next[idx] = { x, y }
      return next
    })
  }, [])

  useEffect(() => {
    if (dragIdx === null) return
    const onMove = (e: PointerEvent) => { e.preventDefault(); moveCorner(dragIdx, e.clientX, e.clientY) }
    const onUp   = () => setDragIdx(null)
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragIdx, moveCorner])

  // ── acciones ──────────────────────────────────────────────────────────────
  function redetect() {
    if (!img) return
    let detected: Quad | null = null
    try { detected = detectDocumentQuad(img) } catch { detected = null }
    setQuad(detected ?? FULL_QUAD)
    setAutoFound(!!detected)
  }

  async function handleCrop() {
    if (!img) return
    setBusy(true); setError('')
    try {
      const cropped = await cropFileToJpeg(file, img, quad, { rotation })
      onConfirm(cropped)
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo recortar la imagen.')
      setBusy(false)
    }
  }

  const pct = (p: Pt) => ({ left: `${p.x * 100}%`, top: `${p.y * 100}%` })
  // Tamaño en píxeles que respeta ancho y alto disponibles, sin deformar la foto.
  const MAX_W = 768
  const fit = img && area.w > 0 && area.h > 0
    ? (() => {
        const scale = Math.min(Math.min(area.w, MAX_W) / img.naturalWidth, area.h / img.naturalHeight)
        return { width: Math.floor(img.naturalWidth * scale), height: Math.floor(img.naturalHeight * scale) }
      })()
    : null
  const polygon = quad.map(p => `${p.x * 100}% ${p.y * 100}%`).join(', ')

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950">
      {/* Barra superior */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gray-900 shrink-0">
        <div className="min-w-0">
          <p className="text-sm text-gray-200 truncate">{title ?? file.name}</p>
          <p className="text-xs text-gray-500">
            {loading
              ? 'Abriendo imagen…'
              : autoFound === false
                ? 'No detecté los bordes — ajusta las esquinas a mano'
                : 'Arrastra las esquinas para ajustar el recorte'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(file)}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-sm bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-50"
            title="Subir la foto tal como está, sin recortar"
          >
            Subir sin recortar
          </button>
          <button
            type="button"
            onClick={handleCrop}
            disabled={busy || loading || !img}
            className="px-3 py-1.5 rounded-lg text-sm bg-emerald-500 text-white hover:bg-emerald-600 font-medium flex items-center gap-1.5 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {busy ? 'Procesando…' : 'Recortar y subir'}
          </button>
        </div>
      </div>

      {/* Herramientas */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-900/70 border-t border-gray-800 shrink-0">
        <button
          type="button" onClick={redetect} disabled={!img || busy}
          className="px-2.5 py-1 rounded-md text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 flex items-center gap-1.5 disabled:opacity-40"
        >
          <Wand2 size={13} /> Detectar bordes
        </button>
        <button
          type="button" onClick={() => setQuad(FULL_QUAD)} disabled={!img || busy}
          className="px-2.5 py-1 rounded-md text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 flex items-center gap-1.5 disabled:opacity-40"
        >
          <Maximize2 size={13} /> Foto completa
        </button>
        <button
          type="button"
          onClick={() => setRotation(r => ((r + 90) % 360) as 0 | 90 | 180 | 270)}
          disabled={!img || busy}
          className="px-2.5 py-1 rounded-md text-xs bg-gray-800 text-gray-300 hover:bg-gray-700 flex items-center gap-1.5 disabled:opacity-40"
        >
          <RotateCw size={13} /> Rotar {rotation !== 0 && <span className="text-gray-500">({rotation}°)</span>}
        </button>
        {error && <span className="text-xs text-red-400 ml-2 truncate">{error}</span>}
      </div>

      {/* Lienzo */}
      <div className="flex-1 min-h-0 p-4 sm:p-6">
       <div ref={areaRef} className="w-full h-full flex items-center justify-center">
        {loading && <Loader2 size={28} className="animate-spin text-gray-400" />}

        {!loading && img && (
          <div
            ref={boxRef}
            className="relative select-none touch-none shrink-0"
            style={fit ?? { width: 0, height: 0 }}
          >
            <img
              src={img.src}
              alt="documento"
              draggable={false}
              className="absolute inset-0 w-full h-full object-fill rounded shadow-2xl pointer-events-none"
            />

            {/* Zona descartada, atenuada */}
            <div
              className="absolute inset-0 bg-black/55 pointer-events-none rounded"
              style={{
                clipPath: `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${polygon}, 0% 0%)`,
              }}
            />

            {/* Contorno */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 100 100" preserveAspectRatio="none"
            >
              <polygon
                points={quad.map(p => `${p.x * 100},${p.y * 100}`).join(' ')}
                fill="none" stroke="#34d399" strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </svg>

            {/* Manijas */}
            {quad.map((p, i) => (
              <button
                key={i}
                type="button"
                aria-label={CORNER_LABELS[i]}
                onPointerDown={e => { e.preventDefault(); setDragIdx(i) }}
                className={
                  'absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ' +
                  'bg-emerald-500 shadow-lg cursor-grab active:cursor-grabbing touch-none ' +
                  (dragIdx === i ? 'w-8 h-8 ring-4 ring-emerald-300/40' : 'w-6 h-6')
                }
                style={pct(p)}
              />
            ))}
          </div>
        )}

        {!loading && !img && (
          <div className="text-center text-gray-300">
            <X size={28} className="mx-auto mb-2 text-red-400" />
            <p className="text-sm mb-4">{error || 'No se pudo abrir la imagen.'}</p>
            <button
              type="button"
              onClick={() => onConfirm(file)}
              className="px-3 py-1.5 rounded-lg text-sm bg-emerald-500 text-white hover:bg-emerald-600"
            >
              Subir el archivo original
            </button>
          </div>
        )}
       </div>
      </div>
    </div>
  )
}
