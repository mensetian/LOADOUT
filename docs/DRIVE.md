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

- **Conectar** — pide el permiso a Google y luego sincroniza.
- **Sincronizar** — baja lo que hay en Drive, lo **fusiona** con lo de este dispositivo y
  sube la unión. Nunca pierde una sesión. Se hace **solo** al terminar cada entrenamiento.
- **Forzar restaurar** — escotilla de emergencia: descarta lo local y deja lo de Drive. Solo
  para cuando este dispositivo tiene datos erróneos que no quieres propagar.

### La fusión evita el problema del "último gana"

Cada sesión tiene un identificador único. Al sincronizar, los dos historiales se **unen por
ese id**: lo que está en un lado y no en el otro se conserva, y si la misma sesión fue
editada en ambos, gana la versión editada más tarde.

Consecuencia práctica: **puedes entrenar en el móvil y en el PC sin miedo**. La próxima
sincronización de cada uno recoge lo del otro. Ya no hace falta "restaurar antes de
entrenar".

Dos matices honestos:

- **No propaga borrados.** Si borras una sesión en un dispositivo pero sigue en Drive, la
  siguiente fusión la revive. Para eliminarla de verdad, bórrala y luego usa
  **Forzar restaurar** en el otro dispositivo, o bórrala en ambos.
- **No es tiempo real.** La unión ocurre al sincronizar (al terminar sesión o al pulsar el
  botón), no continuamente.

## Conexión permanente (worker de Cloudflare)

Sin servidor, Google no entrega *refresh tokens* y el permiso dura ~1 hora. El worker de
[worker/drive-auth.js](../worker/drive-auth.js) arregla eso: custodia el *client secret* y
renueva los tokens, así que **se inicia sesión una sola vez por dispositivo**. No guarda
datos de nadie (el refresh token vive en cada dispositivo), soporta cualquier cantidad de
usuarios y la capa gratuita de Cloudflare sobra.

Pasos (una sola vez, ~10 minutos):

1. Crea una cuenta gratis en **https://dash.cloudflare.com**.
2. Menú **Workers & Pages → Create → Create Worker** → nómbralo `loadout-auth` → *Deploy*.
3. Botón **Edit code** → borra el código de ejemplo, pega el contenido completo de
   `worker/drive-auth.js` → *Deploy*.
4. Consigue el **client secret**: Google Cloud Console → **APIs y servicios → Credenciales**
   → clic en tu ID de cliente OAuth → copia el **Secreto del cliente** (`GOCSPX-...`).
5. En el worker: **Settings → Variables and Secrets → Add**:
   - `GOOGLE_CLIENT_ID` (tipo *Text*): el mismo Client ID de `config.js`.
   - `GOOGLE_CLIENT_SECRET` (tipo **Secret**): el secreto del paso 4.
   Guarda y vuelve a *Deploy* si lo pide.
6. Copia la URL del worker (`https://loadout-auth.<tu-subdominio>.workers.dev`) y pégala en
   `src/js/config.js`:
   ```js
   const DRIVE_AUTH_URL = 'https://loadout-auth.tuusuario.workers.dev';
   ```
7. Commit y push. Requisito ya cumplido si la app está **publicada** en Google Console
   (en modo *Testing* los refresh tokens caducan a los 7 días).

Si `DRIVE_AUTH_URL` queda vacío, la app usa el flujo antiguo (~1 hora por sesión).

## Si algo falla

**`Error 403: access_denied` — "has not completed the Google verification process"**
El proyecto está en modo *Testing* y la cuenta con la que entras no es un tester aprobado.
Ve a https://console.cloud.google.com/auth/audience y o bien **PUBLICAR APLICACIÓN**, o bien
añade ese correo en **Usuarios de prueba**. Cuidado: tiene que ser **la misma cuenta** que
usa el popup de Google; si el navegador está logueado con otra (la del trabajo, por ejemplo),
añadir la personal no sirve.

**Con el worker configurado, la sesión sigue caducando a la hora**
No llegó el *refresh token*. Google solo lo entrega en el primer consentimiento de cada
cuenta, por eso la app pide `prompt: 'consent'`. Si aun así falla, revoca el acceso en
**https://myaccount.google.com/permissions** (busca LOADOUT → *Quitar acceso*) y vuelve a
conectar: será un consentimiento nuevo. En la consola del navegador aparece el aviso
"Drive: sin refresh token".

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

- Sin el worker, el permiso dura **~1 hora** por sesión (con el worker configurado esta
  limitación desaparece: ver la sección de conexión permanente). Al reabrir la app, si ya autorizaste antes en ese
  dispositivo, se **reconecta sola sin popup** (mientras tu sesión de Google siga activa); el
  chip del header lo refleja. Solo si esa reconexión silenciosa falla hay que tocar el chip.
- El respaldo se sube **al terminar una sesión**, no en cada tecla. Si cierras el navegador a
  media sesión, esos datos aún no están en Drive.
- **No es en vivo.** La fusión ocurre al sincronizar, no de forma continua. Y no propaga
  borrados (ver la sección de fusión arriba).
- El Client ID queda visible en el código. Es normal y no es un secreto: los clientes OAuth
  de aplicaciones web son públicos por diseño, y los orígenes autorizados impiden que
  alguien lo use desde otro sitio.
