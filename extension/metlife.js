// Vumi Asistente — script del portal de clientes de MetLife.
//
// Corre en todos los marcos del portal. Si la pestaña tiene un encargo de
// Vumi, recorre el flujo de reembolso:
//   inicio → "Reembolsos" → póliza → paso 1 (datos) → paso 2 (documentos)
// y se DETIENE en el paso 2, con los documentos cargados. Avanzar y enviar
// lo hace siempre el usuario.
//
// La lógica está en crearAsistente(doc, win, job, hooks) y no usa variables
// globales, para poder probarla inyectándola sobre un documento cualquiera.

function crearAsistente(doc, win, job, hooks) {
  const LIMITE_MS = 5 * 60 * 1000 // tiempo máximo esperando, incluido el inicio de sesión
  const inicio = Date.now()
  const intentos = {}
  let terminado = false

  const sleep = (ms) => new Promise((r) => win.setTimeout(r, ms))
  const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  const visible = (el) => !!el && el.getClientRects().length > 0
  const textoDe = (el) => (el?.innerText || el?.textContent || '').trim()

  async function esperar(cond, ms = 8000, paso = 150) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const v = cond()
      if (v) return v
      await sleep(paso)
    }
    return null
  }

  // ── aviso en pantalla ────────────────────────────────────────────────
  function aviso(tipo, titulo, detalle) {
    let box = doc.getElementById('vumi-asistente-aviso')
    if (!box) {
      box = doc.createElement('div')
      box.id = 'vumi-asistente-aviso'
      box.style.cssText = [
        'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647', 'max-width:380px',
        'padding:12px 14px', 'border-radius:10px', 'font:14px/1.4 system-ui,sans-serif',
        'box-shadow:0 6px 24px rgba(0,0,0,.25)', 'color:#111',
      ].join(';')
      doc.body.appendChild(box)
    }
    const colores = { info: '#e0f2fe', ok: '#dcfce7', alerta: '#fef3c7', error: '#fee2e2' }
    box.style.background = colores[tipo] || colores.info
    box.style.border = '1px solid rgba(0,0,0,.12)'
    box.innerHTML = ''
    const h = doc.createElement('div')
    h.style.cssText = 'font-weight:600;margin-bottom:4px;padding-right:18px'
    h.textContent = 'Vumi · ' + titulo
    const p = doc.createElement('div')
    p.style.whiteSpace = 'pre-line'
    p.textContent = detalle || ''
    const x = doc.createElement('button')
    x.textContent = '×'
    x.title = 'Cerrar'
    x.style.cssText = 'position:absolute;top:6px;right:8px;border:0;background:none;font-size:18px;cursor:pointer'
    x.onclick = () => box.remove()
    box.style.position = 'fixed'
    box.append(h, p, x)
  }

  // ── utilidades de interfaz ───────────────────────────────────────────
  function botonPorTexto(texto, raiz = doc) {
    const t = norm(texto)
    return [...raiz.querySelectorAll('button, a, [role=button]')]
      .filter((el) => visible(el) && norm(textoDe(el)) === t)
  }

  // Si el borrador ya tenía documentos, el portal pregunta antes de cambiar
  // los datos ("Vas a realizar cambios en tu solicitud"). Aceptar solo borra
  // los adjuntos del borrador, que se vuelven a subir en el paso siguiente.
  function aceptarAvisoDeCambios() {
    if (!norm(doc.body?.innerText).includes('vas a realizar cambios en tu solicitud')) return false
    const si = botonPorTexto('Sí, cambiar')[0]
    if (si) { si.click(); return true }
    return false
  }

  async function clicContinuar() {
    const btn = await esperar(() => {
      const b = botonPorTexto('Continuar')[0]
      return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null
    }, 10000)
    if (!btn) throw new Error('El botón "Continuar" no se habilitó. Revisa si falta algún dato.')
    btn.click()
  }

  async function elegir(idCampo, coincide, descripcion) {
    const campo = doc.getElementById(idCampo)
    if (!campo) throw new Error(`No encontré el campo "${descripcion}" en el formulario.`)
    const actual = () => textoDe(campo.querySelector('.csp-libs-input-style'))
    if (coincide(actual())) return actual()

    campo.querySelector('.csp-libs-input-sub-container')?.click()
    const items = await esperar(() => {
      const xs = [...campo.querySelectorAll('.csp-libs-select-item')].filter(visible)
      return xs.length ? xs : null
    })
    if (!items) throw new Error(`No se abrió la lista de "${descripcion}".`)

    const candidatos = items.filter((i) => coincide(textoDe(i)))
    if (candidatos.length !== 1) {
      campo.querySelector('.csp-libs-input-sub-container')?.click() // cerrar la lista
      const opciones = items.map(textoDe).join(' / ')
      throw new Error(candidatos.length === 0
        ? `Ninguna opción de "${descripcion}" calza con el caso. Opciones: ${opciones}`
        : `Más de una opción de "${descripcion}" calza con el caso: ${candidatos.map(textoDe).join(' / ')}`)
    }
    candidatos[0].click()
    await sleep(300)
    aceptarAvisoDeCambios()
    const ok = await esperar(() => coincide(actual()), 4000)
    if (!ok) throw new Error(`No quedó seleccionado "${descripcion}".`)
    return actual()
  }

  function coincideBeneficiario(texto) {
    const [nombre = '', parentesco = ''] = texto.split(' - ')
    const rel = norm(job.beneficiario.relationship)
    const par = norm(parentesco)
    if (rel.includes('titular')) return par.includes('titular')
    if (rel.includes('conyuge')) return par.includes('conyuge')
    // hijos: parentesco "Hijo (A)" y mismo primer nombre
    return par.includes('hijo') && norm(nombre).split(' ')[0] === norm(job.beneficiario.firstName)
  }

  function escribirMonto(valor) {
    const input = doc.querySelector('#input-monto input')
    if (!input) throw new Error('No encontré el campo del monto.')
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set
    input.focus()
    setter.call(input, String(valor))
    for (const ev of ['input', 'change']) input.dispatchEvent(new win.Event(ev, { bubbles: true }))
    input.blur()
    input.dispatchEvent(new win.Event('blur', { bubbles: true }))
    const digitos = (input.value || '').replace(/\D/g, '')
    if (digitos !== String(valor)) throw new Error(`El monto quedó como "${input.value}" en vez de ${valor}.`)
  }

  // ── pasos ────────────────────────────────────────────────────────────
  async function pasoDatos() {
    aviso('info', 'Preparando reembolso', `Caso ${job.caseLabel}: completando los datos…`)
    const tipo = await elegir('select-tipo-reembolso', (t) => norm(t) === norm(job.tipo), 'tipo de reembolso')
    const benef = await elegir('select-beneficiario', coincideBeneficiario, 'beneficiario')
    const prev = await elegir('select-prevision', (t) => norm(t).includes(norm(job.prevision)), 'previsión')
    escribirMonto(job.monto)
    await sleep(300)
    await clicContinuar()
    await sleep(600)
    aceptarAvisoDeCambios()
    return { tipo, benef, prev }
  }

  function archivoDesde(f) {
    const bin = win.atob(f.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new win.File([bytes], f.name, { type: f.mime })
  }

  function seccionDe(input) {
    let el = input
    while (el && el.parentElement) {
      el = el.parentElement
      if (el.querySelectorAll('input[type=file]').length > 1) break
      const t = textoDe(el)
      if (t) var ultimo = t
    }
    return norm((ultimo || '').split('\n')[0])
  }

  function archivoParaSeccion(titulo) {
    const f = job.files || {}
    if (/boleta|factura/.test(titulo)) return f.boleta ? ['boleta', f.boleta] : null
    if (/bono|reembolso|liquidaci/.test(titulo)) {
      if (f.liquidacion) return ['liquidación', f.liquidacion]
      if (job.bonoIncluyeLiquidacion && f.boleta) return ['bono', f.boleta]
      return null
    }
    if (/receta|orden|prescrip/.test(titulo)) return f.orden ? ['orden médica', f.orden] : null
    return null
  }

  async function pasoDocumentos(datos) {
    aviso('info', 'Preparando reembolso', `Caso ${job.caseLabel}: subiendo documentos…`)
    const inputs = [...doc.querySelectorAll('input[type=file]')]
    const subidos = [], faltan = []
    for (const input of inputs) {
      const titulo = seccionDe(input)
      const elegido = archivoParaSeccion(titulo)
      if (!elegido) { faltan.push(titulo || 'sección sin nombre'); continue }
      const [rol, f] = elegido
      const dt = new win.DataTransfer()
      dt.items.add(archivoDesde(f))
      input.files = dt.files
      input.dispatchEvent(new win.Event('input', { bubbles: true }))
      input.dispatchEvent(new win.Event('change', { bubbles: true }))
      subidos.push(`${f.name} → ${rol}`)
      await sleep(800)
    }
    const lineas = [
      `Caso ${job.caseLabel}`,
      `Tipo: ${datos.tipo}`,
      `Beneficiario: ${datos.benef}`,
      `Previsión: ${datos.prev} · Monto: $${Number(job.monto).toLocaleString('es-CL')}`,
      '',
      subidos.length ? 'Subidos:\n• ' + subidos.join('\n• ') : 'No se subió ningún documento.',
    ]
    if (faltan.length) lineas.push('', 'Sin documento: ' + faltan.join(', '))
    lineas.push('', 'Revisa todo y luego presiona Continuar y Enviar tú.')
    aviso(faltan.length || !subidos.length ? 'alerta' : 'ok', 'Listo para revisar', lineas.join('\n'))
  }

  // ── detección de la pantalla actual ──────────────────────────────────
  function pantalla() {
    if (visible(doc.getElementById('select-tipo-reembolso'))) return 'datos'
    const texto = norm(doc.body?.innerText)
    if (doc.querySelector('input[type=file]') && texto.includes('documentos obligatorios')) return 'documentos'
    if (texto.includes('inicia la solicitud en una de tus polizas')) return 'polizas'
    if (botonPorTexto('Reembolsos').length) return 'inicio'
    if (win === win.top && /\/login/i.test(win.location.pathname)) return 'login'
    return null
  }

  let datosLlenados = null

  async function correr() {
    while (!terminado && Date.now() - inicio < LIMITE_MS) {
      const p = pantalla()
      try {
        if (aceptarAvisoDeCambios()) {
          await sleep(1000)
          continue
        }
        if (p === 'login') {
          aviso('info', 'Esperando inicio de sesión', 'Inicia sesión en MetLife; después sigo solo.')
        } else if (p === 'inicio' && !intentos.inicio) {
          intentos.inicio = 1
          botonPorTexto('Reembolsos')[0].click()
        } else if (p === 'polizas' && !intentos.polizas) {
          intentos.polizas = 1
          let botones = botonPorTexto('Solicitar')
          if (botones.length > 1) {
            botones = botones.filter((b) => {
              let el = b
              for (let i = 0; i < 6 && el; i++) el = el.parentElement
              return el && norm(textoDe(el)).includes('complementario')
            })
          }
          if (botones.length !== 1) throw new Error('No pude identificar la póliza del seguro complementario.')
          botones[0].click()
        } else if (p === 'datos' && !datosLlenados) {
          intentos.datos = (intentos.datos || 0) + 1
          if (intentos.datos > 2) throw new Error('No logré completar el paso de datos.')
          datosLlenados = await pasoDatos()
        } else if (p === 'documentos') {
          await pasoDocumentos(datosLlenados || { tipo: job.tipo, benef: '(revisar)', prev: job.prevision })
          terminado = true
          hooks.terminar()
          return
        }
      } catch (e) {
        aviso('error', 'Me detuve', `${e.message}\n\nSigue manualmente desde aquí.`)
        terminado = true
        hooks.terminar()
        return
      }
      await sleep(1000)
    }
    if (!terminado && pantalla()) {
      aviso('alerta', 'Tiempo agotado', 'No pude terminar la preparación. Sigue manualmente.')
      hooks.terminar()
    }
  }

  return { correr, pantalla }
}

// ── arranque dentro de la extensión ─────────────────────────────────────
if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
  chrome.runtime.sendMessage({ type: 'getJob' }, (resp) => {
    if (chrome.runtime.lastError || !resp?.job) return
    const asistente = crearAsistente(document, window, resp.job, {
      terminar: () => chrome.runtime.sendMessage({ type: 'jobFinished' }),
    })
    asistente.correr()
  })
}
