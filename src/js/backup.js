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
    snaps.unshift({ at: new Date().toISOString(), reason, sessions, templates, cardio });
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
  // Las copias viejas no llevaban plantillas ni cardio: en ese caso se dejan como están.
  if (Array.isArray(last.templates)) { templates = last.templates; saveTemplates(); }
  if (Array.isArray(last.cardio)) { cardio = last.cardio; saveCardio(); }
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
  renderBackupAlert();
}

function renderBackupStatus() {
  const el = document.querySelector('#backupStatus');
  if (!el) return;
  const raw = localStorage.getItem(LAST_BACKUP_KEY);
  if (!sessions.length && !cardio.length) { el.textContent = ''; el.className = 'backup-status'; return; }
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

// --- 4. Aviso cuando el respaldo se cayó ------------------------------------
// El modo de fallo real no es "Drive da error": es que Drive deja de subir y la
// app sigue como si nada. El chip del header no basta (en móvil se reduce a un
// punto de 8px), así que el aviso escala con el tiempo sin respaldo:
//   3 días  → banner permanente bajo la cabecera.
//   7 días  → además, un diálogo al terminar de entrenar.
// El diálogo va al FINAL de la sesión a propósito: interrumpir a media serie
// para hablar de copias de seguridad es la forma más rápida de que lo ignore.
const BACKUP_WARN_DAYS = 3;
const BACKUP_NAG_DAYS = 7;
const NAG_KEY = 'loadout-backup-nag';
const NAG_GAP = 86400000; // como mucho, un diálogo por día

// Infinity = nunca hubo un respaldo real. Es el caso más grave, no el más leve.
function daysSinceBackup() {
  const at = new Date(localStorage.getItem(LAST_BACKUP_KEY) || '').getTime();
  return Number.isFinite(at) ? (Date.now() - at) / 86400000 : Infinity;
}
const hasDataAtRisk = () => sessions.length > 0 || cardio.length > 0;

// Un toque tiene que resolverlo, no solo informar. Con Drive configurado abre la
// reconexión (el clic del usuario habilita el popup de Google); sin él, exporta.
function fixBackupNow() {
  if (typeof driveEnabled === 'function' && driveEnabled()) {
    document.querySelector('.tab[data-view="config"]')?.click();
    withDriveToken(manualSync);
  } else {
    document.querySelector('#exportData')?.click();
  }
}

function renderBackupAlert() {
  const el = document.querySelector('#backupAlert');
  if (!el) return;
  const days = daysSinceBackup();
  const show = hasDataAtRisk() && days >= BACKUP_WARN_DAYS;
  el.hidden = !show;
  if (!show) return;
  el.classList.toggle('is-critical', days >= BACKUP_NAG_DAYS);
  document.querySelector('#backupAlertText').textContent =
    days === Infinity ? t('alert.never') : t('alert.stale', { n: Math.floor(days) });
}

// Llamado por app.js al terminar una sesión, ya con la subida intentada.
async function backupNagIfNeeded() {
  if (!hasDataAtRisk()) return;
  const days = daysSinceBackup();
  if (days < BACKUP_NAG_DAYS) return;
  if (Date.now() - Number(localStorage.getItem(NAG_KEY) || 0) < NAG_GAP) return;
  localStorage.setItem(NAG_KEY, String(Date.now()));
  const ok = await showConfirm(
    days === Infinity ? t('alert.modalNever', { n: sessions.length })
                      : t('alert.modalStale', { n: Math.floor(days) }),
    { okText: t('alert.modalOk'), cancelText: t('alert.modalLater') });
  if (ok) fixBackupNow();
}

// --- Arranque ---------------------------------------------------------------
requestPersistentStorage();
renderBackupStatus();
renderSnapshotStatus();
renderBackupAlert();
document.querySelector('#restoreSnapshot').onclick = restoreLastSnapshot;
document.querySelector('#backupAlert').onclick = fixBackupNow;
// Volver a la app dispara una sincronización (drive.js): si arregló el respaldo,
// el banner debe irse solo; si no, tiene que seguir ahí al día siguiente.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renderBackupAlert();
});
