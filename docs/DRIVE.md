# Activar la sincronización con Google Drive

La app es estática (no hay servidor), así que el navegador habla directo con Google.
Para eso Google necesita saber que **tu** app existe: eso es el *Client ID*.

Mientras `GOOGLE_CLIENT_ID` esté vacío en `src/js/config.js`, la app funciona igual y la
tarjeta de Drive no aparece. Nada se rompe si nunca haces esto.

## Qué permisos pide

Solo `drive.file`: la app **únicamente puede ver y modificar los archivos que ella misma
crea**. No puede leer el resto de tu Drive. El respaldo queda como un archivo normal
llamado `loadout-respaldo.json`, que puedes abrir o descargar tú mismo.

## Pasos (una sola vez, ~10 minutos)

1. Entra a **https://console.cloud.google.com/** con tu cuenta de Google.
2. Arriba a la izquierda, **crear proyecto** → nómbralo `LOADOUT` → *Crear*.
3. Menú **APIs y servicios → Biblioteca** → busca **Google Drive API** → *Habilitar*.
4. Configura quién puede entrar. Google renombró esta sección a **Google Auth Platform**;
   la ruta directa es **https://console.cloud.google.com/auth/audience**
   (o menú *APIs y servicios → Pantalla de consentimiento de OAuth*).
   - Tipo de usuario / *Audience*: **Externo**.
   - Nombre de la app: `LOADOUT`. Correo de asistencia y de contacto: el tuyo.
   - Y ahora **elige una de las dos**:
     - **Publicar** (recomendado): botón **PUBLICAR APLICACIÓN**. Con el permiso
       `drive.file`, que Google clasifica como *no sensible*, publicar **no exige pasar
       por verificación**: es inmediato y te evita el error 403 para siempre.
     - **Dejarlo en pruebas:** entonces baja a **Usuarios de prueba** → *+ Add users* y
       añade el correo de Google exacto con el que vas a iniciar sesión. Si no lo haces,
       Google responde `Error 403: access_denied`.
5. Menú **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo de aplicación: **Aplicación web**.
   - En **Orígenes autorizados de JavaScript**, añade exactamente:
     ```
     https://mensetian.github.io
     ```
     Y si quieres probar en tu PC, añade también `http://localhost:8000`.
   - *Crear* → copia el **Client ID** (termina en `.apps.googleusercontent.com`).
6. Pega ese valor en `src/js/config.js`:
   ```js
   const GOOGLE_CLIENT_ID = '1234567890-abcdefg.apps.googleusercontent.com';
   ```
7. `git add -A && git commit -m "Activa Drive" && git push origin master`

Al recargar la app, en la pestaña **LOG** aparecerá la tarjeta **GOOGLE DRIVE**.

## Cómo se usa

- **Conectar** — pide el permiso a Google y **compara** lo que hay en Drive con lo que hay
  en este dispositivo. Si Drive tiene más sesiones, te ofrece traerlas.
- **Guardar** — sube el respaldo. Además se sube solo al terminar cada sesión (ver la regla
  de abajo).
- **Restaurar** — baja el respaldo y reemplaza los datos locales. Antes guarda una copia
  local, así que se puede deshacer.

### Estrenar un dispositivo nuevo: restaura ANTES de entrenar

Al instalar la app en un móvil nuevo, su historial está vacío. Si entrenaras sin traer los
datos primero, el respaldo de Drive acabaría sustituido por ese historial casi vacío.

Para evitarlo, un dispositivo **solo sube automáticamente si está al día con Drive**. Se
considera al día cuando ocurre una de estas tres cosas:

1. Has **restaurado** desde Drive en él.
2. Has pulsado **Guardar** a mano (un gesto deliberado: declaras que este dispositivo manda).
3. Al **conectar**, Drive no tenía más sesiones que este dispositivo.

Mientras no se cumpla ninguna, el guardado automático queda en pausa y la tarjeta lo avisa.
Es una red de seguridad, no un sustituto del orden: **el hábito correcto es Restaurar nada
más instalar**.

## Si algo falla

**`Error 403: access_denied` — "has not completed the Google verification process"**
El proyecto está en modo *Testing* y la cuenta con la que entras no es un tester aprobado.
Ve a https://console.cloud.google.com/auth/audience y o bien **PUBLICAR APLICACIÓN**, o bien
añade ese correo en **Usuarios de prueba**. Cuidado: tiene que ser **la misma cuenta** que
usa el popup de Google; si el navegador está logueado con otra (la del trabajo, por ejemplo),
añadir la personal no sirve.

**`Error 400: redirect_uri_mismatch` o "origin not allowed"**
El origen no coincide. En *Credenciales → tu ID de cliente → Orígenes autorizados de
JavaScript* debe estar `https://mensetian.github.io` **sin** barra final y **sin** la ruta
`/LOADOUT`. Los cambios tardan unos minutos en propagarse.

**La tarjeta de Drive no aparece en la pestaña LOG**
`GOOGLE_CLIENT_ID` sigue vacío en `src/js/config.js`, o el navegador está sirviendo la
versión cacheada: cierra y reabre la PWA.

**"Google aún no ha cargado"**
No hubo conexión al abrir la app y la librería de Google no se descargó. Recarga con datos.

## Limitaciones honestas

- El permiso dura **~1 hora**. Sin servidor no hay forma de renovarlo en segundo plano, así
  que cada tanto habrá que pulsar *Conectar* otra vez (suele ser un clic).
- El respaldo se sube **al terminar una sesión**, no en cada tecla. Si cierras el navegador a
  media sesión, esos datos aún no están en Drive.
- Es respaldo, **no sincronización en vivo**. La comparación al conectar evita el accidente
  típico (un dispositivo nuevo pisando el historial), pero no fusiona nada: si entrenas en el
  móvil y en el PC sin restaurar entre medias, el último *Guardar* se impone y las sesiones
  del otro se pierden. Restaura al empezar en un dispositivo y no habrá conflicto.
- El Client ID queda visible en el código. Es normal y no es un secreto: los clientes OAuth
  de aplicaciones web son públicos por diseño, y los orígenes autorizados impiden que
  alguien lo use desde otro sitio.
