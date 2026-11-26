// Comunicación con la extensión "Vumi Asistente" (carpeta extension/ del repo).
// La extensión abre el portal de MetLife, completa el paso de datos y sube los
// documentos; se detiene antes de enviar. Vumi solo le entrega el encargo.

export const METLIFE_TIPOS = [
  'Consultas médicas, exámenes y procedimientos',
  'Medicamentos',
  'Ópticas y audífonos',
  'Gastos hospitalarios',
] as const

export type MetlifeTipo = (typeof METLIFE_TIPOS)[number]

export const EXTENSION_INFO_URL =
  'https://github.com/felipehurtadoureta/vumi/tree/main/extension'

export type ArchivoEncargo = { url: string; name: string; mime: string }

export type EncargoMetlife = {
  version: 1
  caseLabel: string
  tipo: MetlifeTipo
  beneficiario: { relationship: string; firstName: string; fullName: string }
  prevision: string
  monto: number
  bonoIncluyeLiquidacion: boolean
  files: { boleta: ArchivoEncargo; liquidacion?: ArchivoEncargo; orden?: ArchivoEncargo }
}

/** La extensión marca el documento al cargar la página. */
export function extensionInstalada(): boolean {
  return !!document.documentElement.dataset.vumiAsistente
}

/**
 * Entrega el encargo a la extensión y espera su confirmación (descarga los
 * documentos y abre la pestaña de MetLife). Rechaza con un mensaje en español.
 */
export function prepararEnMetlife(encargo: EncargoMetlife): Promise<void> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMsg)
      reject(new Error('La extensión no respondió. Revisa que "Vumi Asistente" esté activa en Chrome.'))
    }, 60_000)

    function onMsg(event: MessageEvent) {
      if (event.source !== window) return
      const d = event.data
      if (!d || d.source !== 'vumi-asistente' || d.requestId !== requestId) return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMsg)
      if (d.ok) resolve()
      else reject(new Error(d.error || 'La extensión no pudo preparar el reembolso.'))
    }

    window.addEventListener('message', onMsg)
    window.postMessage(
      { source: 'vumi-app', type: 'VUMI_METLIFE_PREPARE', requestId, payload: encargo },
      window.location.origin,
    )
  })
}
