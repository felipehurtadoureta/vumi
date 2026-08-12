// Calcula un hash SHA-256 del contenido de un archivo (via Web Crypto API,
// nativo del navegador) para detectar si un documento ya fue subido antes.
export async function hashArrayBuffer(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf.slice(0))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
