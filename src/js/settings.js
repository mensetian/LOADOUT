// ---------------------------------------------------------------------------
// Pestaña de AJUSTES (04)
//   - Preferencias persistentes: tema, idioma, descanso por defecto, sonido,
//     vibración.
//   - Resumen global de métricas de todo el historial.
//   - Estado del almacenamiento del navegador.
//   - Zona de riesgo: borrar todo (con copia para deshacer).
//
// Aprovecha que todos los <script> comparten el mismo ámbito global: `sessions`,
// `t`, `save`, `snapshot`, `makeSession`, etc. viven en app.js/backup.js.
// ---------------------------------------------------------------------------

const THEME_KEY   = 'loadout-theme';
const REST_DEF_KEY = 'loadout-rest-default';
const SOUND_KEY   = 'loadout-sound';
const VIBRATE_KEY = 'loadout-vibrate';

// --- Tema (persistente) -----------------------------------------------------
// Ojo: la clase `dark` en <body> pinta el tema CLARO (crema). Sin clase = oscuro.
function setTheme(mode) {
  document.body.classList.toggle('dark', mode === 'dark');
  localStorage.setItem(THEME_KEY, mode);
  syncPrefUI();
}
// Restaura al arrancar (app.js ya cargó, pero corregimos antes del primer uso).
if (localStorage.getItem(THEME_KEY) === 'dark') document.body.classList.add('dark');

// --- Estado visual de los controles segmentados -----------------------------
function setSeg(id, value) {
  const seg = document.querySelector(id);
  if (!seg) return;
  seg.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.val === String(value)));
}
function syncPrefUI() {
  setSeg('#themeSeg', document.body.classList.contains('dark') ? 'dark' : 'light');
  setSeg('#langSeg', getLang());
  setSeg('#restSeg', Number(localStorage.getItem(REST_DEF_KEY)) || 90);
  setSeg('#soundSeg', localStorage.getItem(SOUND_KEY) === 'off' ? 'off' : 'on');
  setSeg('#vibrateSeg', localStorage.getItem(VIBRATE_KEY) === 'off' ? 'off' : 'on');
}

// --- Cableado de los controles ----------------------------------------------
document.querySelectorAll('#themeSeg button').forEach(b => b.onclick = () => setTheme(b.dataset.val));
document.querySelectorAll('#langSeg button').forEach(b => b.onclick = () => {
  setLang(b.dataset.val);
  document.querySelector('#langButton').textContent = getLang() === 'en' ? 'EN' : 'ES';
  syncPrefUI();
});
document.querySelectorAll('#restSeg button').forEach(b => b.onclick = () => {
  const secs = Number(b.dataset.val);
  localStorage.setItem(REST_DEF_KEY, secs);
  restDuration = secs;
  if (!restInterval) stopRest(); // refleja la nueva duración en el contador en reposo
  syncPrefUI();
});
document.querySelectorAll('#soundSeg button').forEach(b => b.onclick = () => { localStorage.setItem(SOUND_KEY, b.dataset.val); syncPrefUI(); });
document.querySelectorAll('#vibrateSeg button').forEach(b => b.onclick = () => { localStorage.setItem(VIBRATE_KEY, b.dataset.val); syncPrefUI(); });

// El botón de tema del header también persiste ahora.
document.querySelector('#themeButton').onclick = () => setTheme(document.body.classList.contains('dark') ? 'light' : 'dark');

// --- Resumen global ---------------------------------------------------------
function computeGlobalStats() {
  const allSets = sessions.flatMap(s => s.exercises.flatMap(e => e.sets));
  const names = sessions.flatMap(s => s.exercises.map(e => e.name.trim()).filter(Boolean));
  const distinct = new Set(names.map(n => n.toLowerCase())).size;
  const dates = sessions.map(s => s.date).sort();
  const activeDays = new Set(dates).size;

  // Movimiento estrella: el que aparece en más sesiones (conserva su forma original).
  const freq = new Map(), label = new Map();
  sessions.forEach(s => {
    new Set(s.exercises.map(e => e.name.trim()).filter(Boolean).map(n => n.toLowerCase())).forEach(key => freq.set(key, (freq.get(key) || 0) + 1));
    s.exercises.forEach(e => { const k = e.name.trim().toLowerCase(); if (k && !label.has(k)) label.set(k, e.name.trim()); });
  });
  let starKey = null, starCount = 0;
  freq.forEach((count, key) => { if (count > starCount) { starCount = count; starKey = key; } });

  return {
    sessions: sessions.length,
    sets: allSets.length,
    volume: Math.round(allSets.reduce((tot, s) => tot + (s.weight || 0) * (s.reps || 0), 0)),
    distinct,
    activeDays,
    avgSets: sessions.length ? Math.round(allSets.length / sessions.length) : 0,
    star: starKey ? label.get(starKey) : null,
    starCount,
    first: dates[0] || null,
  };
}

function renderGlobalStats() {
  const root = document.querySelector('#globalStats');
  if (!root) return;
  if (!sessions.length) { root.innerHTML = `<p class="no-data">${t('config.noData')}</p>`; return; }
  const g = computeGlobalStats();
  const nf = n => n.toLocaleString(dateLocale());
  const tiles = [
    [t('config.stat.sessions'), nf(g.sessions)],
    [t('config.stat.sets'), nf(g.sets)],
    [t('config.stat.volume'), `${nf(g.volume)} kg`],
    [t('config.stat.exercises'), nf(g.distinct)],
    [t('config.stat.activeDays'), nf(g.activeDays)],
    [t('config.stat.avgSets'), nf(g.avgSets)],
    [t('config.stat.star'), g.star ? `${g.star} · ${g.starCount}×` : '—'],
    [t('config.stat.first'), g.first ? dateFmt(g.first) : '—'],
  ];
  root.innerHTML = tiles.map(([label, value]) =>
    `<article class="progress-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`).join('');
}

// --- Almacenamiento del navegador -------------------------------------------
async function renderStorageInfo() {
  const root = document.querySelector('#storageInfo');
  if (!root) return;
  let persisted = false, usage = null, quota = null;
  try { if (navigator.storage?.persisted) persisted = await navigator.storage.persisted(); } catch {}
  try { const est = await navigator.storage?.estimate?.(); if (est) { usage = est.usage; quota = est.quota; } } catch {}

  const fmtBytes = b => {
    if (b == null) return t('config.storageUnknown');
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
  };
  const usageText = usage != null
    ? (quota ? `${fmtBytes(usage)} / ${fmtBytes(quota)}` : fmtBytes(usage))
    : t('config.storageUnknown');

  const rows = [
    [t('config.storagePersist'), persisted ? t('config.storageOn') : t('config.storageOff'), persisted ? 'is-ok' : 'is-warn'],
    [t('config.storageUsage'), usageText, ''],
  ];
  root.innerHTML = rows.map(([label, value, kind]) =>
    `<div class="config-row"><div><strong>${escapeHtml(label)}</strong></div><span class="config-value ${kind}">${escapeHtml(value)}</span></div>`).join('');
}

// --- Borrar todo ------------------------------------------------------------
document.querySelector('#wipeData').onclick = async () => {
  if (!sessions.length) { await showAlert(t('config.wipeEmpty')); return; }
  const ok = await showConfirm(t('config.wipeConfirm', { n: sessions.length }), { danger: true, okText: t('config.wipeOk') });
  if (!ok) return;
  snapshot(t('config.wipeReason'));
  sessions = [];
  save();
  clearDraft();
  activeSession = makeSession();
  renderActiveSession();
  updateDashboard();
  renderConfig();
  await showAlert(t('config.wipeDone'));
};

// --- Pintado global de la pestaña -------------------------------------------
function renderConfig() {
  syncPrefUI();
  renderGlobalStats();
  renderStorageInfo();
}
window.renderConfig = renderConfig;

// Arranque + re-render al cambiar idioma (para traducir etiquetas ya pintadas).
document.querySelector('.tab[data-view="config"]')?.addEventListener('click', renderConfig);
const prevSettingsLangChange = window.onLangChange;
window.onLangChange = () => { prevSettingsLangChange?.(); renderConfig(); };
renderConfig();
