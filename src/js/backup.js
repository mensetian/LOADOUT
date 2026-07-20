// ---------------------------------------------------------------------------
// Durabilidad de los datos locales
//   1. Pide al navegador almacenamiento persistente (que no se borre al
//      liberar espacio).
//   2. Guarda copias automáticas antes de cada operación destructiva.
//   3. Recuerda cuándo fue el último respaldo real (archivo o Drive).
//
// Ojo: las copias del punto 2 viven en el mismo navegador. Protegen de un
// borrado accidental dentro de la app, NO de perder el dispositivo ni de
// "borrar datos de navegación". Para eso hace falta exportar o usar Drive.
// ---------------------------------------------------------------------------

const SNAP_KEY = 'loadout-snapshots';
const LAST_BACKUP_KEY = 'loadout-last-backup';
const MAX_SNAPSHOTS = 5;

// --- 1. Almacenamiento persistente -----------------------------------------
async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return;
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch { /* el navegador no lo soporta; seguimos igual */ }
}

// --- 2. Copias automáticas --------------------------------------------------
function readSnapshots() {
  try { return JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'); } catch { return []; }
}

function snapshot(reason) {
  try {
    const snaps = readSnapshots();
    snaps.unshift({ at: new Date().toISOString(), reason, sessions });
    localStorage.setItem(SNAP_KEY, JSON.stringify(snaps.slice(0, MAX_SNAPSHOTS)));
  } catch { /* sin espacio: no bloqueamos la acción del usuario */ }
  renderSnapshotStatus();
}

function agoLabel(iso) {
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return t('backup.momentAgo');
  if (mins < 60) return t('backup.minAgo',{n:mins});
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('backup.hourAgo',{n:hours});
  const days = Math.floor(hours / 24);
  return days === 1 ? t('backup.dayAgo') : t('backup.daysAgo2',{n:days});
}

// El botón "Deshacer" debe explicarse solo: dice qué revertiría, o se apaga.
function renderSnapshotStatus() {
  const button = document.querySelector('#restoreSnapshot');
  const status = document.querySelector('#snapshotStatus');
  if (!button || !status) return;
  const snaps = readSnapshots();
  button.disabled = !snaps.length;
  if (!snaps.length) {
    status.textContent = t('undo.none');
    return;
  }
  status.textContent = t('undo.label',{reason:snaps[0].reason, ago:agoLabel(snaps[0].at)});
}

async function restoreLastSnapshot() {
  const snaps = readSnapshots();
  if (!snaps.length) { await showAlert(t('undo.noneAlert')); return; }
  const last = snaps[0];
  const when = new Date(last.at).toLocaleString(dateLocale());
  const ok = await showConfirm(
    t('undo.confirm', {reason:last.reason, ago:agoLabel(last.at), when, n:last.sessions.length}),
    { danger: true, okText: t('undo.ok') });
  if (!ok) return;
  snapshot(t('undo.restoreReason'));
  sessions = last.sessions;
  save();
  activeSession = makeSession();
  renderActiveSession();
  updateDashboard();
  await showAlert(t('undo.done'));
}

// --- 3. Estado del último respaldo ------------------------------------------
function markBackupDone() {
  localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
  renderBackupStatus();
}

function renderBackupStatus() {
  const el = document.querySelector('#backupStatus');
  if (!el) return;
  const raw = localStorage.getItem(LAST_BACKUP_KEY);
  if (!sessions.length) { el.textContent = ''; el.className = 'backup-status'; return; }
  if (!raw) {
    el.textContent = t('backup.neverWarn');
    el.className = 'backup-status is-warn';
    return;
  }
  const days = Math.floor((Date.now() - new Date(raw)) / 86400000);
  const label = days === 0 ? t('backup.lastToday') : days === 1 ? t('backup.last1Day') : t('backup.lastDays',{n:days});
  el.textContent = t('backup.lastLabel',{label});
  el.className = days >= 7 ? 'backup-status is-warn' : 'backup-status';
}

// --- Arranque ---------------------------------------------------------------
requestPersistentStorage();
renderBackupStatus();
renderSnapshotStatus();
document.querySelector('#restoreSnapshot').onclick = restoreLastSnapshot;
