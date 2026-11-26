# Vumi Asistente (extensión de Chrome)

Prepara en el portal de clientes de MetLife el reembolso de un caso de Vumi.
Se inicia desde el botón **"Preparar en MetLife"** en la sección Complementario
de cada caso.

## Qué hace

1. Vumi le entrega el encargo: tipo de reembolso, beneficiario, previsión,
   monto y enlaces temporales (10 minutos) a la boleta, la liquidación y la
   orden médica, guardadas en Supabase Storage.
2. La extensión descarga esos documentos y abre el portal de MetLife.
3. Si la sesión venció, espera a que el usuario inicie sesión.
4. Entra a Reembolsos, elige la póliza del seguro complementario y completa
   el paso 1 (Datos).
5. En el paso 2 (Documentos) sube cada archivo en su casilla.
6. **Se detiene ahí.** Muestra un resumen arriba a la derecha. Revisar,
   presionar Continuar y Enviar lo hace siempre el usuario.

Si algo no calza (una opción que no encuentra, un campo que cambió de
nombre), se detiene, explica qué pasó y deja seguir a mano.

## Instalación (una vez)

1. Descarga esta carpeta `extension/` en tu computador.
2. En Chrome abre `chrome://extensions`.
3. Activa **Modo de desarrollador** (arriba a la derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta `extension/`.
5. Recarga Vumi. El botón "Preparar en MetLife" ya no pedirá instalarla.

Para actualizarla después de un cambio en el repositorio: reemplaza la carpeta
y pulsa el ícono de recargar en la tarjeta de la extensión.

## Archivos

- `manifest.json` — permisos: solo Vumi, el portal de MetLife y Supabase Storage.
- `vumi-bridge.js` — corre en Vumi; recibe el encargo de la página y lo pasa a la extensión.
- `background.js` — descarga los documentos, abre el portal y guarda el encargo mientras dura (máximo 30 minutos, se borra al terminar o al cerrar la pestaña).
- `metlife.js` — recorre el formulario del portal.

## Datos sensibles

Esta carpeta no contiene claves ni datos personales. Los documentos solo pasan
por la memoria de la extensión durante la preparación y no se guardan en disco.
La extensión nunca escribe la clave de MetLife: el inicio de sesión es del usuario.

## Si deja de funcionar

El portal de MetLife puede cambiar su diseño. Los puntos frágiles están en
`metlife.js`: los identificadores `select-tipo-reembolso`, `select-beneficiario`,
`select-prevision`, `input-monto`, las clases `csp-libs-*` y los textos
"Reembolsos", "Solicitar", "Continuar" y "Documentos obligatorios".
