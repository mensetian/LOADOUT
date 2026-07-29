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
let driveCodeClient = null; // flujo con worker (conexión permanente)
let drivePendingAction = null;
let driveSilent = false; // true mientras se intenta la reconexión sin popup

const driveEnabled = () => typeof GOOGLE_CLIENT_ID === 'string' && GOOGLE_CLIENT_ID.trim().length > 10;
// Recuerda si este dispositivo ya autorizó alguna vez, para intentar reconectar
// en silencio al abrir la app (sin popup) las próximas veces.
const DRIVE_LINKED_KEY = 'loadout-drive-linked';
// El token dura ~1 hora: guardado con su vencimiento, una recarga dentro de esa
// hora reutiliza el token y la conexión persiste sin popup.
const DRIVE_TOKEN_KEY = 'loadout-drive-token';

function storeDriveToken(token, expiresIn) {
  // 1 minuto de margen para no usar un token a punto de vencer.
  const expiresAt = Date.now() + ((Number(expiresIn) || 3600) - 60) * 1000;
  try { localStorage.setItem(DRIVE_TOKEN_KEY, JSON.stringify({ token, expiresAt })); } catch {}
}

function restoreDriveToken() {
  try {
    const saved = JSON.parse(localStorage.getItem(DRIVE_TOKEN_KEY));
    if (saved?.token && saved.expiresAt > Date.now()) return saved.token;
  } catch {}
  localStorage.removeItem(DRIVE_TOKEN_KEY);
  return null;
}

// --- Conexión permanente vía worker (ver worker/drive-auth.js) --------------
// Con el worker configurado, la primera autorización entrega un refresh token
// que se guarda en este dispositivo. Desde ahí, los tokens de 1 hora se
// renuevan solos y sin popup: se inicia sesión una sola vez por dispositivo.
const DRIVE_REFRESH_KEY = 'loadout-drive-refresh';
const driveAuthUrl = () =>
  (typeof DRIVE_AUTH_URL === 'string' ? DRIVE_AUTH_URL.trim().replace(/\/$/, '') : '');

function adoptDriveToken(data) {
  driveToken = data.access_token;
  storeDriveToken(driveToken, data.expires_in);
  // Google solo manda el refresh token en la primera autorización: no pisarlo.
  if (data.refresh_token) localStorage.setItem(DRIVE_REFRESH_KEY, data.refresh_token);
  localStorage.setItem(DRIVE_LINKED_KEY, '1');
}

// Renueva el access token con el worker, sin popup. true = quedó listo.
async function refreshDriveToken() {
  const refresh = localStorage.getItem(DRIVE_REFRESH_KEY);
  if (!refresh || !driveAuthUrl()) return false;
  try {
    const response = await fetch(`${driveAuthUrl()}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) {
      // invalid_grant = el usuario revocó el acceso: toca autorizar de nuevo.
      if (data.error === 'invalid_grant') localStorage.removeItem(DRIVE_REFRESH_KEY);
      return false;
    }
    adoptDriveToken(data);
    return true;
  } catch { return false; } // sin red: se queda como estaba
}

// Abre el popup de Google con el flujo que esté activo.
function requestDriveAuth() {
  if (driveCodeClient) driveCodeClient.requestCode();
  else driveTokenClient.requestAccessToken();
}

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
  script.onload = async () => {
    if (driveAuthUrl()) {
      // Flujo con worker: la autorización devuelve un código que el worker
      // cambia por tokens (incluido el refresh token que hace todo permanente).
      driveCodeClient = google.accounts.oauth2.initCodeClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        ux_mode: 'popup',
        // Google solo entrega el refresh token en el primer consentimiento. Si
        // la cuenta ya había autorizado la app, sin esto no llegaría ninguno y
        // la conexión volvería a durar una hora. Solo se ve al conectar.
        prompt: 'consent',
        callback: async response => {
          if (response.error) return setDriveStatus(t('drive.authFail'), 'is-warn');
          try {
            const r = await fetch(`${driveAuthUrl()}/exchange`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: response.code }),
            });
            const data = await r.json();
            if (!r.ok || !data.access_token) throw new Error(data.error || `HTTP ${r.status}`);
            adoptDriveToken(data);
            // Sin refresh token la conexión seguiría caducando en una hora: se
            // avisa en vez de aparentar que quedó permanente.
            if (!localStorage.getItem(DRIVE_REFRESH_KEY)) console.warn('Drive: sin refresh token; la sesión durará ~1 hora.');
            const action = drivePendingAction;
            drivePendingAction = null;
            if (action) action(); else setDriveStatus(t('drive.connected'), 'is-ok');
          } catch {
            setDriveStatus(t('drive.authFail'), 'is-warn');
          }
        },
      });
    } else {
      // Flujo antiguo sin worker: token directo, dura ~1 hora.
      driveTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: response => {
          if (response.error) {
            // Falló la reconexión silenciosa: no es un error visible, solo pide tocar.
            if (driveSilent) { driveSilent = false; setDriveStatus(t('drive.reconnectFail')); return; }
            return setDriveStatus(t('drive.authFail'), 'is-warn');
          }
          adoptDriveToken(response);
          driveSilent = false;
          const action = drivePendingAction;
          drivePendingAction = null;
          if (action) action(); else setDriveStatus(t('drive.connected'), 'is-ok');
        },
      });
    }
    // Reconexión al arranque, siempre sin popup: primero el token guardado que
    // aún no vence; si ya venció y hay refresh token, se renueva con el worker.
    driveToken = restoreDriveToken();
    if (!driveToken) await refreshDriveToken();
    if (!driveToken) return setDriveStatus(t('drive.notConnected'));
    setDriveStatus(t('drive.connected'), 'is-ok');
    driveAutoSync(); // trae de una vez lo que se haya entrenado en otro aparato
  };
  script.onerror = () => setDriveStatus(t('drive.offline'), 'is-warn');
  document.head.append(script);
}
const silentSync = () => driveSync({ silent: true, retry: silentSync }).catch(() => {});

// Ejecuta `action` asegurando que haya un token válido. Solo abre el popup si
// no hay token vigente ni forma de renovarlo en silencio.
//
// Se llama desde clics, así que el popup debe pedirse sin esperar nada: si hay
// un 'await' por medio el navegador ya no lo asocia al toque y lo bloquea. Por
// eso el camino sin refresh token (primera conexión) es totalmente síncrono.
function withDriveToken(action) {
  if (!driveTokenClient && !driveCodeClient) return setDriveStatus(t('drive.notLoaded'), 'is-warn');
  if (driveToken) return action();
  if (!localStorage.getItem(DRIVE_REFRESH_KEY)) {
    drivePendingAction = action;
    return requestDriveAuth();
  }
  // Hay refresh token: lo normal es renovar en silencio y no abrir nada.
  return refreshDriveToken().then(ok => {
    if (ok) return action();
    drivePendingAction = action;
    requestDriveAuth();
  });
}

function driveHeaders(extra = {}) {
  return { Authorization: `Bearer ${driveToken}`, ...extra };
}

// Las sincronizaciones que no nacen de un toque (al volver a la app, mientras
// entrenas) nunca deben abrir un popup: aparecería sin que nadie lo haya pedido,
// y a media serie es lo último que quieres ver. Con esto en alto, si el token no
// se puede renovar en silencio la operación simplemente se deja para más tarde.
let driveNoPopup = false;
async function inBackground(action) {
  driveNoPopup = true;
  try { return await action(); } finally { driveNoPopup = false; }
}

// Un 401 significa que el token expiró: lo descartamos y reintentamos una vez.
// Con worker, la renovación es silenciosa; sin él (o si falla), abre el popup.
async function driveExpired(response, retry) {
  if (response.status !== 401) return false;
  driveToken = null;
  localStorage.removeItem(DRIVE_TOKEN_KEY);
  if (await refreshDriveToken()) { retry?.(); return true; }
  if (driveNoPopup) return true; // se reintentará al volver a la app
  drivePendingAction = retry;
  requestDriveAuth();
  return true;
}

// --- Guardar ----------------------------------------------------------------
async function driveSave({ silent = false } = {}) {
  // `deleted` lleva las lápidas y `draft` el entrenamiento aún sin terminar, para
  // que un móvil que se quede sin batería no se lleve la sesión por delante.
  const body = JSON.stringify({ app: 'LOADOUT', version: 1, exportedAt: new Date().toISOString(),
    sessions, templates, cardio, deleted: deletedIds, draft: readDraft() }, null, 2);
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
      if (await driveExpired(response, () => driveSave({ silent }))) return;
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
      if (await driveExpired(response, () => driveSave({ silent }))) return;
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
  if (await driveExpired(search, retry)) return undefined; // undefined = reintentando tras re-autorizar
  if (!search.ok) throw new Error(`HTTP ${search.status}`);
  const found = await search.json();
  const fileId = found.files?.[0]?.id ?? null;
  if (fileId) localStorage.setItem(DRIVE_FILE_KEY, fileId);
  return fileId;
}

async function readDriveBackup(fileId, retry) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: driveHeaders() });
  if (await driveExpired(response, retry)) return undefined;
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
  // Ahora se sincroniza también a media sesión, así que esto puede caer mientras
  // entrenas: reiniciar la captura aquí te borraría las series de la pantalla.
  if (!draftInProgress()) { activeSession = makeSession(); renderActiveSession(); }
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
    // Primero se juntan las lápidas de ambos lados: hay que saber qué se borró
    // en cualquier dispositivo ANTES de decidir qué sobrevive a la fusión.
    deletedIds = mergeDeleted(deletedIds, payload.deleted);
    saveDeleted();

    const merged = applyDeleted(mergeSessions(sessions, payload.sessions), sessionStamp);
    if (!sameSessions(merged, sessions)) {
      adoptSessions(merged, t('drive.syncReason'));
      combined = true;
    }
    // Las plantillas se fusionan aparte, por su propio id.
    const stampOf = x => x.updatedAt || '';
    const mergedTemplates = applyDeleted(mergeTemplates(templates, payload.templates), stampOf);
    if (JSON.stringify(mergedTemplates) !== JSON.stringify(templates)) {
      templates = mergedTemplates;
      saveTemplates();
      window.renderConfig?.();
    }
    // Y el cardio igual: su propia lista, su propia fusión por id.
    const mergedCardio = applyDeleted(mergeCardio(cardio, payload.cardio), stampOf);
    if (JSON.stringify(mergedCardio) !== JSON.stringify(cardio)) {
      cardio = mergedCardio;
      saveCardio();
      updateDashboard();
      combined = true;
    }
    // Y por último el entrenamiento en curso, que nunca pisa lo que haya abierto aquí.
    if (syncDraft(payload.draft)) combined = true;
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
    if (Array.isArray(payload.templates)) { templates = payload.templates; saveTemplates(); window.renderConfig?.(); }
    if (Array.isArray(payload.cardio)) { cardio = payload.cardio; saveCardio(); updateDashboard(); }
    setDriveStatus(t('drive.restored',{n:sessions.length}), 'is-ok');
    await showAlert(t('drive.restoredAlert'));
  } catch (error) {
    setDriveStatus(t('drive.restoreError',{error:error.message}), 'is-warn');
  }
}

// Llamado por app.js al terminar una sesión: fusiona y sube en segundo plano.
// Nunca abre popup: si no hay token ni renovación silenciosa, simplemente no sube.
async function driveAutoSync() {
  if (!driveEnabled()) return;
  return inBackground(async () => {
    if (!driveToken && !(await refreshDriveToken())) return;
    lastAutoSync = Date.now();
    await driveSync({ silent: true, retry: driveAutoSync }).catch(() => {});
  });
}

// --- Sincronizar al volver a la app -----------------------------------------
// Antes solo se sincronizaba al terminar un entrenamiento o pulsando el botón,
// así que abrir el móvil en el gimnasio mostraba datos viejos hasta que te
// acordabas de tocar el chip. Ahora basta con volver a la app.
const AUTO_SYNC_GAP = 90_000; // margen para no repetir en cada cambio de pestaña
let lastAutoSync = 0;
function syncOnReturn() {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastAutoSync < AUTO_SYNC_GAP) return;
  driveAutoSync();
}
document.addEventListener('visibilitychange', syncOnReturn);
window.addEventListener('focus', syncOnReturn);

// --- Subida del entrenamiento en curso ---------------------------------------
// El respaldo esperaba a que terminaras: cerrar el navegador a media rutina
// dejaba esas series solo en este aparato. Ahora se suben también a medias, con
// retraso para no mandar una petición por cada tecla.
// Sube fusionando (no a secas): si otro aparato dejó algo en Drive que este aún
// no tiene, un guardado directo lo borraría del respaldo.
const DRAFT_UPLOAD_DELAY = 120_000;
let draftUploadTimer = null;
function driveDraftChanged() {
  if (!driveEnabled() || draftUploadTimer) return;
  draftUploadTimer = setTimeout(() => { draftUploadTimer = null; driveAutoSync(); }, DRAFT_UPLOAD_DELAY);
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
// La fusión vive aquí, pero se prueba desde tests/index.html (ver app.js).
window.LOADOUT_TEST = { ...window.LOADOUT_TEST, mergeSessions, mergeCardio, cardioStats,
  getCardio: () => cardio, setCardio: v => { cardio = v; } };
const prevOnLangChange = window.onLangChange;
window.onLangChange = () => { prevOnLangChange?.(); updateConnChip(lastChipKind); renderBackupStatus?.(); };
