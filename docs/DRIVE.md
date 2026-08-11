# Activar la sincronización con Google Drive

> Para ver de un vistazo cómo encaja todo (los tres flujos de autorización, qué dato vive
> dónde y cómo funciona la fusión), abre [drive-esquema.html](drive-esquema.html) en el
> navegador.

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

### Los borrados también viajan

Borrar por las buenas no bastaba: el otro dispositivo aún tenía la sesión y la siguiente
fusión la revivía. Ahora cada borrado deja una **lápida** (`{id: cuándo}`) que se sube con
el respaldo y dice "esto ya no existe". La regla de desempate es que si la entrada se editó
**después** de la lápida, gana la edición, así que volver a crear algo nunca queda
enterrado por un borrado viejo.

**Las lápidas caducan a los 180 días, tus datos nunca.** Una lápida solo sirve para avisar
a los otros dispositivos, y cumple ese trabajo la primera vez que cada uno sincroniza;
después es peso muerto que viaja dentro de *cada* subida. Sin límite, años de uso
acumularían miles de avisos sobre sesiones que ya no le importan a nadie. El único caso que
el plazo no cubre es un dispositivo que pase **más de 6 meses sin abrirse**: entonces esa
sesión reaparece y hay que borrarla otra vez. No se pierde nada, en el peor caso sobra algo.

### Cuándo sincroniza

- Al **abrir la app** y cada vez que **vuelves a ella** (cambiar de pestaña, desbloquear el
  móvil), con un margen de 90 segundos para no repetir sin motivo.
- **Mientras entrenas**, unos dos minutos después del último cambio, para que cerrar el
  navegador a media rutina no se lleve las series por delante.
- Al **terminar** un entrenamiento y al pulsar **Sincronizar**.

Lo que tiene significado sube **al instante**: terminar un entrenamiento, borrar una sesión,
guardar o borrar una plantilla, guardar o borrar cardio. Los dos minutos son solo para el
goteo de teclas mientras anotas series, y son a propósito: una serie no se escribe de un
golpe (peso, repeticiones, correcciones), así que subir en cada cambio serían decenas de
subidas por entrenamiento — batería y datos gastados en subir lo mismo veinte veces, y con
riesgo de chocar con el límite de peticiones de Google. Guardar **en el dispositivo** sí es
instantáneo desde siempre: el borrador sobrevive a recargas y cierres. Los dos minutos solo
afectan a la copia en Drive, que cubre el caso raro de que el aparato muera y no se vuelva
a encender.

Ninguna de las automáticas abre nunca una ventana de Google: si el permiso no se puede
renovar en silencio, la subida se deja para la próxima vez.

## Conexión permanente (worker de Cloudflare)

Sin servidor, Google no entrega *refresh tokens* y el permiso dura ~1 hora. El worker de
[worker/drive-auth.js](../worker/drive-auth.js) arregla eso: custodia el *client secret* y
renueva los tokens, así que **se inicia sesión una sola vez por dispositivo**. No guarda
datos de nadie (el refresh token vive en cada dispositivo), soporta cualquier cantidad de
usuarios y la capa gratuita de Cloudflare sobra.

Pasos (una sola vez, ~10 minutos):

1. Crea una cuenta gratis en **https://dash.cloudflare.com**.
2. Menú **Compute → Create** (el panel nuevo de Cloudflare; antes era *Workers & Pages*) →
   plantilla **Hello World** → nómbralo `loadout-auth` → *Deploy*.
3. Botón **Edit code** → borra el código de ejemplo, pega el contenido completo de
   `worker/drive-auth.js` → *Deploy*. Ojo: guardar en el editor **no** basta, sin pulsar
   *Deploy* la URL pública sigue sirviendo el "Hello World".
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

## Cuando el respaldo se cae, la app lo dice

El fallo peligroso no es que Drive dé error: es que **deje de subir y nadie se entere**.
Pasó de verdad — un teléfono se pasó meses guardando solo en local porque el permiso no
se pudo renovar, y al desinstalar la app se perdió todo menos la primera sesión. El chip
del header no alcanzaba: en móvil se reduce a un punto de 8 px.

Ahora el aviso escala con los días sin **respaldo real** (una subida a Drive que funcionó,
o una exportación a archivo; lo marca `markBackupDone()`):

| Sin respaldo | Qué ve |
|---|---|
| 3 días | Banner permanente bajo la cabecera. Al tocarlo, reconecta. |
| 7 días o nunca | Además, un diálogo **al terminar** el entrenamiento, como mucho una vez al día. |

El diálogo aparece al final de la sesión a propósito: cortar a media serie para hablar de
copias de seguridad es la forma más rápida de que se ignore para siempre. Y su botón
*Conectar ahora* nace de un toque real, así que Google permite abrir el popup.

Además, la sincronización automática ya no se rinde en silencio: si no puede renovar el
permiso, deja el chip en rojo (`drive.needsReconnect`) en vez de no hacer nada.

## Limitaciones honestas

- Sin el worker, el permiso dura **~1 hora** por sesión (con el worker configurado esta
  limitación desaparece: ver la sección de conexión permanente). Al reabrir la app, si ya autorizaste antes en ese
  dispositivo, se **reconecta sola sin popup** (mientras tu sesión de Google siga activa); el
  chip del header lo refleja. Solo si esa reconexión silenciosa falla hay que tocar el chip.
- **No es en vivo.** La fusión ocurre en los momentos listados arriba, no de forma continua:
  si entrenas en dos aparatos *a la vez*, cada uno verá lo del otro en la siguiente
  sincronización, no al instante.
- El entrenamiento en curso **solo se adopta si aquí no hay nada a medias**. Es deliberado:
  la sincronización nunca pisa series que estés anotando en este momento.
- El Client ID queda visible en el código. Es normal y no es un secreto: los clientes OAuth
  de aplicaciones web son públicos por diseño, y los orígenes autorizados impiden que
  alguien lo use desde otro sitio.
