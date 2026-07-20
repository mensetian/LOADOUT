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
}

function restoreLastSnapshot() {
  const snaps = readSnapshots();
  if (!snaps.length) return alert('Todavía no hay copias automáticas guardadas.');
  const last = snaps[0];
  const when = new Date(last.at).toLocaleString('es-CO');
  if (!confirm(`Copia del ${when}\nMotivo: ${last.reason}\nContiene ${last.sessions.length} sesiones.\n\n¿Restaurarla? Se reemplazarán los datos actuales.`)) return;
  snapshot('antes de restaurar una copia');
  sessions = last.sessions;
  save();
  activeSession = makeSession();
  renderActiveSession();
  updateDashboard();
  alert('Copia restaurada.');
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
    el.textContent = '⚠ Nunca has hecho un respaldo. Si pierdes este navegador, pierdes el registro.';
    el.className = 'backup-status is-warn';
    return;
  }
  const days = Math.floor((Date.now() - new Date(raw)) / 86400000);
  const label = days === 0 ? 'hoy' : days === 1 ? 'hace 1 día' : `hace ${days} días`;
  el.textContent = `Último respaldo: ${label}.`;
  el.className = days >= 7 ? 'backup-status is-warn' : 'backup-status';
}

// --- Arranque ---------------------------------------------------------------
requestPersistentStorage();
renderBackupStatus();
document.querySelector('#restoreSnapshot').onclick = restoreLastSnapshot;
