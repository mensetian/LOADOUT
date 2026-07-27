// ---------------------------------------------------------------------------
// Sesiones de cardio
//
// Un entrenamiento de fuerza es series × peso × reps. Un cardio no: patineta,
// bici o correr no tienen "carga" comparable entre sesiones, y forzarlos al
// molde de la fuerza solo ensuciaría el tonelaje y los récords. Por eso viven
// en su propia lista, con los tres únicos datos que sí sirven a largo plazo:
//   - duración: lo mínimo imprescindible.
//   - esfuerzo percibido (RPE 1-10): más honesto que distancia o ritmo cuando
//     la actividad es irregular (un rato de trucos no es un ritmo constante).
//   - nota libre: lo que estabas practicando; es lo que querrás releer luego.
//
// Comparten el LOG y la constancia con las sesiones de fuerza (entrenar es
// entrenar), pero no tocan tonelaje, 1RM ni récords.
//
// Este archivo se carga ANTES que app.js, así que aquí solo se declaran cosas y
// se cablean eventos: nada de llamar en el arranque a funciones de app.js, que
// todavía no existen. Los repintados los dispara app.js vía updateDashboard().
// ---------------------------------------------------------------------------

const CARDIO_KEY = 'loadout-cardio-v1';
let cardio = [];
try { const raw = JSON.parse(localStorage.getItem(CARDIO_KEY) || '[]'); if (Array.isArray(raw)) cardio = raw; } catch {}
const saveCardio = () => localStorage.setItem(CARDIO_KEY, JSON.stringify(cardio));

// Sugerencias de actividad: lo que ya registraste primero, y si aún no hay nada,
// unas pocas por defecto para no dejar el campo a ciegas.
function cardioActivities() {
  const used = [...new Set(cardio.map(c => (c.activity || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const defaults = t('cardio.defaults').split('|').map(s => s.trim());
  const seen = new Set(used.map(a => a.toLowerCase()));
  return [...used, ...defaults.filter(d => !seen.has(d.toLowerCase()))];
}

// Fusión por id para Drive/importar: igual que las sesiones, gana la más
// reciente y nunca se pierde una entrada que solo exista en un lado.
function mergeCardio(local, remote) {
  const byId = new Map();
  for (const c of [...(remote || []), ...(local || [])]) {
    if (!c?.id) continue;
    const prev = byId.get(c.id);
    if (!prev || (c.updatedAt || '') >= (prev.updatedAt || '')) byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

// --- Formulario -------------------------------------------------------------
let editingCardioId = null;   // null = alta nueva; un id = estás editando esa
let cardioRpe = 0;            // 0 = sin elegir todavía

const RPE_STEPS = 10;
// Etiqueta del tramo, para que el número signifique algo sin tener que aprenderlo.
function rpeLabel(v) {
  if (!v) return t('cardio.rpeNone');
  const band = v <= 2 ? 'easy' : v <= 4 ? 'light' : v <= 6 ? 'moderate' : v <= 8 ? 'hard' : 'max';
  return `${v}/10 · ${t('cardio.rpe.' + band)}`;
}

function renderRpeScale() {
  const root = document.querySelector('#cardioRpe');
  if (!root) return;
  root.innerHTML = Array.from({ length: RPE_STEPS }, (_, i) => {
    const v = i + 1;
    return `<button type="button" class="rpe-dot${v === cardioRpe ? ' is-active' : ''}" data-rpe="${v}" aria-pressed="${v === cardioRpe}">${v}</button>`;
  }).join('');
  root.querySelectorAll('.rpe-dot').forEach(b => b.onclick = () => {
    // Volver a tocar el valor elegido lo desmarca: el RPE es opcional.
    cardioRpe = Number(b.dataset.rpe) === cardioRpe ? 0 : Number(b.dataset.rpe);
    renderRpeScale();
  });
  document.querySelector('#cardioRpeLabel').textContent = rpeLabel(cardioRpe);
}

function resetCardioForm() {
  editingCardioId = null;
  cardioRpe = 0;
  document.querySelector('#cardioActivity').value = '';
  document.querySelector('#cardioMinutes').value = '';
  document.querySelector('#cardioNote').value = '';
  document.querySelector('#cardioDate').value = todayKey();
  renderCardioForm();
}

// El formulario es el mismo para crear y para editar; solo cambian los rótulos.
function renderCardioForm() {
  const editing = !!editingCardioId;
  document.querySelector('#cardioSave').textContent = t(editing ? 'cardio.update' : 'cardio.save');
  document.querySelector('#cardioCancel').hidden = !editing;
  document.querySelector('#cardioFormTitle').textContent = t(editing ? 'cardio.editing' : 'cardio.new');
  const dateField = document.querySelector('#cardioDate');
  if (!dateField.value) dateField.value = todayKey();   // primera pintada: hoy
  renderRpeScale();
}

async function saveCardioEntry() {
  const activity = document.querySelector('#cardioActivity').value.trim();
  const minutes = Math.round(num(document.querySelector('#cardioMinutes').value));
  const note = document.querySelector('#cardioNote').value.trim();
  const date = document.querySelector('#cardioDate').value || todayKey();
  if (!activity) { await showAlert(t('cardio.needActivity')); return; }
  if (!minutes || minutes <= 0) { await showAlert(t('cardio.needMinutes')); return; }

  const entry = {
    id: editingCardioId || crypto.randomUUID(),
    date, activity, minutes,
    rpe: cardioRpe || null,
    note,
    updatedAt: new Date().toISOString(),
  };
  const index = cardio.findIndex(c => c.id === entry.id);
  if (index >= 0) cardio[index] = entry; else cardio.push(entry);
  saveCardio();
  resetCardioForm();
  updateDashboard();
  window.driveAutoSync?.();
  await showAlert(t('cardio.saved', { activity, n: minutes }));
}

function editCardio(id) {
  const c = cardio.find(x => x.id === id);
  if (!c) return;
  editingCardioId = c.id;
  cardioRpe = c.rpe || 0;
  document.querySelector('#cardioActivity').value = c.activity || '';
  document.querySelector('#cardioMinutes').value = c.minutes || '';
  document.querySelector('#cardioNote').value = c.note || '';
  document.querySelector('#cardioDate').value = c.date || todayKey();
  // Editar se pide desde el LOG, así que hay que llevar al usuario al
  // capturador: si no, el formulario se rellena en una pestaña que no ve.
  document.querySelector('.tab[data-view="session"]')?.click();
  setCaptureMode('cardio');
  renderCardioForm();
  document.querySelector('#cardioPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function deleteCardio(id) {
  const c = cardio.find(x => x.id === id);
  if (!c) return;
  if (!(await showConfirm(t('cardio.deleteConfirm', { activity: c.activity }), { danger: true, okText: t('cardio.deleteOk') }))) return;
  cardio = cardio.filter(x => x.id !== id);
  saveCardio();
  if (editingCardioId === id) resetCardioForm();
  updateDashboard();
  window.driveAutoSync?.();
}

// --- Conmutador fuerza / cardio ---------------------------------------------
let captureMode = 'strength';
function setCaptureMode(mode) {
  captureMode = mode === 'cardio' ? 'cardio' : 'strength';
  document.querySelector('#strengthPanel').hidden = captureMode !== 'strength';
  document.querySelector('#cardioPanel').hidden = captureMode !== 'cardio';
  document.querySelectorAll('#captureMode button').forEach(b => {
    const on = b.dataset.mode === captureMode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on);
  });
  // El botón "Finalizar sesión" y el resumen en vivo son de fuerza: estorban en cardio.
  document.querySelector('#sessionTitle').textContent = captureMode === 'cardio'
    ? t('cardio.title')
    : t(sessions.some(s => s.id === activeSession?.id) ? 'session.editing' : 'session.current',
        { date: dateFmt(activeSession?.date || todayKey()) });
}

// --- Ficha para el LOG ------------------------------------------------------
// Misma forma que una sesión de fuerza para que la lista se lea homogénea, pero
// con sus propios datos y un distintivo de color.
function cardioCardHtml(c, open = false) {
  const meta = [dateFmt(c.date), t('cardio.minutes', { n: c.minutes })].join(' · ');
  const note = c.note ? `<div class="history-move"><span>${escapeHtml(c.note)}</span></div>` : '';
  const rpe = c.rpe ? `<div class="history-move"><span>${t('cardio.effort')}</span><small>${escapeHtml(rpeLabel(c.rpe))}</small></div>` : '';
  const body = note || rpe
    ? `<div class="history-moves">${rpe}${note}</div>`
    : `<div class="history-moves"><div class="history-move"><span>${t('cardio.noDetail')}</span></div></div>`;
  return `<details class="history-session is-cardio" data-cardio="${escapeHtml(c.id)}"${open ? ' open' : ''}>`
    + `<summary><div class="hs-id"><h4>${escapeHtml(c.activity)}</h4><time>${escapeHtml(meta)}</time></div>`
    + `<span class="hs-vol hs-cardio">${t('cardio.tag')}</span></summary>`
    + body
    + `<div class="hs-actions"><button class="secondary-button edit-cardio" data-id="${escapeHtml(c.id)}">${t('history.edit')}</button>`
    + `<button class="secondary-button danger-btn del-cardio" data-id="${escapeHtml(c.id)}">${t('cardio.delete')}</button></div></details>`;
}

// Los botones del LOG se recablean en cada repintado (el HTML se reescribe entero).
function wireCardioHistory(root = document) {
  root.querySelectorAll('.edit-cardio').forEach(b => b.onclick = () => editCardio(b.dataset.id));
  root.querySelectorAll('.del-cardio').forEach(b => b.onclick = () => deleteCardio(b.dataset.id));
}

// --- Estadísticas -----------------------------------------------------------
function cardioStats() {
  const minutes = cardio.reduce((tot, c) => tot + (c.minutes || 0), 0);
  const withRpe = cardio.filter(c => c.rpe);
  const week = cardio.filter(c => { const d = daysAgo(c.date); return d >= 0 && d <= 6; });
  return {
    count: cardio.length,
    minutes,
    weekMinutes: week.reduce((tot, c) => tot + (c.minutes || 0), 0),
    avgRpe: withRpe.length ? Math.round(withRpe.reduce((tot, c) => tot + c.rpe, 0) / withRpe.length * 10) / 10 : null,
    top: topCardioActivity(),
  };
}
function topCardioActivity() {
  const freq = new Map(), label = new Map();
  cardio.forEach(c => {
    const key = (c.activity || '').trim().toLowerCase();
    if (!key) return;
    freq.set(key, (freq.get(key) || 0) + (c.minutes || 0));
    if (!label.has(key)) label.set(key, c.activity.trim());
  });
  let best = null, top = 0;
  freq.forEach((mins, key) => { if (mins > top) { top = mins; best = key; } });
  return best ? { name: label.get(best), minutes: top } : null;
}

// Panel propio dentro de MÉTRICAS: el cardio no se mide en kilos, así que no
// cabe en el gráfico de fuerza.
function renderCardioStats() {
  const root = document.querySelector('#cardioStats');
  if (!root) return;
  if (!cardio.length) { root.innerHTML = `<p class="no-data">${t('cardio.noStats')}</p>`; return; }
  const s = cardioStats();
  const nf = n => n.toLocaleString(dateLocale());
  const tiles = [
    [t('cardio.stat.count'), nf(s.count)],
    [t('cardio.stat.minutes'), t('cardio.minutes', { n: nf(s.minutes) })],
    [t('cardio.stat.week'), t('cardio.minutes', { n: nf(s.weekMinutes) })],
    [t('cardio.stat.avgRpe'), s.avgRpe == null ? '—' : `${s.avgRpe}/10`],
    [t('cardio.stat.top'), s.top ? `${s.top.name} · ${t('cardio.minutes', { n: nf(s.top.minutes) })}` : '—'],
  ];
  root.innerHTML = tiles.map(([label, value]) =>
    `<article class="progress-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`).join('');
}

// Llamado por app.js en cada updateDashboard().
function renderCardio() {
  renderCardioForm();
  renderCardioStats();
}

// --- Autocompletado de la actividad -----------------------------------------
// El mismo panel propio que el nombre del movimiento, no un <datalist> nativo:
// su estilo lo pone el sistema operativo y desentonaba con el resto de la app.
function renderActivityAc() {
  const input = document.querySelector('#cardioActivity');
  const panel = document.querySelector('#cardioActivityPanel');
  const term = input.value.trim().toLowerCase();
  const items = cardioActivities().filter(a => a.toLowerCase().includes(term)).slice(0, 8);
  // Con la única coincidencia ya escrita entera el panel no aporta nada.
  if (!items.length || (items.length === 1 && items[0].toLowerCase() === term)) return closeActivityAc();
  panel.innerHTML = items.map(a => `<button type="button" class="ac-option" role="option">${escapeHtml(a)}</button>`).join('');
  panel.querySelectorAll('.ac-option').forEach(b => b.onclick = () => { input.value = b.textContent; closeActivityAc(); });
  panel.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}
function closeActivityAc() {
  document.querySelector('#cardioActivityPanel').hidden = true;
  document.querySelector('#cardioActivity').setAttribute('aria-expanded', 'false');
}

// --- Cableado (seguro en el arranque: no llama a nada de app.js) ------------
document.querySelectorAll('#captureMode button').forEach(b => b.onclick = () => setCaptureMode(b.dataset.mode));
const cardioActivityInput = document.querySelector('#cardioActivity');
cardioActivityInput.oninput = renderActivityAc;
cardioActivityInput.onfocus = renderActivityAc;
// El cierre se retrasa: sin margen, el blur mata el panel antes del click.
cardioActivityInput.onblur = () => setTimeout(closeActivityAc, 150);
cardioActivityInput.onkeydown = e => { if (e.key === 'Escape') closeActivityAc(); };
document.querySelector('#cardioSave').onclick = saveCardioEntry;
document.querySelector('#cardioCancel').onclick = resetCardioForm;
