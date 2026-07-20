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
4. Menú **APIs y servicios → Pantalla de consentimiento de OAuth**:
   - Tipo de usuario: **Externo** → *Crear*.
   - Nombre de la app: `LOADOUT`. Correo de asistencia y de contacto: el tuyo.
   - En **Usuarios de prueba**, añade tu propio correo de Gmail.
   - Guardar. *(No hace falta enviar nada a verificación: con el permiso `drive.file` y
     tu cuenta como usuario de prueba es suficiente.)*
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

- **Conectar** — abre el permiso de Google. Una vez al día, más o menos.
- **Guardar** — sube el respaldo. Además se sube **solo** cada vez que terminas una sesión,
  siempre que ya estés conectado en esa sesión del navegador.
- **Restaurar** — baja el respaldo (en un teléfono nuevo, por ejemplo). Antes de reemplazar
  nada guarda una copia local por si acaso.

## Limitaciones honestas

- El permiso dura **~1 hora**. Sin servidor no hay forma de renovarlo en segundo plano, así
  que cada tanto habrá que pulsar *Conectar* otra vez (suele ser un clic).
- El respaldo se sube **al terminar una sesión**, no en cada tecla. Si cierras el navegador a
  media sesión, esos datos aún no están en Drive.
- Es respaldo, **no sincronización en vivo**: si registras en dos dispositivos a la vez, el
  último *Guardar* pisa al anterior.
- El Client ID queda visible en el código. Es normal y no es un secreto: los clientes OAuth
  de aplicaciones web son públicos por diseño, y los orígenes autorizados impiden que
  alguien lo use desde otro sitio.
