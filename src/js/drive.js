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

let driveToken = null;
let driveTokenClient = null;
let drivePendingAction = null;
let driveSilent = false; // true mientras se intenta la reconexión sin popup

const driveEnabled = () => typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.trim().length > 10;
// Recuerda si este dispositivo ya autorizó alguna vez, para intentar reconectar
// en silencio al abrir la app (sin popup) las próximas veces.
const DRIVE_LINKED_KEY = 'loadout-drive-linked';

// Etiqueta corta para el chip del header según el estado.
const CHIP = {
  '':        { label: 'drive.chip.default',  title: 'drive.chip.defaultTitle' },
  'is-ok':   { label: 'drive.chip.ok',        title: 'drive.chip.okTitle' },
  'is-warn': { label: 'drive.chip.warn',      title: 'drive.chip.warnTitle' },
  'busy':    { label: 'drive.chip.busy',      title: 'drive.chip.busyTitle' },
};
let lastChipKind = '';

function updateConnChip(kind) {
  lastChipKind = kind;
  const chip = document.querySelector('#connChip');
  const label = document.querySelector('#connLabel');
  if (!chip || !label) return;
  const info = CHIP[kind] ?? CHIP[''];
  chip.hidden = false;
  chip.className = `conn-chip ${kind}`;
  chip.title = t(info.title);
  label.textContent = t(info.label);
}

function setDriveStatus(text, kind = '') {
  const el = document.querySelector('#driveStatus');
  if (el) { el.textContent = text; el.className = `drive-status ${kind}`; }
  updateConnChip(kind);
}

// --- Autorización -----------------------------------------------------------
function initDrive() {
  if (!driveEnabled()) return; // sin Client ID la tarjeta permanece oculta
  document.querySelector('#driveCard').hidden = false;
  setDriveStatus(t('drive.loadingGoogle'));

  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  script.onload = () => {
    driveTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: response => {
        if (response.error) {
          // Falló la reconexión silenciosa: no es un error visible, solo pide tocar.
          if (driveSilent) { driveSilent = false; setDriveStatus(t('drive.reconnectFail')); return; }
          return setDriveStatus(t('drive.authFail'), 'is-warn');
        }
        driveToken = response.access_token;
        localStorage.setItem(DRIVE_LINKED_KEY, '1');
        driveSilent = false;
        const action = drivePendingAction;
        drivePendingAction = null;
        if (action) action(); else setDriveStatus(t('drive.connected'), 'is-ok');
      },
    });
    // Sin servidor no hay refresh token, así que reconectar en el arranque abría
    // el popup de Google en cada recarga (molesto). Mejor esperar a que el
    // usuario toque el chip / Sincronizar para pedir el token.
    setDriveStatus(t('drive.notConnected'));
  };
  script.onerror = () => setDriveStatus(t('drive.offline'), 'is-warn');
  document.head.append(script);
}
const silentSync = () => driveSync({ silent: true, retry: silentSync }).catch(() => {});

// Ejecuta `action` asegurando que haya un token válido.
function withDriveToken(action) {
  if (!driveTokenClient) return setDriveStatus(t('drive.notLoaded'), 'is-warn');
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
  setDriveStatus(t('drive.saving'));

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
    setDriveStatus(t('drive.saved',{time:new Date().toLocaleTimeString(dateLocale())}), 'is-ok');
    markBackupDone();
    if (!silent) await showAlert(t('drive.saveDoneAlert'));
  } catch (error) {
    setDriveStatus(t('drive.saveError',{error:error.message}), 'is-warn');
    if (!silent) await showAlert(t('drive.saveErrorAlert'));
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

// --- Fusión por id ----------------------------------------------------------
// La union de dos historiales nunca pierde una sesión. Si la misma sesión (mismo
// id) existe en ambos lados, gana la editada más tarde. Como tie-break sin sello
// de edición, se usa la fecha del entrenamiento.
function sessionStamp(s) { return s.updatedAt || `${s.date}T00:00:00.000Z`; }
function mergeSessions(local, remote) {
  const byId = new Map();
  // Recorre remoto primero y local después: con '>=' el local gana los empates.
  for (const s of [...remote, ...local]) {
    const prev = byId.get(s.id);
    if (!prev || sessionStamp(s) >= sessionStamp(prev)) byId.set(s.id, s);
  }
  return [...byId.values()].sort((a, b) => b.date.localeCompare(a.date));
}
// Comparación estable (independiente del orden) para saber si algo cambió.
const canonSessions = list => JSON.stringify([...list].sort((a, b) => a.id.localeCompare(b.id)));
const sameSessions = (a, b) => canonSessions(a) === canonSessions(b);

function adoptSessions(merged, reason) {
  snapshot(reason);
  sessions = merged;
  save();
  activeSession = makeSession();
  renderActiveSession();
  updateDashboard();
}

// --- Sincronizar (bajar + fusionar + subir) ---------------------------------
// Núcleo de la sincronización: trae lo de Drive, lo une con lo local y sube la
// unión. Así ningún guardado pisa datos del otro dispositivo.
async function driveSync({ silent, retry }) {
  setDriveStatus(t('drive.syncing'), 'busy');
  const fileId = await findDriveFileId(retry);
  if (fileId === undefined) return; // reintentando tras re-autorizar

  let combined = false;
  if (fileId) {
    const payload = await readDriveBackup(fileId, retry);
    if (payload === undefined) return;
    if (!payload) {
      if (!silent) setDriveStatus(t('drive.unreadable'), 'is-warn');
      return;
    }
    const merged = mergeSessions(sessions, payload.sessions);
    if (!sameSessions(merged, sessions)) {
      adoptSessions(merged, t('drive.syncReason'));
      combined = true;
    }
  }

  await driveSave({ silent: true }); // sube la unión ya reconciliada
  setDriveStatus(t('drive.synced',{n:sessions.length}), 'is-ok');
  if (!silent) {
    await showAlert(combined
      ? t('drive.syncCombined',{n:sessions.length})
      : t('drive.syncNoChanges'));
  }
}

const manualSync = () => driveSync({ silent: false, retry: manualSync }).catch(e => setDriveStatus(t('drive.syncError',{error:e.message}), 'is-warn'));

// --- Restaurar (forzar: reemplazar lo local con lo de Drive) ----------------
// Escotilla de emergencia. A diferencia de sincronizar, aquí SÍ se descarta lo
// local; útil si este dispositivo tiene datos erróneos que no quieres propagar.
async function driveRestore() {
  setDriveStatus(t('drive.searching'));
  try {
    const fileId = await findDriveFileId(driveRestore);
    if (fileId === undefined) return;
    if (!fileId) { setDriveStatus(t('drive.notFound'), 'is-warn'); return; }

    const payload = await readDriveBackup(fileId, driveRestore);
    if (payload === undefined) return;
    if (!payload) { setDriveStatus(t('drive.invalidBackup'), 'is-warn'); return; }

    const ok = await showConfirm(
      t('drive.forceConfirm', {local:sessions.length, remote:payload.sessions.length}),
      { danger: true, okText: t('drive.forceOk') });
    if (!ok) { setDriveStatus(t('drive.forceCancelled')); return; }

    adoptSessions([...payload.sessions], t('drive.restoreReason'));
    setDriveStatus(t('drive.restored',{n:sessions.length}), 'is-ok');
    await showAlert(t('drive.restoredAlert'));
  } catch (error) {
    setDriveStatus(t('drive.restoreError',{error:error.message}), 'is-warn');
  }
}

// Llamado por app.js al terminar una sesión: fusiona y sube en segundo plano.
function driveAutoSync() {
  if (!driveEnabled() || !driveToken) return;
  driveSync({ silent: true, retry: driveAutoSync }).catch(() => {});
}

// --- Arranque ---------------------------------------------------------------
document.querySelector('#driveConnect').onclick = () => withDriveToken(manualSync);
document.querySelector('#driveSave').onclick = () => withDriveToken(manualSync);
document.querySelector('#driveRestore').onclick = () => withDriveToken(driveRestore);
// El chip del header lleva a la pestaña LOG y dispara una sincronización.
document.querySelector('#connChip').onclick = () => {
  document.querySelector('.tab[data-view="config"]')?.click();
  withDriveToken(manualSync);
};
initDrive();
const prevOnLangChange = window.onLangChange;
window.onLangChange = () => { prevOnLangChange?.(); updateConnChip(lastChipKind); renderBackupStatus?.(); };
