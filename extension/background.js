// Service worker de Vumi Asistente.
// Recibe el encargo desde Vumi, descarga los documentos (enlaces firmados y
// temporales de Supabase Storage), abre el portal de MetLife y le entrega el
// encargo a metlife.js cuando éste lo pide.

const ORIGENES_VUMI = ['https://vumi-omega.vercel.app', 'http://localhost:5173']
const PORTAL_URL = 'https://portaldeclientes.metlife.cl/PIP/home/productos'
const MAX_BYTES = 8 * 1024 * 1024 // tope por archivo

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function descargar(file) {
  const url = new URL(file.url)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
    throw new Error('Enlace de documento no permitido: ' + url.hostname)
  }
  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`No se pudo descargar ${file.name} (HTTP ${r.status})`)
  const buf = await r.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) throw new Error(`${file.name} supera 8 MB`)
  return { name: file.name, mime: file.mime || r.headers.get('content-type') || 'application/octet-stream', base64: bufferToBase64(buf) }
}

async function prepararEncargo(payload) {
  if (!payload || payload.version !== 1) throw new Error('Encargo con formato desconocido')
  const files = {}
  for (const [rol, file] of Object.entries(payload.files || {})) {
    if (file) files[rol] = await descargar(file)
  }
  const job = { ...payload, files, createdAt: Date.now() }
  const tab = await chrome.tabs.create({ url: PORTAL_URL, active: true })
  await chrome.storage.session.set({ ['job:' + tab.id]: job })
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'prepare') {
    const origen = sender.url ? new URL(sender.url).origin : ''
    if (!ORIGENES_VUMI.includes(origen)) {
      sendResponse({ error: 'Origen no autorizado' })
      return
    }
    prepararEncargo(msg.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ error: String(e?.message || e) }))
    return true
  }

  if (msg?.type === 'getJob' && sender.tab) {
    const key = 'job:' + sender.tab.id
    chrome.storage.session.get(key).then((r) => {
      const job = r[key]
      // Un encargo vale 30 minutos; después se descarta.
      if (job && Date.now() - job.createdAt > 30 * 60 * 1000) {
        chrome.storage.session.remove(key)
        sendResponse({ job: null })
      } else {
        sendResponse({ job: job || null })
      }
    })
    return true
  }

  if (msg?.type === 'jobFinished' && sender.tab) {
    chrome.storage.session.remove('job:' + sender.tab.id).then(() => sendResponse({ ok: true }))
    return true
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove('job:' + tabId)
})
