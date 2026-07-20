// ---------------------------------------------------------------------------
// Sincronización opcional con Google Drive
//
// Usa el permiso 'drive.file': la app SOLO puede ver y tocar los archivos que
// ella misma crea. No tiene acceso al resto de tu Drive.
//
// Sin servidor no hay refresh token: el permiso dura ~1 hora y después hay que
// volver a autorizar (normalmente es un clic, o silencioso si tu sesión de
// Google sigue activa).
// ---------------------------------------------------------------------------

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILE_KEY = 'loadout-drive-file-id';
const DRIVE_FILE_NAME = 'loadout-respaldo.json';
// Este dispositivo solo puede subir automáticamente cuando se ha puesto al día
// con Drive (restaurando, o guardando a mano a sabiendas). Sin esta marca, un
// móvil recién instalado subiría su historial vacío y pisaría el del PC.
const DRIVE_READY_KEY = 'loadout-drive-ready';
const driveReady = () => localStorage.getItem(DRIVE_READY_KEY) === '1';
const markDriveReady = () => localStorage.setItem(DRIVE_READY_KEY, '1');

let driveToken = null;
let driveTokenClient = null;
let drivePendingAction = null;

const driveEnabled = () => typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.trim().length > 10;

function setDriveStatus(text, kind = '') {
  const el = document.querySelector('#driveStatus');
  if (el) { el.textContent = text; el.className = `drive-status ${kind}`; }
}

// --- Autorización -----------------------------------------------------------
function initDrive() {
  if (!driveEnabled()) return; // sin Client ID la tarjeta permanece oculta
  document.querySelector('#driveCard').hidden = false;
  setDriveStatus('Cargando Google…');

  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  script.onload = () => {
    driveTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: response => {
        if (response.error) return setDriveStatus('No se pudo autorizar.', 'is-warn');
        driveToken = response.access_token;
        setDriveStatus('Conectado a Drive.', 'is-ok');
        const action = drivePendingAction;
        drivePendingAction = null;
        if (action) action();
      },
    });
    setDriveStatus('Sin conectar.');
  };
  script.onerror = () => setDriveStatus('Sin conexión: Drive no disponible ahora.', 'is-warn');
  document.head.append(script);
}

// Ejecuta `action` asegurando que haya un token válido.
function withDriveToken(action) {
  if (!driveTokenClient) return setDriveStatus('Google aún no ha cargado.', 'is-warn');
  if (driveToken) return action();
  drivePendingAction = action;
  driveTokenClient.requestAccessToken();
}

function driveHeaders(extra = {}) {
  return { Authorization: `Bearer ${driveToken}`, ...extra };
}

// Un 401 significa que el token expiró: lo descartamos y reintentamos una vez.
function driveExpired(response, retry) {
  if (response.status !== 401) return false;
  driveToken = null;
  drivePendingAction = retry;
  driveTokenClient.requestAccessToken();
  return true;
}

// --- Guardar ----------------------------------------------------------------
async function driveSave({ silent = false } = {}) {
  const body = JSON.stringify({ app: 'LOADOUT', version: 1, exportedAt: new Date().toISOString(), sessions }, null, 2);
  const fileId = localStorage.getItem(DRIVE_FILE_KEY);
  setDriveStatus('Guardando…');

  try {
    let response;
    if (fileId) {
      response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: driveHeaders({ 'Content-Type': 'application/json' }),
        body,
      });
      if (driveExpired(response, () => driveSave({ silent }))) return;
      // Si el archivo fue borrado del Drive, lo creamos de nuevo.
      if (response.status === 404) { localStorage.removeItem(DRIVE_FILE_KEY); return driveSave({ silent }); }
    } else {
      const boundary = `loadout${Date.now()}`;
      const metadata = { name: DRIVE_FILE_NAME, mimeType: 'application/json' };
      const multipart =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
      response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: driveHeaders({ 'Content-Type': `multipart/related; boundary=${boundary}` }),
        body: multipart,
      });
      if (driveExpired(response, () => driveSave({ silent }))) return;
      const data = await response.json();
      if (data.id) localStorage.setItem(DRIVE_FILE_KEY, data.id);
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setDriveStatus(`Guardado en Drive · ${new Date().toLocaleTimeString('es-CO')}`, 'is-ok');
    markBackupDone();
    if (!silent) await showAlert('Respaldo guardado en tu Google Drive.');
  } catch (error) {
    setDriveStatus(`No se pudo guardar (${error.message}).`, 'is-warn');
    if (!silent) await showAlert('No se pudo guardar en Drive. Revisa tu conexión e inténtalo de nuevo.');
  }
}

// --- Leer lo que hay en Drive ----------------------------------------------
// Devuelve el id del respaldo, o null si este usuario aún no tiene ninguno.
async function findDriveFileId(retry) {
  const cached = localStorage.getItem(DRIVE_FILE_KEY);
  if (cached) return cached;
  const query = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
  const search = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,modifiedTime)&orderBy=${encodeURIComponent('modifiedTime desc')}`,
    { headers: driveHeaders() });
  if (driveExpired(search, retry)) return undefined; // undefined = reintentando tras re-autorizar
  if (!search.ok) throw new Error(`HTTP ${search.status}`);
  const found = await search.json();
  const fileId = found.files?.[0]?.id ?? null;
  if (fileId) localStorage.setItem(DRIVE_FILE_KEY, fileId);
  return fileId;
}

async function readDriveBackup(fileId, retry) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: driveHeaders() });
  if (driveExpired(response, retry)) return undefined;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.sessions) ? payload : null;
}

function applyDriveBackup(payload) {
  snapshot('restaurar desde Drive');
  sessions = payload.sessions;
  save();
  activeSession = makeSession();
  renderActiveSession();
  updateDashboard();
  markDriveReady();
  setDriveStatus(`Restaurado desde Drive · ${payload.sessions.length} sesiones.`, 'is-ok');
}

// --- Restaurar --------------------------------------------------------------
async function driveRestore() {
  setDriveStatus('Buscando respaldo…');
  try {
    const fileId = await findDriveFileId(driveRestore);
    if (fileId === undefined) return;
    if (!fileId) { setDriveStatus('No encontré un respaldo en tu Drive.', 'is-warn'); return; }

    const payload = await readDriveBackup(fileId, driveRestore);
    if (payload === undefined) return;
    if (!payload) { setDriveStatus('El archivo de Drive no es un respaldo válido.', 'is-warn'); return; }

    const ok = await showConfirm(
      `En Drive hay ${payload.sessions.length} sesiones y en este dispositivo tienes ${sessions.length}.\n\n` +
      `Se reemplazarán los datos de este dispositivo por los de Drive.`,
      { danger: true, okText: 'Restaurar' });
    if (!ok) { setDriveStatus('Restauración cancelada.'); return; }

    applyDriveBackup(payload);
    await showAlert('Datos restaurados desde tu Google Drive.');
  } catch (error) {
    setDriveStatus(`No se pudo restaurar (${error.message}).`, 'is-warn');
  }
}

// --- Al conectar: comparar antes de dar por bueno este dispositivo ----------
// Conectar ya no es un gesto mudo. Si Drive tiene más datos que este
// dispositivo, se ofrece traerlos en vez de dejar que se pisen luego.
async function reviewDriveState() {
  setDriveStatus('Comprobando Drive…');
  try {
    const fileId = await findDriveFileId(reviewDriveState);
    if (fileId === undefined) return;
    if (!fileId) {
      markDriveReady();
      setDriveStatus('Conectado. Aún no hay respaldo: pulsa Guardar.', 'is-ok');
      return;
    }

    const payload = await readDriveBackup(fileId, reviewDriveState);
    if (payload === undefined) return;
    if (!payload) { setDriveStatus('Conectado, pero el respaldo de Drive no es legible.', 'is-warn'); return; }

    const remote = payload.sessions.length;
    if (remote > sessions.length) {
      const ok = await showConfirm(
        `En tu Drive hay un respaldo con ${remote} sesiones, y en este dispositivo solo tienes ${sessions.length}.\n\n` +
        `¿Traer los datos de Drive a este dispositivo?`,
        { okText: 'Traer datos' });
      if (ok) { applyDriveBackup(payload); return; }
      // Sin traerlos, este dispositivo NO puede subir solo: pisaría el respaldo.
      setDriveStatus(`Conectado. Drive tiene ${remote} sesiones sin traer; el guardado automático queda en pausa.`, 'is-warn');
      return;
    }

    markDriveReady();
    setDriveStatus('Conectado y al día.', 'is-ok');
  } catch (error) {
    setDriveStatus(`Conectado, pero no pude comprobar Drive (${error.message}).`, 'is-warn');
  }
}

// Llamado por app.js al terminar una sesión. Solo sube si este dispositivo ya
// está al día con Drive; si no, callaría un respaldo mayor.
function driveAutoSync() {
  if (!driveEnabled() || !driveToken) return;
  if (!driveReady()) {
    setDriveStatus('Guardado automático en pausa: trae primero los datos de Drive.', 'is-warn');
    return;
  }
  driveSave({ silent: true });
}

// --- Arranque ---------------------------------------------------------------
// Guardar a mano es un gesto deliberado: marca este dispositivo como la fuente buena.
document.querySelector('#driveConnect').onclick = () => withDriveToken(reviewDriveState);
document.querySelector('#driveSave').onclick = () => withDriveToken(async () => { markDriveReady(); await driveSave(); });
document.querySelector('#driveRestore').onclick = () => withDriveToken(driveRestore);
initDrive();
