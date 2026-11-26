// Puente entre la página de Vumi y la extensión.
// Vumi no puede hablar directo con la extensión, así que publica un mensaje
// en la ventana y este script lo reenvía al service worker.

(() => {
  const VERSION = chrome.runtime.getManifest().version

  // Marca visible para que Vumi sepa que la extensión está instalada.
  document.documentElement.dataset.vumiAsistente = VERSION

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.source !== 'vumi-app' || data.type !== 'VUMI_METLIFE_PREPARE') return

    chrome.runtime.sendMessage({ type: 'prepare', payload: data.payload }, (resp) => {
      const error = chrome.runtime.lastError?.message || (resp && resp.error) || null
      window.postMessage({
        source: 'vumi-asistente',
        type: 'VUMI_METLIFE_PREPARE_RESULT',
        requestId: data.requestId,
        ok: !error,
        error,
      }, window.location.origin)
    })
  })
})()
