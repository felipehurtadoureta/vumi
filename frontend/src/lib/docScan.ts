// ─────────────────────────────────────────────────────────────────────────────
// docScan.ts — Detección de bordes de documentos y corrección de perspectiva.
// Todo ocurre en el navegador; la foto original nunca sale del equipo sin pasar
// por aquí. Sin dependencias externas.
// ─────────────────────────────────────────────────────────────────────────────

export type Pt = { x: number; y: number }
/** Cuadrilátero en coordenadas normalizadas 0..1, en orden: TL, TR, BR, BL */
export type Quad = [Pt, Pt, Pt, Pt]

export const FULL_QUAD: Quad = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
]

/** Carga un File de imagen en un HTMLImageElement ya decodificado. */
export async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    // Copiamos a un elemento independiente para poder revocar la URL sin riesgo
    return img
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

// ── Detección automática ────────────────────────────────────────────────────

/**
 * Busca el papel en la foto: la mancha grande, clara y poco saturada.
 * Devuelve el cuadrilátero normalizado, o null si no encuentra nada confiable.
 */
export function detectDocumentQuad(img: HTMLImageElement): Quad | null {
  const MAX = 360
  const scale = MAX / Math.max(img.naturalWidth, img.naturalHeight)
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))

  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, w, h)

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, w, h).data
  } catch {
    return null // canvas "tainted" — no debería pasar con blobs locales
  }

  const n = w * h
  const mask = new Uint8Array(n)
  const vals = new Uint8Array(n)

  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const sat = mx === 0 ? 0 : (mx - mn) / mx
    vals[i] = mx
    mask[i] = sat < 0.25 && mx > 140 ? 1 : 0
  }

  // Umbral adaptativo: si casi nada pasó el filtro, usamos el brillo relativo
  let count = 0
  for (let i = 0; i < n; i++) count += mask[i]
  if (count < n * 0.10) {
    const sorted = Uint8Array.from(vals).sort()
    const p70 = sorted[Math.floor(n * 0.70)]
    for (let i = 0; i < n; i++) mask[i] = vals[i] >= p70 ? 1 : 0
  }

  // Componente conexa más grande (4-vecinos, BFS iterativo)
  const label = new Int32Array(n).fill(-1)
  let best: number[] | null = null
  const stack = new Int32Array(n)
  for (let start = 0; start < n; start++) {
    if (!mask[start] || label[start] !== -1) continue
    let sp = 0
    stack[sp++] = start
    label[start] = start
    const pixels: number[] = []
    while (sp > 0) {
      const p = stack[--sp]
      pixels.push(p)
      const px = p % w, py = (p / w) | 0
      if (px > 0)     { const q = p - 1; if (mask[q] && label[q] === -1) { label[q] = start; stack[sp++] = q } }
      if (px < w - 1) { const q = p + 1; if (mask[q] && label[q] === -1) { label[q] = start; stack[sp++] = q } }
      if (py > 0)     { const q = p - w; if (mask[q] && label[q] === -1) { label[q] = start; stack[sp++] = q } }
      if (py < h - 1) { const q = p + w; if (mask[q] && label[q] === -1) { label[q] = start; stack[sp++] = q } }
    }
    if (!best || pixels.length > best.length) best = pixels
  }

  if (!best || best.length < n * 0.12) return null

  // Esquinas por extremos de (x+y) y (x-y)
  let sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity
  let tl = 0, br = 0, tr = 0, bl = 0
  for (const p of best) {
    const px = p % w, py = (p / w) | 0
    const s = px + py, d = px - py
    if (s < sMin) { sMin = s; tl = p }
    if (s > sMax) { sMax = s; br = p }
    if (d > dMax) { dMax = d; tr = p }
    if (d < dMin) { dMin = d; bl = p }
  }

  const toPt = (p: number): Pt => ({ x: (p % w) / w, y: ((p / w) | 0) / h })
  let quad: Quad = [toPt(tl), toPt(tr), toPt(br), toPt(bl)]

  // El área del cuadrilátero debe ser razonable respecto de la foto completa
  if (quadArea(quad) < 0.15) return null

  // Un pelo hacia afuera, para no comerse el borde del papel
  quad = expandQuad(quad, 1.005)
  return quad
}

function quadArea(q: Quad): number {
  let a = 0
  for (let i = 0; i < 4; i++) {
    const p = q[i], n = q[(i + 1) % 4]
    a += p.x * n.y - n.x * p.y
  }
  return Math.abs(a) / 2
}

export function expandQuad(q: Quad, factor: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4
  return q.map(p => ({
    x: Math.min(1, Math.max(0, cx + (p.x - cx) * factor)),
    y: Math.min(1, Math.max(0, cy + (p.y - cy) * factor)),
  })) as Quad
}

// ── Corrección de perspectiva ───────────────────────────────────────────────

/** Resuelve un sistema lineal n×n por eliminación gaussiana con pivoteo. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    if (Math.abs(A[piv][col]) < 1e-10) return null
    ;[A[col], A[piv]] = [A[piv], A[col]]
    ;[b[col], b[piv]] = [b[piv], b[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      if (f === 0) continue
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c]
      b[r] -= f * b[col]
    }
  }
  return b.map((v, i) => v / A[i][i])
}

/** Homografía que lleva puntos del destino (u,v) al origen (x,y). */
function homography(dst: Pt[], src: Pt[]): number[] | null {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i]
    const { x, y } = src[i]
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x)
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y)
  }
  return solve(A, b)
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

export type WarpOptions = {
  /** Lado mayor máximo del resultado, en píxeles. Por defecto 1800. */
  maxSide?: number
  /** Rotación en grados, múltiplo de 90. */
  rotation?: 0 | 90 | 180 | 270
  /** Calidad JPEG 0..1. Por defecto 0.9. */
  quality?: number
  /** Realce suave de contraste para papel fotografiado. */
  enhance?: boolean
}

/**
 * Recorta el cuadrilátero indicado y corrige la perspectiva.
 * Devuelve un Blob JPEG.
 */
export async function warpToBlob(
  img: HTMLImageElement,
  quad: Quad,
  opts: WarpOptions = {},
): Promise<Blob> {
  const { maxSide = 1800, rotation = 0, quality = 0.9, enhance = true } = opts

  const iw = img.naturalWidth, ih = img.naturalHeight
  const src: Pt[] = quad.map(p => ({ x: p.x * iw, y: p.y * ih }))

  // Tamaño de salida a partir de los lados del cuadrilátero
  let outW = Math.round(Math.max(dist(src[0], src[1]), dist(src[3], src[2])))
  let outH = Math.round(Math.max(dist(src[0], src[3]), dist(src[1], src[2])))
  outW = Math.max(16, outW); outH = Math.max(16, outH)
  const k = Math.min(1, maxSide / Math.max(outW, outH))
  outW = Math.max(16, Math.round(outW * k))
  outH = Math.max(16, Math.round(outH * k))

  const dstPts: Pt[] = [
    { x: 0, y: 0 }, { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 }, { x: 0, y: outH - 1 },
  ]
  const H = homography(dstPts, src)
  if (!H) throw new Error('No se pudo calcular el recorte (esquinas inválidas).')
  const [a, b2, c, d, e, f, g, h2] = H

  // Imagen origen en un canvas para poder muestrear píxeles
  const sc = document.createElement('canvas')
  sc.width = iw; sc.height = ih
  const sctx = sc.getContext('2d', { willReadFrequently: true })
  if (!sctx) throw new Error('Canvas no disponible')
  sctx.drawImage(img, 0, 0)
  const sdata = sctx.getImageData(0, 0, iw, ih).data

  const oc = document.createElement('canvas')
  oc.width = outW; oc.height = outH
  const octx = oc.getContext('2d')
  if (!octx) throw new Error('Canvas no disponible')
  const out = octx.createImageData(outW, outH)
  const odata = out.data

  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const den = g * u + h2 * v + 1
      const sx = (a * u + b2 * v + c) / den
      const sy = (d * u + e * v + f) / den
      const o = (v * outW + u) * 4

      if (sx < 0 || sy < 0 || sx > iw - 1 || sy > ih - 1) {
        odata[o] = 255; odata[o + 1] = 255; odata[o + 2] = 255; odata[o + 3] = 255
        continue
      }
      // Interpolación bilineal
      const x0 = sx | 0, y0 = sy | 0
      const x1 = Math.min(x0 + 1, iw - 1), y1 = Math.min(y0 + 1, ih - 1)
      const fx = sx - x0, fy = sy - y0
      const i00 = (y0 * iw + x0) * 4, i10 = (y0 * iw + x1) * 4
      const i01 = (y1 * iw + x0) * 4, i11 = (y1 * iw + x1) * 4
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy,       w11 = fx * fy
      for (let ch = 0; ch < 3; ch++) {
        odata[o + ch] =
          sdata[i00 + ch] * w00 + sdata[i10 + ch] * w10 +
          sdata[i01 + ch] * w01 + sdata[i11 + ch] * w11
      }
      odata[o + 3] = 255
    }
  }

  if (enhance) applyLevels(odata)
  octx.putImageData(out, 0, 0)

  // Rotación opcional
  let finalCanvas: HTMLCanvasElement = oc
  if (rotation % 360 !== 0) {
    const rc = document.createElement('canvas')
    const swap = rotation === 90 || rotation === 270
    rc.width  = swap ? outH : outW
    rc.height = swap ? outW : outH
    const rctx = rc.getContext('2d')!
    rctx.translate(rc.width / 2, rc.height / 2)
    rctx.rotate((rotation * Math.PI) / 180)
    rctx.drawImage(oc, -outW / 2, -outH / 2)
    finalCanvas = rc
  }

  return await new Promise<Blob>((resolve, reject) => {
    finalCanvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('No se pudo generar la imagen')),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * Estira el histograma de luminancia para que el papel se vea blanco y la tinta
 * oscura, sin quemar el documento. Conservador a propósito: no binariza.
 */
function applyLevels(data: Uint8ClampedArray) {
  const hist = new Uint32Array(256)
  const n = data.length / 4
  for (let i = 0; i < n; i++) {
    const l = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000
    hist[l | 0]++
  }
  let acc = 0
  const loTarget = n * 0.02, hiTarget = n * 0.985
  let lo = 0, hi = 255
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= loTarget) { lo = i; break } }
  acc = 0
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= hiTarget) { hi = i; break } }
  if (hi - lo < 40) return
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.min(255, Math.max(0, Math.round(((i - lo) * 255) / (hi - lo))))
  }
  for (let i = 0; i < n; i++) {
    data[i * 4]     = lut[data[i * 4]]
    data[i * 4 + 1] = lut[data[i * 4 + 1]]
    data[i * 4 + 2] = lut[data[i * 4 + 2]]
  }
}

/** Conveniencia: File de entrada → File JPEG recortado. */
export async function cropFileToJpeg(
  file: File,
  img: HTMLImageElement,
  quad: Quad,
  opts: WarpOptions = {},
): Promise<File> {
  const blob = await warpToBlob(img, quad, opts)
  const base = file.name.replace(/\.[^.]+$/, '')
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })
}
