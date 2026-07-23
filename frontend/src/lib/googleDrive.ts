// ============================================================
// VUMI — Google Drive upload helper
// Uses Google Identity Services (GIS) token flow
// ============================================================

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string
const FOLDER_ID = import.meta.env.VITE_DRIVE_FOLDER_ID  as string
const SCOPE     = 'https://www.googleapis.com/auth/drive'

// Ruta local (Windows) donde Google Drive for Desktop sincroniza la carpeta "Vumi"
const LOCAL_FOLDER = (import.meta.env.VITE_LOCAL_DRIVE_FOLDER as string | undefined)?.trim()

// ── Minimal GIS type declarations ──────────────────────────
interface GisTokenResponse {
  access_token: string
  expires_in: string
  error?: string
}

interface GisTokenClient {
  callback: (r: GisTokenResponse) => void
  requestAccessToken(opts?: { prompt?: string }): void
}

interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(cfg: {
        client_id: string
        scope: string
        callback: (r: GisTokenResponse) => void
      }): GisTokenClient
    }
  }
}

declare global {
  interface Window { google?: Gis }
}

// ── State ───────────────────────────────────────────────────
let tokenClient: GisTokenClient | null = null
let accessToken: string | null         = null
let tokenExpiry: number                = 0
// Folder IDs resueltos en runtime
let resolvedVumiFolderId: string | null = null
let resolvedDocsFolderId: string | null = null

// ── Wait for GIS script to load ─────────────────────────────
function waitForGIS(): Promise<void> {
  return new Promise((resolve) => {
    if (window.google?.accounts?.oauth2) { resolve(); return }
    const iv = setInterval(() => {
      if (window.google?.accounts?.oauth2) { clearInterval(iv); resolve() }
    }, 100)
    // Timeout after 10s
    setTimeout(() => { clearInterval(iv); resolve() }, 10_000)
  })
}

// ── Init token client once ──────────────────────────────────
async function getTokenClient(): Promise<GisTokenClient | null> {
  await waitForGIS()
  if (!window.google?.accounts?.oauth2) return null
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: () => {}, // overridden per request
    })
  }
  return tokenClient
}

// ── Get valid access token — shows popup on first use ───────
export async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry - 60_000) return accessToken

  const client = await getTokenClient()
  if (!client) throw new Error('Google Identity Services no está disponible')

  return new Promise((resolve, reject) => {
    client.callback = (response: GisTokenResponse) => {
      if (response.error) { reject(new Error(response.error)); return }
      accessToken = response.access_token
      tokenExpiry = Date.now() + Number(response.expires_in) * 1000
      resolve(accessToken)
    }
    // prompt='consent' the first time; '' to reuse silently after
    client.requestAccessToken({ prompt: accessToken ? '' : 'consent' })
  })
}

// ── Obtener (o crear) la carpeta "Vumi" en Drive ─────────────
async function getOrCreateVumiFolder(token: string): Promise<string> {
  // 1. Chequear si el folder configurado existe
  if (FOLDER_ID) {
    const check = await fetch(
      `https://www.googleapis.com/drive/v3/files/${FOLDER_ID}?fields=id,name,trashed`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (check.ok) {
      const f = await check.json() as { id: string; name: string; trashed: boolean }
      if (!f.trashed) {
        console.log(`[Drive] Usando carpeta configurada: "${f.name}" (${f.id})`)
        return f.id
      }
    }
  }

  // 2. Buscar carpeta "Vumi" existente en Mi unidad
  const q = encodeURIComponent("name='Vumi' and mimeType='application/vnd.google-apps.folder' and trashed=false")
  const search = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (search.ok) {
    const { files } = await search.json() as { files: { id: string; name: string }[] }
    if (files.length > 0) {
      console.log(`[Drive] Carpeta "Vumi" encontrada: ${files[0].id}`)
      return files[0].id
    }
  }

  // 3. Crear carpeta "Vumi" nueva
  const create = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Vumi', mimeType: 'application/vnd.google-apps.folder' }),
  })
  const folder = await create.json() as { id: string; name: string }
  console.log(`[Drive] Carpeta "Vumi" creada: ${folder.id}`)
  return folder.id
}

// ── Obtener (o crear) subcarpeta "Docs" dentro de "Vumi" ────
async function getOrCreateDocsFolder(token: string, vumiId: string): Promise<string> {
  // 1. Buscar carpeta "Docs" dentro de Vumi
  const q = encodeURIComponent(
    `name='Docs' and mimeType='application/vnd.google-apps.folder' and '${vumiId}' in parents and trashed=false`
  )
  const search = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (search.ok) {
    const { files } = await search.json() as { files: { id: string; name: string }[] }
    if (files.length > 0) {
      console.log(`[Drive] Subcarpeta "Docs" encontrada: ${files[0].id}`)
      return files[0].id
    }
  }

  // 2. Crear subcarpeta "Docs" dentro de Vumi
  const create = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Docs',
      mimeType: 'application/vnd.google-apps.folder',
      parents: [vumiId],
    }),
  })
  const folder = await create.json() as { id: string; name: string }
  console.log(`[Drive] Subcarpeta "Docs" creada dentro de Vumi: ${folder.id}`)
  return folder.id
}

// ── Upload file to Drive folder ─────────────────────────────
// subfolder: si se indica, sube a esa subcarpeta dentro de "Vumi" (ej: 'Docs')
export async function uploadToDrive(file: File, subfolder?: string): Promise<string> {
  const token = await getAccessToken()

  // Resolver carpeta "Vumi"
  if (!resolvedVumiFolderId) {
    resolvedVumiFolderId = await getOrCreateVumiFolder(token)
  }

  // Resolver carpeta destino final
  let targetFolderId = resolvedVumiFolderId
  if (subfolder === 'Docs') {
    if (!resolvedDocsFolderId) {
      resolvedDocsFolderId = await getOrCreateDocsFolder(token, resolvedVumiFolderId)
    }
    targetFolderId = resolvedDocsFolderId
  }

  // 1. Subir el archivo
  const metadata = { name: file.name, parents: [targetFolderId] }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', file)

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Drive upload failed: ${(err as any)?.error?.message ?? res.statusText}`)
  }

  const data = await res.json() as { id: string; webViewLink: string }

  // 2. Hacer el archivo público (cualquiera con el link puede ver)
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${data.id}/permissions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'anyone', role: 'reader' }),
    }
  )

  return data.webViewLink
}

// ── Delete file from Drive by its webViewLink ────────────────
export async function deleteFromDrive(driveLink: string): Promise<void> {
  const fileId = driveLink.match(/\/d\/([^/]+)\//)?.[1]
  if (!fileId) return
  const token = await getAccessToken()
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ── Rename file in Drive by its webViewLink ──────────────────
export async function renameInDrive(driveLink: string, newName: string): Promise<void> {
  const fileId = driveLink.match(/\/d\/([^/]+)\//)?.[1]
  if (!fileId) return
  const token = await getAccessToken()
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: newName }),
  })
}

// ── Link que abre la carpeta de Drive con el archivo seleccionado ──
// (a diferencia del webViewLink normal, que abre el visor del archivo)
export function driveFolderLink(driveLink: string): string {
  const fileId = driveLink.match(/\/d\/([^/]+)\//)?.[1]
  if (!fileId) return driveLink
  return `https://drive.google.com/open?id=${fileId}`
}

// ── Link file:// al archivo sincronizado localmente por Drive Desktop ──
function toFileUrl(windowsPath: string): string {
  const parts = windowsPath.split(/[\\/]/).filter(Boolean)
  // La primera parte es la letra de unidad (ej. "H:") — no se debe codificar
  // el ":" o el link queda roto (file:///H%3A/...) y Windows no lo reconoce.
  const [drive, ...rest] = parts
  return `file:///${drive}/${rest.map(p => encodeURIComponent(p)).join('/')}`
}

// Ruta local (Windows, sin codificar) del archivo — para copiar al portapapeles.
// Los navegadores bloquean la navegación a links file:// desde una página
// web por seguridad, así que el link solo sirve como referencia; para
// abrir el archivo hay que copiar la ruta y pegarla en el Explorador.
// subfolder: 'Docs' para documentos de biblioteca, sin indicar para docs de caso
export function localFilePath(originalName: string, subfolder?: string): string | null {
  if (!LOCAL_FOLDER) return null
  return subfolder
    ? `${LOCAL_FOLDER}\\${subfolder}\\${originalName}`
    : `${LOCAL_FOLDER}\\${originalName}`
}

// subfolder: 'Docs' para documentos de biblioteca, sin indicar para docs de caso
export function localFileLink(originalName: string, subfolder?: string): string | null {
  const path = localFilePath(originalName, subfolder)
  return path ? toFileUrl(path) : null
}

export function isLocalDriveAvailable(): boolean {
  return !!LOCAL_FOLDER
}

// ── Check feature availability ───────────────────────────────
export function isDriveAvailable(): boolean {
  return !!(CLIENT_ID && FOLDER_ID)
}

// ── Reset cached token (on sign-out) ────────────────────────
export function resetDriveToken() {
  accessToken = null
  tokenExpiry = 0
}
