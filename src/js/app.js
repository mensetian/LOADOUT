const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

// --- Diálogos con estilo (reemplazan alert/confirm nativos) ---
function openDialog(message, {okText='Aceptar', cancelText=null, danger=false, html=null, variant=''} = {}) {
  return new Promise(resolve => {
    const overlay=$('#modalOverlay'), okBtn=$('#modalOk'), cancelBtn=$('#modalCancel');
    if (html) $('#modalMessage').innerHTML = html; else $('#modalMessage').textContent = message;
    $('.modal-box', overlay).classList.toggle('is-pr', variant === 'pr');
    okBtn.textContent = okText; okBtn.classList.toggle('is-danger', danger);
    cancelBtn.hidden = !cancelText; if (cancelText) cancelBtn.textContent = cancelText;
    overlay.hidden = false; document.body.classList.add('modal-open');
    const cleanup = result => {
      overlay.hidden = true; document.body.classList.remove('modal-open');
      okBtn.onclick = null; cancelBtn.onclick = null; overlay.onclick = null;
      document.removeEventListener('keydown', onKey); resolve(result);
    };
    const onKey = e => { if (e.key === 'Escape') cleanup(false); };
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    overlay.onclick = e => { if (e.target === overlay) cleanup(false); };
    document.addEventListener('keydown', onKey);
    (cancelText && danger ? cancelBtn : okBtn).focus();
  });
}
function showAlert(message) { return openDialog(message); }
// Avisos que no piden nada: una franja abajo que se va sola. Antes cada
// "guardado" era un modal que había que cerrar con otro toque; los modales
// quedan para lo que exige decidir (confirmaciones y errores).
let toastTimer = null, toastHasAction = false;
function showToast(message, { action = null, onAction = null, ms = 3000 } = {}) {
  const el = $('#toast'), btn = $('#toastAction');
  clearTimeout(toastTimer);
  $('#toastMsg').textContent = message;
  toastHasAction = !!action;
  btn.hidden = !action; btn.textContent = action || '';
  btn.onclick = action ? () => { hideToast(); onAction?.(); } : null;
  el.hidden = false; el.classList.remove('is-in'); void el.offsetWidth; el.classList.add('is-in');
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() {
  const el = $('#toast'); if (!el || el.hidden) return;
  clearTimeout(toastTimer); toastHasAction = false;
  el.classList.remove('is-in');
  toastTimer = setTimeout(() => { el.hidden = true; }, 200); // deja terminar la salida
}
function showConfirm(message, opts = {}) { return openDialog(message, { okText: t('modal.confirm'), cancelText: t('modal.cancel'), ...opts }); }
const KEY = 'gymlog-sessions-v1';
const DRAFT_KEY = 'loadout-draft-v1';
let sessions = JSON.parse(localStorage.getItem(KEY) || '[]');
let activeSession = null;
let restoring = false; // evita reescribir el borrador mientras se pinta la sesión

// --- Dos documentos, dos listas --------------------------------------------
// CAPTURAR anota el entrenamiento de hoy; EDITAR corrige uno ya guardado. Antes
// compartían pantalla, variable y borrador, y "en cuál estoy" se deducía de si
// el id ya existía en el historial: un modo invisible que sobrevivía al cierre
// de la app y terminaba guardando el entrenamiento de hoy sobre el de otro día.
// Ahora son dos listas distintas y `editingSession` dice cuál se está tocando.
let editingSession = null;              // copia de la sesión guardada que se edita (solo en memoria)
const listEl = () => document.querySelector('#exerciseList');
const cards = () => $$('.exercise-card', listEl());
const emptyEl = () => document.querySelector('#sessionEmpty');
const save = () => localStorage.setItem(KEY, JSON.stringify(sessions));

// --- Borrados (lápidas) -----------------------------------------------------
// La fusión une por id, así que borrar y ya está no basta: el otro dispositivo
// aún la tiene y la siguiente fusión la revive. Por eso un borrado deja una
// "lápida" ({id: cuándo}) que sí viaja a Drive y dice "esto ya no existe".
//
// Si la entrada se editó DESPUÉS de la lápida, gana la edición: así volver a
// crear algo con el mismo id nunca queda enterrado por un borrado viejo.
const DELETED_KEY = 'loadout-deleted-v1';
const DELETED_TTL_DAYS = 180; // pasado ese plazo la lápida ya cumplió su función
let deletedIds = {};
try {
  const raw = JSON.parse(localStorage.getItem(DELETED_KEY) || '{}');
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) deletedIds = raw;
} catch {}
const saveDeleted = () => localStorage.setItem(DELETED_KEY, JSON.stringify(deletedIds));

function markDeleted(...ids) {
  const now = new Date().toISOString();
  for (const id of ids) if (id) deletedIds[id] = now;
  saveDeleted();
}

// Une dos juegos de lápidas quedándose con la marca más reciente de cada id, y
// descarta las que ya son demasiado viejas para que el archivo no crezca sin fin.
function mergeDeleted(local = {}, remote = {}) {
  const limit = new Date(Date.now() - DELETED_TTL_DAYS * 86400000).toISOString();
  const out = {};
  for (const [id, at] of [...Object.entries(remote), ...Object.entries(local)]) {
    if (typeof at !== 'string' || at < limit) continue;
    if (!out[id] || at > out[id]) out[id] = at;
  }
  return out;
}

// Quita de una lista lo que tenga una lápida posterior a su última edición.
function applyDeleted(list, stampOf, tombs = deletedIds) {
  return (list || []).filter(x => {
    const at = x?.id && tombs[x.id];
    return !at || stampOf(x) > at;
  });
}
// Lee un número aceptando coma o punto como separador decimal (teclados/locales ES).
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

// --- Unidades de carga (kg / lb) --------------------------------------------
// Internamente TODO se guarda en kilos, siempre. La unidad solo cambia lo que se
// muestra y lo que se teclea, así cambiarla no reescribe ni falsea el historial.
const UNIT_KEY = 'loadout-unit';
const LB_PER_KG = 2.2046226218;
const unit = () => localStorage.getItem(UNIT_KEY) === 'lb' ? 'lb' : 'kg';
const toUnit = (kg, u) => u === 'lb' ? Math.round(kg * LB_PER_KG * 10) / 10 : kg;
const fromUnit = (v, u) => u === 'lb' ? Math.round(v / LB_PER_KG * 1000) / 1000 : v;
const toDisplay = kg => toUnit(kg, unit());
const fromDisplay = v => fromUnit(v, unit());
// Etiqueta de la unidad; `showW` formatea una carga en kg lista para pintar.
const unitLabel = () => unit();
const showW = kg => `${toDisplay(kg)} ${unitLabel()}`;

// --- Plantillas de rutina ---------------------------------------------------
// Una plantilla es un plan fijo (día A/B/C): nombre + movimientos con sus series
// objetivo. Vive aparte del historial: las sesiones son lo que hiciste, las
// plantillas lo que piensas hacer.
const TEMPLATES_KEY = 'loadout-templates-v1';
let templates = [];
try { const raw = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]'); if (Array.isArray(raw)) templates = raw; } catch {}
const saveTemplates = () => localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
function makeTemplate(name, exercises) {
  return { id: crypto.randomUUID(), name, exercises, updatedAt: new Date().toISOString() };
}
// Las plantillas también se fusionan por id al sincronizar; gana la más reciente.
function mergeTemplates(local, remote) {
  const byId = new Map();
  for (const x of [...(remote || []), ...(local || [])]) {
    if (!x?.id) continue;
    const prev = byId.get(x.id);
    if (!prev || (x.updatedAt || '') >= (prev.updatedAt || '')) byId.set(x.id, x);
  }
  return [...byId.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

// --- Borrador de la sesión en curso -----------------------------------------
// Guarda todo lo tecleado (aunque esté a medias) para no perderlo al recargar.
function collectDraft() {
  const exercises = cards().map(card => ({
    name: $('.exercise-name', card).value,
    sets: $$('.set-row', card).map(r => {
      const set = { weight: $('.set-weight', r).value, reps: $('.set-reps', r).value };
      if (r.dataset.targetWeight != null) set.targetWeight = num(r.dataset.targetWeight);
      if (r.dataset.targetReps != null) set.targetReps = num(r.dataset.targetReps);
      if (r.dataset.targetFor) set.targetFor = r.dataset.targetFor;
      return set;
    }),
  }));
  // `_draft` marca que los pesos son texto tal cual se tecleó (no kg), y `_unit`
  // en qué unidad se escribieron, para reinterpretarlos bien al restaurar.
  return { ...activeSession, name: $('#sessionName').value, date: $('#sessionDate').value || activeSession?.date, exercises, _draft: true, _unit: unit() };
}
function draftHasContent(d) { return !!d && Array.isArray(d.exercises) && d.exercises.some(e => (e.name || '').trim() || e.sets?.some(s => s.weight || s.reps)); }
function saveDraft() {
  if (restoring || editingSession || !activeSession) return; // editar nunca toca el borrador de hoy
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...collectDraft(), _savedAt: new Date().toISOString() }));
  renderLiveSummary();
  window.driveDraftChanged?.(); // sube el entrenamiento en curso, sin esperar al final
}
function clearDraft() { localStorage.removeItem(DRAFT_KEY); }
const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; } };
// ¿Hay un entrenamiento abierto ahora mismo en pantalla? Lo consulta la fusión
// antes de reiniciar la captura, para no borrar series a medio anotar.
// Haber elegido otro día también es trabajo en curso, aunque todavía no haya
// series: el orden natural es fecha primero, y una sincronización que caía al
// volver del selector de fecha reiniciaba la sesión y la devolvía a hoy.
const draftInProgress = () => { try { return !!activeSession && (!!activeSession._datePicked || draftHasContent(collectDraft())); } catch { return false; } };

// Reconcilia el entrenamiento en curso con el que venga de Drive. Regla dura:
// nunca pisa trabajo que esté abierto aquí; solo rellena cuando este dispositivo
// no tiene nada a medias. Devuelve true si cambió algo.
// Un borrador cuyo id ya está en el historial no es trabajo a medias: es una
// sesión terminada de la que quedó una copia dando vueltas.
const yaGuardada = d => !!d?.id && sessions.some(s => s.id === d.id);
function syncDraft(remote) {
  const local = readDraft();
  // Se terminó en otro dispositivo: el borrador de aquí ya es historia.
  if (yaGuardada(local)) {
    clearDraft();
    if (activeSession?.id === local.id) { activeSession = makeSession(); renderActiveSession(); }
    return true;
  }
  // El respaldo remoto sigue trayendo el borrador de una sesión que YA se
  // terminó: es un eco, no trabajo pendiente. Antes se restauraba tal cual y la
  // app pedía terminar un entrenamiento que estaba guardado desde hacía días.
  // (La subida que viene detrás de la fusión deja el remoto sin borrador.)
  if (yaGuardada(remote)) return false;
  if (!draftHasContent(remote) || draftHasContent(local)) return false;
  if (local?._savedAt && remote._savedAt && remote._savedAt <= local._savedAt) return false;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(remote));
  activeSession = remote;
  renderActiveSession();
  return true;
}
const dateFmt = d => new Intl.DateTimeFormat(dateLocale(), {day:'numeric', month:'short', year:'numeric'}).format(new Date(d+'T12:00'));
// Sin año: la referencia de la tarjeta es de hace días o semanas, nunca de otro año.
// Con día de la semana: "MIÉ 23 SEPT". Es lo que se busca en la franja semanal.
const dateWeekday = d => new Intl.DateTimeFormat(dateLocale(), {weekday:'short', day:'numeric', month:'short'})
  .format(new Date(d+'T12:00')).replace(/,/g,'').replace(' de ', ' ').toUpperCase();
const dateShort = d => new Intl.DateTimeFormat(dateLocale(), {day:'numeric', month:'short'})
  .format(new Date(d+'T12:00')).replace(' de ', ' '); // "24 de ago" -> "24 ago"
// Fecha local (no UTC): con toISOString por la noche saltaba al día siguiente.
const keyOf = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const todayKey = () => keyOf(new Date());

function makeSession() { return { id: crypto.randomUUID(), date: todayKey(), name: '', exercises: [] }; }
function exerciseNames() { return [...new Set(sessions.flatMap(s=>s.exercises.map(e=>e.name.trim())).filter(Boolean))].sort((a,b)=>a.localeCompare(b)); }
function refreshDatalists() { $('#exerciseNames').innerHTML=exerciseNames().map(n=>`<option value="${escapeHtml(n)}">`).join(''); }

// --- Selector de rutina -----------------------------------------------------
// Una rutina por nombre, con la fecha en que la hiciste por última vez.
function routineSummaries() {
  const map = new Map();
  [...sessions].sort((a,b)=>b.date.localeCompare(a.date)).forEach(s=>{
    const name=(s.name||'').trim(); if(!name) return;
    const key=name.toLowerCase();
    if(!map.has(key)) map.set(key,{name, date:s.date, moves:s.exercises.length, times:0});
    map.get(key).times++;
  });
  return [...map.values()].sort((a,b)=>b.date.localeCompare(a.date));
}
function daysAgoLabel(dateKey) {
  const days=Math.round((new Date(todayKey()+'T12:00')-new Date(dateKey+'T12:00'))/86400000);
  if(days<=0) return t('routine.today');
  if(days===1) return t('routine.yesterday');
  if(days<7) return t('routine.daysAgo',{n:days});
  if(days<14) return t('routine.weekAgo');
  if(days<31) return t('routine.weeksAgo',{n:Math.floor(days/7)});
  const months=Math.floor(days/30);
  return months===1 ? t('routine.monthAgo') : t('routine.monthsAgo',{n:months});
}
// Una rutina es una sola cosa. Puede estar fijada (📌), y entonces sus
// movimientos son un plan que tú decides y que no cambia solo; si no lo está,
// se deduce de la última vez que la entrenaste. Antes eran dos listas
// separadas —PLANTILLAS y RECIENTES— con dos botones distintos de "cargar", y
// desde fuera nadie distinguía cuál usar: el resultado era el mismo casi
// siempre. Fijar es ahora una propiedad de la rutina, no otro tipo de objeto.
const planFor = name => templates.find(x=>(x.name||'').trim().toLowerCase()===(name||'').trim().toLowerCase());
// Fusiona lo planeado con lo entrenado en una lista sola, sin repetir nombres.
// Tener plan guardado ya distingue una rutina de un nombre suelto del historial:
// por eso van primero y no hace falta marcarlas con nada. Hubo una chincheta
// para esto y sobraba — el pin apagado parecía un botón roto, y cobraba ruido
// en cada fila por una acción que se usa una vez al mes.
function routineEntries(filter='') {
  const term=filter.trim().toLowerCase();
  const byKey=new Map();
  for (const tpl of templates) {
    const name=(tpl.name||'').trim(); if(!name) continue;
    byKey.set(name.toLowerCase(), {name, planned:true, tplId:tpl.id, moves:(tpl.exercises||[]).length});
  }
  for (const r of routineSummaries()) {
    const key=r.name.toLowerCase(); const prev=byKey.get(key);
    if(prev) Object.assign(prev, {date:r.date, times:r.times});
    else byKey.set(key, {...r, planned:false});
  }
  return [...byKey.values()]
    .filter(r=>r.name.toLowerCase().includes(term))
    .sort((a,b)=> (b.planned-a.planned) || (b.date||'').localeCompare(a.date||'') || a.name.localeCompare(b.name));
}
// El detalle dice cuántos movimientos tiene y cuándo la hiciste. Sin plan, no
// hay número de movimientos que prometer: solo lo que quedó registrado.
function routineMeta(r) {
  const when = r.date ? daysAgoLabel(r.date) : '';
  if(!r.planned) return when ? `${when} · ${r.moves} ${t('routine.moves')} · ${r.times} ${r.times===1?t('routine.time'):t('routine.times')}` : '';
  const moves=`${r.moves} ${t('routine.moves')}`;
  return when ? `${moves} · ${when}` : `${moves} · ${t('routine.neverTrained')}`;
}
function renderRoutinePanel(filter='') {
  const items=routineEntries(filter);
  const panel=$('#routinePanel');
  if(!items.length){
    panel.innerHTML=`<p class="routine-empty">${sessions.some(s=>(s.name||'').trim())
      ? t('routine.empty.some')
      : t('routine.empty.none')}</p>`;
    return;
  }
  panel.innerHTML=items.map(r=>`<button type="button" class="routine-option" role="option" data-name="${escapeHtml(r.name)}"><span class="routine-option-name">${escapeHtml(r.name)}</span><span class="routine-option-meta">${routineMeta(r)}</span></button>`).join('');
  $$('.routine-option',panel).forEach(b=>b.onclick=()=>openRoutine(b.dataset.name));
}
// Abrir una rutina carga sus movimientos, venga el plan de estar guardado o de
// la última sesión. Un solo gesto, un solo resultado: por eso desapareció el
// botón "Cargar rutina anterior", que hacía justo esto pero por otro camino.
async function openRoutine(name) {
  const tpl=planFor(name);
  if(tpl) return applyTemplate(tpl.id);
  const prev=lastSessionByRoutine(name);
  closeRoutinePanel();
  if(!prev){ pickRoutine(name); return; }
  if(listEl().children.length && !(await showConfirm(t('routine.loadConfirm'), {danger:true, okText:t('routine.loadOk')}))) return;
  $('#sessionName').value=name; if(activeSession) activeSession.name=name;
  listEl().innerHTML=''; if(emptyEl()) emptyEl().hidden=true;
  // Se cargan colapsados: solo trabajas uno a la vez, lo abres cuando te toca.
  // La rutina pone la estructura (qué movimientos, cuántas series); los números
  // salen de tu ÚLTIMA vez con cada movimiento, aunque fuera en otra rutina.
  // Antes salían de la última vez que hiciste ESTA rutina, y la columna ANT.
  // (la última vez real) mostraba otra cosa que lo que estampaba el toque.
  prev.exercises.forEach(e=>{
    const last=getLastExercise(e.name);
    addExercise({name:e.name, sets:e.sets.map((s,i)=>{
      const ref=last?.sets?.[i] ?? last?.sets?.at(-1) ?? s;
      return {targetWeight:ref.weight, targetReps:ref.reps, targetFor:exKey(e.name)};
    })});
  });
  openFirstPending();
  if(!listEl().children.length)if(emptyEl()) emptyEl().hidden=false;
  saveDraft();
}
function openRoutinePanel() {
  renderRoutinePanel($('#sessionName').value);
  $('#routinePanel').hidden=false; $('#sessionName').setAttribute('aria-expanded','true');
}
function closeRoutinePanel() {
  $('#routinePanel').hidden=true; $('#sessionName').setAttribute('aria-expanded','false');
}
function pickRoutine(name) {
  $('#sessionName').value=name;
  if(activeSession) activeSession.name=name;
  closeRoutinePanel();
}
// Cargar una plantilla llena la sesión con sus movimientos colapsados y sus
// pesos previstos como marca a superar, igual que "cargar rutina anterior".
async function applyTemplate(id) {
  const tpl=templates.find(x=>x.id===id); if(!tpl) return;
  closeRoutinePanel();
  if(listEl().children.length && !(await showConfirm(t('routine.loadConfirm'), {danger:true, okText:t('routine.loadOk')}))) return;
  $('#sessionName').value=tpl.name; if(activeSession) activeSession.name=tpl.name;
  listEl().innerHTML=''; if(emptyEl()) emptyEl().hidden=true;
  // El plan aporta solo estructura: qué movimientos, cuántas series, cuántas
  // reps. El peso a superar sale siempre de la última sesión.
  (tpl.exercises||[]).forEach(e=>{
    const last=getLastExercise(e.name);
    addExercise({name:e.name, sets:(e.sets||[]).map((s,i)=>{
      const set={targetFor:exKey(e.name)};
      // Si el plan trae más series que tu última vez, las de más repiten tu
      // última carga: una serie planeada sin peso no sugiere nada útil.
      const w = (last?.sets?.[i] ?? last?.sets?.at(-1))?.weight;
      if (w != null) set.targetWeight = w;
      const reps = last?.sets?.[i]?.reps ?? s.reps;
      if (reps != null) set.targetReps = reps;
      return set;
    })});
  });
  openFirstPending();
  if(!listEl().children.length) if(emptyEl()) emptyEl().hidden=false;
  saveDraft();
}
// Guardar el plan de una rutina a partir de lo que hay en pantalla. Ya no hay
// botón para esto en CAPTURAR: crear y editar planes vive en la pestaña
// RUTINAS, porque mientras anotas lo de hoy no estás pensando en el plan.
function saveRoutinePlan(name, exercises) {
  const existing=planFor(name);
  if(existing) Object.assign(existing, {name:name.trim(), exercises, updatedAt:new Date().toISOString()});
  else templates.push(makeTemplate(name.trim(), exercises));
  saveTemplates(); window.renderConfig?.(); window.renderRoutines?.(); window.driveAutoSync?.();
}
// --- Primer arranque --------------------------------------------------------
// Una app de registro vacía no explica nada por sí sola: hasta que haya algo
// guardado, la pantalla vacía enseña los tres pasos y ofrece un plan de ejemplo.
function exampleTemplateSeed() {
  const reps=(r,n=3)=>Array.from({length:n},()=>({reps:r}));
  return { name:t('example.name'), exercises:[
    { name:t('example.squat'), sets:reps(5) },
    { name:t('example.bench'), sets:reps(5) },
    { name:t('example.row'),   sets:reps(8) },
  ]};
}
async function loadExampleRoutine() {
  const seed=exampleTemplateSeed();
  const tpl=makeTemplate(seed.name, seed.exercises);
  templates.push(tpl); saveTemplates();
  await applyTemplate(tpl.id);
  renderOnboarding(); window.renderConfig?.();
}
function renderOnboarding() {
  const el=$('#onboarding'); if(!el) return;
  el.hidden = sessions.length>0 || templates.length>0 || cardio.length>0;
}
async function deleteTemplate(id) {
  const tpl=templates.find(x=>x.id===id); if(!tpl) return;
  if(!(await showConfirm(t('template.deleteConfirm',{name:tpl.name}), {danger:true, okText:t('template.deleteOk')}))) return;
  markDeleted(id);
  templates=templates.filter(x=>x.id!==id);
  saveTemplates(); window.renderConfig?.(); window.driveAutoSync?.();
}
// Navegación con flechas para escritorio.
function moveRoutineHighlight(step) {
  const options=$$('.routine-option'); if(!options.length) return;
  const current=options.findIndex(o=>o.classList.contains('is-active'));
  const next=(current+step+options.length)%options.length;
  options.forEach(o=>o.classList.remove('is-active'));
  options[next].classList.add('is-active');
  options[next].scrollIntoView({block:'nearest'});
}
// Clave con la que se reconoce un movimiento entre sesiones. Antes era el nombre
// exacto, y bastaba escribir "Curl mancuernas" en vez de "Curl con mancuernas"
// para que la app lo tratara como un ejercicio nuevo: sin referencia, sin ANT.,
// sin récord, y con la duda de siempre otra vez. Se ignoran acentos, plurales y
// palabras de relleno; lo demás se respeta, así "press banca" y "press banca
// inclinado" siguen siendo movimientos distintos.
const FILLER = new Set(['con','de','del','la','el','los','las','en','a','al','y','sobre','para','un','una','with','the','of']);
function exKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // fuera acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')                        // guiones y signos
    .split(/\s+/)
    .filter(w => w && !FILLER.has(w))
    .map(w => w.length > 3 ? w.replace(/([^s])e?s$/, '$1') : w) // plural simple, sin tocar "press"
    .join(' ');
}
// Sesiones que pueden servir de "la última vez", de la más reciente a la más
// vieja. Dos detalles que antes fallaban: con dos sesiones el mismo día ganaba
// la primera que se guardó (ahora desempata la edición más reciente), y al
// anotar un día pasado la referencia salía de un entrenamiento POSTERIOR a ese
// día. La referencia es siempre lo anterior a la fecha que estás anotando.
function refSessions() {
  const upTo = activeSession?.date || todayKey();
  return sessions.filter(s => s.id !== activeSession?.id && s.date <= upTo)
    .sort((a,b) => b.date.localeCompare(a.date) || (b.updatedAt||'').localeCompare(a.updatedAt||''));
}
function lastSessionByRoutine(name) { const key=name.trim().toLowerCase(); if(!key) return null; return refSessions().find(s=>(s.name||'').trim().toLowerCase()===key)||null; }
function getLastExercise(name) {
  const key = exKey(name); if (!key) return null;
  return refSessions().flatMap(s=>s.exercises.map(e=>({...e,date:s.date}))).find(e=>exKey(e.name)===key && e.sets?.length);
}
// Una serie sin carga (dominadas, fondos) se escribe "×12", no "0×12": el 0
// hacía leer un dato real como si faltara.
// Recibe el peso YA en la unidad de pantalla, no en kg.
const pairLabel = (w, reps) => w ? `${w}×${reps}` : `×${reps}`;
// Peso máximo histórico del ejercicio (kg). Es contexto, no objetivo: la marca
// a superar para sobrecarga progresiva es la última sesión, no el récord.
function maxWeightFor(name) {
  const key = exKey(name); if (!key) return 0;
  return Math.max(0, ...sessions.filter(s => s.id !== activeSession?.id).flatMap(s => s.exercises.filter(e => exKey(e.name) === key)).flatMap(e => e.sets.map(x => x.weight)));
}
// --- Sobrecarga progresiva --------------------------------------------------
// Doble progresión, en su versión prudente: se propone subir SOLO cuando la
// carga ya está consolidada, no apenas se completa una vez. Las tres pruebas:
//   1. Las dos últimas sesiones del movimiento usaron la misma carga de trabajo
//      (la más alta). Si la última ya fue una subida, primero se consolida: así
//      nunca se proponen dos subidas seguidas.
//   2. En la última, con esa carga, ninguna serie perdió repeticiones frente a
//      la sesión anterior, y no hizo menos series.
//   3. Las series salieron parejas (ninguna cayó más de 1 rep por debajo de la
//      primera): 10·8·6 es llegar al fallo, no dominar la carga.
// Y no se propone si la última vez fue hace más de 3 semanas: tras un parón lo
// sensato es repetir, no subir.
// Solo AVISA que toca subir, no dice a cuánto: el salto depende de los discos y
// mancuernas de cada gimnasio y de cómo te sentís, y eso lo decide quien entrena.
// Devuelve la carga de trabajo (`w`, 0 si es sin carga) o null.
const PROGRESS_MAX_GAP_DAYS = 21;
function progressionFor(name) {
  const key = exKey(name); if (!key) return null;
  const hist = refSessions()
    .map(s => ({ date: s.date, e: s.exercises.find(e => exKey(e.name) === key && e.sets?.length) }))
    .filter(x => x.e).slice(0, 2);
  if (hist.length < 2) return null;
  const [last, before] = hist;
  const gap = Math.round((new Date((activeSession?.date || todayKey()) + 'T12:00') - new Date(last.date + 'T12:00')) / 86400000);
  if (gap > PROGRESS_MAX_GAP_DAYS) return null;
  const top = e => Math.max(0, ...e.sets.map(x => x.weight || 0));
  const w = top(last.e);
  if (w !== top(before.e)) return null;
  const work = e => e.sets.filter(x => (x.weight || 0) === w).map(x => x.reps || 0);
  const now = work(last.e), prev = work(before.e);
  if (!now.length || now.length < prev.length) return null;
  if (now.some((r, i) => r < (prev[i] ?? prev.at(-1)))) return null;
  if (!now[0] || Math.min(...now) < now[0] - 1) return null;
  return { w };
}
// Todo lo que la tarjeta necesita saber del historial de un movimiento.
const refFor = name => ({ last: getLastExercise(name), prog: progressionFor(name) });
// Refresca las dos referencias de la tarjeta: la línea "última vez · récord" y
// la columna ANT. de cada serie (misma serie de la última sesión). La columna
// vive fuera del placeholder para que no desaparezca al escribir.
function updateLast(card) {
  const name = $('.exercise-name', card).value;
  const ref = refFor(name), e = ref.last, p = ref.prog;
  const pr = maxWeightFor(name);
  // La última vez es la marca a superar hoy, así que es lo primero que se lee
  // de la tarjeta: cuándo fue y cada serie como una ficha, no una línea gris de
  // 10px. El récord va al costado, como contexto.
  const box = $('.last-time', card);
  box.classList.toggle('is-empty', !e);
  box.classList.toggle('is-up', !!(e && p));
  $('.lt-label', card).textContent = t('exercise.lastLabel');
  $('.lt-when', card).textContent = e ? `${daysAgoLabel(e.date)} · ${dateShort(e.date)}` : '';
  const prEl = $('.lt-pr', card);
  prEl.hidden = !pr;
  prEl.textContent = pr ? t('exercise.prShort', { w: showW(pr) }) : '';
  // Con subida recomendada, las series de trabajo (las que tocaría subir) se marcan.
  $('.lt-sets', card).innerHTML = e ? e.sets.map(x =>
    `<span class="lt-set${p && (x.weight || 0) === p.w ? ' is-work' : ''}">${escapeHtml(pairLabel(toDisplay(x.weight), x.reps))}</span>`).join('') : '';
  const hint = $('.lt-hint', card);
  hint.hidden = !!e;
  hint.textContent = e ? '' : t('exercise.noLast');
  // Avisa que toca subir y por qué, sin proponer un número: el peso lo elegís vos.
  const upEl = $('.lt-up', card);
  upEl.hidden = !p;
  upEl.innerHTML = p ? `<b>${escapeHtml(t(p.w ? 'exercise.progressLoad' : 'exercise.progressReps'))}</b><small>${escapeHtml(t('exercise.progressWhy'))}</small>` : '';
  // Sin serie anterior en esa posición, la columna muestra el objetivo de la
  // fila (heredado de la serie de arriba o de la plantilla) marcado con "→",
  // para que el plan siga a la vista sin meterse dentro del campo.
  $$('.set-row', card).forEach(r => paintSuggestion(card, r, ref));
  refreshDupes();
}
// Lo que la app propone para una serie, y lo MISMO que se escribe al aceptarla.
// Antes eran dos cosas: la columna ANT. mostraba tu última sesión y el toque
// estampaba el objetivo de la rutina, así que un mismo gesto daba números que
// no estaban a la vista. Manda lo que hiciste en esa serie la última vez; si ese
// día hubo menos series, el objetivo de la fila. Pesos en kg. Si toca subir, la
// serie de trabajo se marca (`up`) pero conserva sus números: la app no elige
// el peso nuevo.
function suggestionFor(card, r, ref = refFor($('.exercise-name', card).value)) {
  const s = ref.last?.sets?.[$$('.set-row', card).indexOf(r)];
  if (s) {
    const w = s.weight || 0, reps = s.reps || 0, p = ref.prog;
    // Solo se marcan las series de trabajo: el calentamiento y las de descarga
    // (más livianas) no son las que toca subir.
    return { w, reps, prev: true, up: !!p && w === p.w };
  }
  const g = rowTarget(r, exKey($('.exercise-name', card).value));
  if (!g) return null;
  // Una serie de más que la rutina trae con tu carga de trabajo (objetivo
  // salido del historial) se marca igual que las demás.
  const p = ref.prog;
  return { ...g, prev: false, up: !!p?.w && !!r.dataset.targetFor && g.w === p.w };
}
// La columna ANT. es a la vez la referencia y el botón para usarla: mientras la
// serie está vacía se ve como algo que se toca; ya anotada, queda solo como dato.
function paintSuggestion(card, r, ref) {
  const sg = suggestionFor(card, r, ref), el = $('.set-prev', r);
  const empty = !String($('.set-weight', r).value).trim() && !String($('.set-reps', r).value).trim();
  el.classList.toggle('is-goal', !!sg && !sg.prev);
  el.classList.toggle('is-up', !!sg?.up);
  el.classList.toggle('is-action', !!sg && empty);
  el.disabled = !sg || !empty;
  // El corte invisible antes de × deja partir "132.3×8" en dos líneas en vez de
  // recortarlo: es el número que se va a escribir, tiene que leerse entero.
  // La flecha va DESPUÉS del número: "60×8 ↑" es "hiciste esto, toca subir";
  // delante se leía como "subí a 60×8".
  const mark = sg && !sg.prev ? '→ ' : '';
  el.textContent = sg ? mark + pairLabel(toDisplay(sg.w), sg.reps).replace('×', '​×') + (sg.up ? ' ↑' : '') : (ref.last ? '—' : '');
}
// Aceptar la sugerencia: solo rellena lo vacío, lo tecleado a mano siempre manda.
function applySuggestion(card, r) {
  const sg = suggestionFor(card, r); if (!sg) return;
  const wIn = $('.set-weight', r), rIn = $('.set-reps', r);
  if (!String(wIn.value).trim() && sg.w) wIn.value = toDisplay(sg.w); // 0 = corporal: no se estampa
  if (!String(rIn.value).trim() && sg.reps) rIn.value = sg.reps;
}
// Al nombrar a mano un movimiento que ya hiciste, la tarjeta toma las series
// que hiciste esa vez (vacías, con su sugerencia al lado): antes arrancaba
// siempre con una y había que acordarse de cuántas iban. Solo crece, y solo
// si no anotaste nada todavía. Se evalúa al elegir o dejar el nombre, no por
// tecla: escribiendo "Remo con barra" se pasa por "Remo" y crecería a destiempo.
function matchLastSetCount(card) {
  const key = exKey($('.exercise-name', card).value);
  if (!key || card.dataset.sizedFor === key) return;
  card.dataset.sizedFor = key;
  const rows = $$('.set-row', card);
  if (rows.some(r => String($('.set-weight', r).value).trim() || String($('.set-reps', r).value).trim())) return;
  const n = getLastExercise($('.exercise-name', card).value)?.sets?.length || 0;
  for (let i = rows.length; i < n; i++) addSet(card);
  updateLast(card);
}
// Avisa cuando el mismo movimiento quedó dos veces en la sesión: pasa al
// agregarlo a mano sin ver que la rutina ya lo traía más abajo, plegado.
function refreshDupes() {
  const list = cards();
  const seen = new Map();
  const keyOf = c => exKey($('.exercise-name', c).value);
  list.forEach(c => { const k = keyOf(c); if (k) seen.set(k, (seen.get(k) || 0) + 1); });
  list.forEach(c => {
    const k = keyOf(c), dup = !!k && seen.get(k) > 1;
    c.classList.toggle('is-dup', dup);
    // attr() lee del elemento del pseudo, así que el aviso va en los dos.
    const label = dup ? t('exercise.dup') : '';
    $('.last-time', c).dataset.dup = label;
    $('.exercise-summary', c).dataset.dup = label;
  });
}
// `values.weight`/`values.reps` llegan listos para pintar (ya en la unidad
// activa). `targetWeight` es la marca a superar y va SIEMPRE en kg: se guarda en
// el dataset para sobrevivir a una recarga y a un cambio de unidad.
function addSet(card, values = {}) {
  const node = $('#setTemplate').content.firstElementChild.cloneNode(true);
  const wIn = $('.set-weight',node), rIn = $('.set-reps',node);
  wIn.value = values.weight ?? ''; rIn.value = values.reps ?? '';
  if (values.targetWeight != null) node.dataset.targetWeight = values.targetWeight;
  if (values.targetReps != null) node.dataset.targetReps = values.targetReps;
  if (values.targetFor) node.dataset.targetFor = values.targetFor;
  // El placeholder lleva SOLO la unidad, nunca números. Con "60 kg" en gris
  // dentro del campo la gente creía que ya lo había escrito, o que dejarlo así
  // contaba. El objetivo vive fuera del campo (columna ANT.) y se estampa con
  // un toque en el número. El peso es opcional en toda serie: una serie sin
  // carga es solo eso, no hay "modo peso corporal" que adivinar.
  wIn.placeholder = unitLabel();
  rIn.placeholder = t('set.repsPlaceholder');
  $('.remove-set',node).title = t('set.removeTitle');
  // Serie hecha = serie con valores. Un toque en el nº estampa el objetivo
  // (placeholder o última sesión): "hice lo previsto" cuesta un solo gesto.
  // Solo rellena lo vacío — lo tecleado a mano siempre manda.
  // Una serie está hecha cuando tiene repeticiones: es la unidad de trabajo.
  // El peso acompaña cuando hay carga (y entonces se anota), pero no se exige.
  const syncFilled = () => {
    node.classList.toggle('is-filled', !!String(rIn.value).trim());
    refreshReady(card);
    if (node.isConnected) paintSuggestion(card, node, refFor($('.exercise-name',card).value));
  };
  wIn.addEventListener('input', syncFilled); rIn.addEventListener('input', syncFilled);
  // Lo tecleado cuenta como serie completada al salir del campo (o con "Listo"),
  // no con el primer dígito: si no, el descanso arrancaba a mitad de escribir.
  let filledAtFocus = false;
  const noteFocus = () => { filledAtFocus = node.classList.contains('is-filled'); };
  wIn.addEventListener('focus', noteFocus); rIn.addEventListener('focus', noteFocus);
  rIn.addEventListener('change', () => {
    const now = node.classList.contains('is-filled');
    if (now && !filledAtFocus) onSetDone(node);
    filledAtFocus = now;
  });
  // El teclado numérico muestra "Siguiente" en el peso (salta a reps) y "Listo"
  // en las reps (cierra el teclado, y eso completa la serie).
  wIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); rIn.focus(); } });
  rIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); rIn.blur(); } });
  // Dos lugares aceptan la sugerencia: el nº de serie y la propia columna ANT.,
  // que es donde está el número que se va a escribir.
  const accept = () => {
    const was = node.classList.contains('is-filled');
    applySuggestion(card, node); syncFilled(); saveDraft();
    if (!was && node.classList.contains('is-filled')) onSetDone(node);
  };
  const numBtn = $('.set-number',node), prevBtn = $('.set-prev',node);
  numBtn.title = t('set.confirmTitle');
  prevBtn.title = t('set.useSuggestion');
  numBtn.onclick = accept;
  prevBtn.onclick = accept;
  $('.set-rows',card).append(node); refreshSetNumbers(card); syncFilled();
  // Borrar sigue siendo instantáneo, pero una serie con datos se puede recuperar
  // unos segundos: la × está al lado de las reps y el dedo se equivoca.
  const afterRemove = () => { refreshSetNumbers(card); refreshReady(card); updateLast(card); saveDraft(); };
  $('.remove-set',node).onclick = () => {
    const box = node.parentElement, after = node.nextSibling;
    const hadData = String(wIn.value).trim() || String(rIn.value).trim();
    node.remove(); afterRemove();
    if (hadData) showToast(t('set.removed'), { action: t('toast.undo'), ms: 5000, onAction: () => {
      box.insertBefore(node, after?.parentElement === box ? after : null); afterRemove();
    }});
  };
}
const REORDER_HINT_KEY = 'loadout-reorder-hint';
function hintReorderDone() { localStorage.setItem(REORDER_HINT_KEY, 'off'); $('#reorderHint')?.remove(); }
function paintReorderHint() {
  const list = $('#exerciseList');
  if (!list) return;
  $('#reorderHint')?.remove();
  if (localStorage.getItem(REORDER_HINT_KEY) === 'off') return;
  if ($$('.exercise-card.is-collapsed', list).length < 2) return;
  list.insertAdjacentHTML('beforebegin', `<p class="reorder-hint" id="reorderHint">${t('exercise.reorderHint')}</p>`);
}
function refreshSetNumbers(card) { $$('.set-number',card).forEach((n,i)=>n.textContent=`${String(i+1).padStart(2,'0')}`); }
// Estados derivados de los datos, nunca marcados a mano: `is-ready` (todas las
// series con valores → el botón PLEGAR se enciende) e `is-done` (alguna serie
// con valores → el movimiento cuenta como trabajado). Sin estado manual no
// existe el movimiento "hecho" sin nada registrado.
function refreshReady(card) {
  const rows = $$('.set-row', card);
  card.classList.toggle('is-ready', rows.length > 0 && rows.every(r => r.classList.contains('is-filled')));
  card.classList.toggle('is-done', rows.some(r => String($('.set-weight',r).value).trim() || String($('.set-reps',r).value).trim()));
  if (card.classList.contains('is-ready')) paintNext(card);
}
const AUTOREST_KEY = 'loadout-autorest';
// Serie recién completada (sin reps → con reps). La app contesta: un pop en el
// nº, una vibración corta y, si está activo, arranca el descanso, que es lo que
// viene después de cada serie y ya no cuesta un toque aparte. En un día pasado
// no hay descanso que medir: se está pasando en limpio.
function onSetDone(row) {
  const n = $('.set-number', row);
  n.classList.remove('just-filled'); void n.offsetWidth; n.classList.add('just-filled');
  if (navigator.vibrate && localStorage.getItem('loadout-vibrate') !== 'off') navigator.vibrate(10);
  if (localStorage.getItem(AUTOREST_KEY) === 'off' || activeSession?.date !== todayKey()) return;
  startRest();
  const timer = $('#restTimer');
  timer.classList.remove('just-started'); void timer.offsetWidth; timer.classList.add('just-started');
}
// El siguiente movimiento que falta: primero hacia abajo, después desde arriba.
function nextPending(card) {
  const list = cards(), i = list.indexOf(card);
  const pending = c => c !== card && !c.classList.contains('is-ready');
  return list.slice(i + 1).find(pending) || list.slice(0, Math.max(i, 0)).find(pending) || null;
}
// Al completar un movimiento aparece, al pie, a dónde ir: el siguiente por su
// nombre o, si ya no falta nada, finalizar. Antes había que plegar con la flecha
// y buscar el próximo a mano. No avanza solo: podías querer una serie extra.
function paintNext(card) {
  const btn = $('.next-exercise', card); if (!btn) return;
  const next = nextPending(card), name = next && $('.exercise-name', next).value.trim();
  btn.textContent = !next ? `${t('session.finish')} ↗`
    : name ? t('exercise.next', { name: name.toUpperCase() }) : t('exercise.nextUnnamed');
}
// Resumen compacto que se muestra cuando el movimiento está colapsado/terminado.
function exerciseSummaryText(card) {
  // El resumen solo afirma lo tecleado: al guardar, las series vacías se
  // descartan, así que mostrarlas como hechas era prometer algo que no queda.
  // Sin nada tecleado se muestra el plan, pero nombrado como objetivo.
  const rows=$$('.set-row',card);
  const join=sets=>sets.map(s=>pairLabel(s.w,s.reps)).join(' · ');
  const typed=rows.map(r=>({ w:num($('.set-weight',r).value)||0, reps:num($('.set-reps',r).value)||0 })).filter(s=>s.w||s.reps);
  if (typed.length) return join(typed);
  // El objetivo es lo mismo que se sugiere serie por serie (y se estampa al tocar).
  const ref=refFor($('.exercise-name',card).value);
  const target=rows.map(r=>suggestionFor(card,r,ref)).filter(Boolean).map(s=>({w:toDisplay(s.w), reps:s.reps}));
  return target.length ? t('exercise.goal',{sets:join(target)}) : t('exercise.noSets');
}
// Objetivo de una fila (dataset, en kg). null si la fila no trae plan.
// Un objetivo sacado del historial de un movimiento (`targetFor`) no vale para
// otro: al renombrar "Aperturas" a "Press Arnold" seguía proponiendo 12×12 de
// las aperturas. No se borra, se ignora — si vuelves al nombre, vuelve a valer.
function rowTarget(r, key) {
  const f = r.dataset.targetFor;
  if (f && key !== undefined && f !== key) return null;
  const w = r.dataset.targetWeight != null ? num(r.dataset.targetWeight) : 0;
  const reps = r.dataset.targetReps != null ? num(r.dataset.targetReps) : 0;
  return (w || reps) ? { w, reps } : null;
}
// Plegado y "terminado" eran lo mismo, y por eso una rutina recién cargada ya
// se contaba entera como hecha. Ahora son dos cosas: `is-collapsed` es dónde
// estás parado (lo mueve el acordeón) y `is-done` es lo que ya trabajaste.
function setCollapsed(card, collapsed) {
  card.classList.toggle('is-collapsed', collapsed);
  setTimeout(paintReorderHint, 0);
  const summary=$('.exercise-summary',card);
  summary.hidden=!collapsed; if(collapsed) summary.textContent=exerciseSummaryText(card);
  const btn=$('.collapse-exercise',card);
  const label=t(collapsed?'exercise.expand':'exercise.collapse');
  btn.title=label; btn.setAttribute('aria-label',label);
}
// Un solo movimiento abierto a la vez: con seis ejercicios desplegados el móvil
// era un scroll interminable y se perdía de vista en cuál estabas.
function openOnly(card) {
  cards().forEach(c => { if (c !== card) setCollapsed(c, true); });
  if (card) { setCollapsed(card, false); paintNext(card); }
  return card;
}
// Al entrar a una sesión siempre queda uno listo para escribir: el primero que
// falta. Si ya está todo hecho, no se abre ninguno.
function openFirstPending() {
  openOnly(cards().find(c => !c.classList.contains('is-done')) || null);
}
function addExercise(data = {}) {
  if(emptyEl()) emptyEl().hidden = true;
  const card = $('#exerciseTemplate').content.firstElementChild.cloneNode(true); $('.exercise-name',card).value = data.name || '';
  // Lo que llega ya armado (rutina, plan, borrador) conserva sus series: solo
  // un nombre tecleado aquí toma las de la última vez (ver matchLastSetCount).
  card.dataset.sizedFor = exKey(data.name);
  $('.exercise-name',card).placeholder = t('exercise.namePlaceholder');
  $('.remove-exercise',card).title = t('exercise.removeTitle');
  $('.remove-exercise',card).textContent = t('exercise.remove');
  $('.collapse-exercise',card).title = t('exercise.collapse');
  $$('.set-labels span',card).forEach((el,i)=>{ el.textContent = [t('set.label.set'),t('set.label.prev'),t('set.label.load',{unit:unitLabel().toUpperCase()}),t('set.label.reps'),''][i] ?? ''; });
  $('.add-set',card).textContent = t('set.add');
  (data.sets?.length ? data.sets : [{}]).forEach(s=>addSet(card,s));
  // Autocompletado propio de nombres (reemplaza el datalist nativo, de estilo pobre).
  const nameInput = $('.exercise-name',card), acPanel = $('.ac-panel',card);
  const renderAc = () => {
    const term = nameInput.value.trim().toLowerCase();
    const items = exerciseNames().filter(n => n.toLowerCase().includes(term)).slice(0,8);
    if (!items.length || (items.length===1 && items[0].toLowerCase()===term)) { acPanel.hidden=true; nameInput.setAttribute('aria-expanded','false'); return; }
    acPanel.innerHTML = items.map(n=>`<button type="button" class="ac-option" role="option">${escapeHtml(n)}</button>`).join('');
    $$('.ac-option',acPanel).forEach(b=>b.onclick=()=>{ nameInput.value=b.textContent; acPanel.hidden=true; nameInput.setAttribute('aria-expanded','false'); updateLast(card); matchLastSetCount(card); saveDraft(); });
    acPanel.hidden=false; nameInput.setAttribute('aria-expanded','true');
  };
  nameInput.oninput = () => { updateLast(card); renderAc(); };
  nameInput.onfocus = renderAc;
  nameInput.onblur = () => { updateLast(card); matchLastSetCount(card); saveDraft(); setTimeout(()=>{ acPanel.hidden=true; nameInput.setAttribute('aria-expanded','false'); }, 150); };
  nameInput.onkeydown = e => { if (e.key==='Escape') { acPanel.hidden=true; nameInput.setAttribute('aria-expanded','false'); } };
  // La serie nueva llega VACIA, con la anterior de objetivo: agregarla no es
  // haberla hecho. Se confirma con un toque en su numero, como todas las demas.
  $('.add-set',card).onclick = () => {
    const last = $$('.set-row',card).at(-1);
    const vals = {};
    if (last) {
      // Hereda lo tecleado arriba; si arriba no se tecleó nada, lo que se le
      // sugería (lo que se ve en su ANT.), no un objetivo oculto en la fila.
      const typedW = String($('.set-weight',last).value).trim(), typedR = String($('.set-reps',last).value).trim();
      const sg = suggestionFor(card, last);
      const tw = typedW ? fromDisplay(num(typedW)) : sg ? sg.w : null;
      const tr = typedR ? num(typedR) : sg ? sg.reps : null;
      if (tw != null) vals.targetWeight = tw;
      if (tr != null) vals.targetReps = tr;
      if (!typedW && !typedR && sg) vals.targetFor = exKey(nameInput.value);
    }
    addSet(card, vals); updateLast(card); saveDraft();
  };
  $('.remove-exercise',card).onclick = () => {
    const after = card.nextSibling, name = $('.exercise-name',card).value.trim();
    card.remove(); if(!listEl().children.length && emptyEl()) emptyEl().hidden=false; paintReorderHint(); saveDraft();
    showToast(name ? t('exercise.removedNamed', { name }) : t('exercise.removed'), { action: t('toast.undo'), ms: 5000, onAction: () => {
      listEl().insertBefore(card, after?.parentElement === listEl() ? after : null);
      if (emptyEl()) emptyEl().hidden = true;
      openOnly(card); paintReorderHint(); saveDraft();
    }});
  };
  $('.collapse-exercise',card).onclick = e => {
    e.stopPropagation();
    if (card.classList.contains('is-collapsed')) openOnly(card); else setCollapsed(card, true);
    saveDraft();
  };
  // stopPropagation: la tarjeta ya quedó plegada cuando el clic le llega, y su
  // propio listener ("tocar la plegada la abre") la volvería a abrir.
  $('.next-exercise',card).onclick = e => {
    e.stopPropagation();
    const next = nextPending(card);
    if (!next) { finishSession(); return; }
    openOnly(next); saveDraft();
    setTimeout(() => next.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }), reducedMotion() ? 0 : 240);
  };
  // Reordenar sin asa: se mantiene presionada la tarjeta plegada y se arrastra,
  // el gesto de toda la vida para mover cosas en una lista. Un asa permanente
  // ocupaba pantalla siempre para algo que se usa de vez en cuando.
  let holdTimer = null, dragging = false, startY = 0, dragEndedAt = 0;
  const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };
  card.addEventListener('pointerdown', e => {
    if (!card.classList.contains('is-collapsed')) return;
    if (e.target.closest('button, input')) return;
    startY = e.clientY;
    holdTimer = setTimeout(() => {
      dragging = true;
      card.classList.add('is-dragging');
      document.body.classList.add('is-reordering'); // congela el scroll mientras dura
      if (localStorage.getItem('loadout-vibrate') !== 'off') navigator.vibrate?.(15);
    }, 320);
  });
  // Los listeners van en window: al reinsertar la tarjeta en el DOM el navegador
  // suelta la captura del puntero y el pointerup se perdería.
  const onMove = e => {
    if (!dragging) { if (holdTimer && Math.abs(e.clientY - startY) > 8) cancelHold(); return; }
    e.preventDefault();
    const list = $('#exerciseList');
    const next = $$('.exercise-card', list).filter(c => c !== card)
      .find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (next) { if (next !== card.nextElementSibling) list.insertBefore(card, next); }
    else if (card !== list.lastElementChild) list.append(card);
  };
  const onUp = () => {
    cancelHold();
    if (!dragging) return;
    dragging = false;
    card.classList.remove('is-dragging');
    document.body.classList.remove('is-reordering');
    dragEndedAt = Date.now(); // el clic que sigue a soltar no debe abrirla
    saveDraft();
    hintReorderDone();
  };
  const blockTouch = e => { if (dragging) e.preventDefault(); };
  window.addEventListener('touchmove', blockTouch, { passive: false });
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  // Tocar la tarjeta plegada en cualquier parte la abre y pliega las demás: en
  // el gimnasio se apunta con el pulgar, apuntarle a la flecha es pedir mucho.
  card.addEventListener('click', e => {
    if (!card.classList.contains('is-collapsed')) return;
    if (e.target.closest('.collapse-exercise, .remove-exercise')) return;
    if (Date.now() - dragEndedAt < 300) return; // acaba de soltarse tras reordenar
    openOnly(card);
    saveDraft();
  });
  listEl().append(card); updateLast(card);
  setCollapsed(card, true); // quién queda abierto lo decide el acordeón; "hecho" se deriva de los valores
  return card;
}
// Deja los pesos en la unidad activa para pintarlos. La sesión puede venir del
// historial (números en kg) o de un borrador (texto tecleado en `_unit`).
function exercisesForRender(session) {
  const src = session._draft ? (session._unit === 'lb' ? 'lb' : 'kg') : null;
  return (session.exercises || []).map(e => ({
    ...e,
    sets: (e.sets || []).map(s => ({
      ...s,
      weight: s.weight === '' || s.weight == null ? ''
        : src === null ? toDisplay(s.weight)
        : src === unit() ? s.weight
        : toDisplay(fromUnit(num(s.weight), src)),
    })),
  }));
}
function renderActiveSession() {
  if (toastHasAction) hideToast();
  restoring = true;
  // Siempre pinta la lista de CAPTURAR, aunque haya una edición abierta encima.
  const prevEdit = editingSession; editingSession = null;
  $('#exerciseList').innerHTML=''; $('#sessionEmpty').hidden = true;
  if (!activeSession) activeSession = makeSession();
  paintSessionChrome();
  $('#sessionName').value = activeSession.name || '';
  $('#sessionDate').value = activeSession.date || todayKey();
  refreshDatalists();
  if (!activeSession.exercises.length) { $('#sessionEmpty').hidden = false; }
  else { exercisesForRender(activeSession).forEach(e=>addExercise(e)); openFirstPending(); }
  editingSession = prevEdit;
  restoring = false;
  renderLiveSummary();
}
// Editar un entrenamiento ya guardado se veía igual que empezar uno nuevo, y el
// botón seguía diciendo "finalizar": parecía que iba a crear otro registro. Acá
// se marca el encabezado y se cambia la etiqueta a "guardar cambios".
// Se escribe también data-i18n para que un cambio de idioma no lo pise.
function paintSessionChrome() {
  const title = $('#sessionTitle');
  // CAPTURAR ya no edita nada: siempre es el entrenamiento que estás anotando.
  title.textContent = captureMode === 'cardio' ? t('cardio.title') : t('session.current');
  $('#sessionEyebrow').dataset.i18n = 'session.eyebrow';
  $('#sessionEyebrow').textContent = t('session.eyebrow');
  $('#finishSessionLabel').dataset.i18n = 'session.finish';
  $('#finishSessionLabel').textContent = t('session.finish');
  paintDateChip();
}
// La fecha deja de ser un campo que se cambia sin querer: es un sello. Si no es
// hoy se pinta en rojo y aparece la × para volver, porque anotar en otro día es
// legítimo pero tiene que verse todo el tiempo.
function paintDateChip() {
  const chip = $('#sessionDateChip'), label = $('#sessionDateLabel'), reset = $('#sessionDateReset');
  if (!chip) return;
  const d = activeSession?.date || todayKey(), hoy = d === todayKey();
  label.textContent = hoy ? t('session.today') : dateShort(d).toUpperCase();
  chip.classList.toggle('is-past', !hoy);
  reset.hidden = hoy;
  reset.title = t('session.backToToday');
  $('#sessionDate').max = todayKey(); // registrar el futuro no tiene sentido
  // Anotar en otro día es legítimo pero no puede pasar desapercibido: franja
  // arriba, fecha en el botón de guardar y el día marcado en la semana.
  const banner = $('#pastBanner');
  if (banner) { banner.hidden = hoy; $('#pastBannerDate').textContent = t('session.registering', { date: dateWeekday(d) }); }
  const fd = $('#finishSessionDate');
  if (fd) { fd.hidden = hoy; fd.textContent = ` · ${dateShort(d).toUpperCase()}`; }
  paintPickedDay();
}
function paintPickedDay() {
  const d = activeSession?.date, hoy = !d || d === todayKey();
  $$('#streakWeek .wd').forEach(b => b.classList.toggle('is-picked', !hoy && b.dataset.date === d));
}
// Única puerta para cambiar el día de la captura (chip, ×, franja, semana).
// `_datePicked` distingue un día elegido del "hoy" con que nace toda sesión:
// nada automático puede devolver a hoy una fecha que eligió la persona.
function setSessionDate(key) {
  if (!activeSession || !key) return;
  activeSession.date = key;
  if (key === todayKey()) delete activeSession._datePicked; else activeSession._datePicked = true;
  $('#sessionDate').value = key;
  paintDateChip(); cards().forEach(updateLast); saveDraft();
}
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Panel lateral en vivo (desktop) / resumen sobre "Finalizar" (móvil).
function renderLiveSummary() {
  const root = $('#liveSummary'); if (!root || editingSession) return; // el panel en vivo es de CAPTURAR
  const list = cards();
  if (!list.length) { root.hidden = true; return; }
  let done = 0, sets = 0, vol = 0;
  list.forEach(card => {
    if (card.classList.contains('is-done')) done++;
    $$('.set-row', card).forEach(r => {
      // Solo lo tecleado: el objetivo pendiente no es tonelaje levantado.
      const w = num($('.set-weight', r).value) || 0;
      const reps = num($('.set-reps', r).value) || 0;
      if (w || reps) sets++;
      vol += w * reps;
    });
  });
  const nf = n => Math.round(n).toLocaleString(dateLocale());
  root.hidden = false;
  root.innerHTML = `<span class="ls-title">${t('live.title')}</span><div class="ls-grid">`
    + `<div class="ls-cell"><b>${done}/${list.length}</b><i>${t('live.moves')}</i></div>`
    + `<div class="ls-cell"><b>${sets}</b><i>${t('live.sets')}</i></div>`
    + `<div class="ls-cell"><b>${nf(vol)}<em style="font-style:normal;font-size:.6em;color:var(--muted)"> ${unitLabel()}</em></b><i>${t('live.volume')}</i></div>`
    + `</div>`;
}
function collectSession() {
  // Lo tecleado está en la unidad activa; al historial va siempre en kg.
  const exercises = cards().map(card => ({name:$('.exercise-name',card).value.trim(), sets:$$('.set-row',card).map(r=>({weight:fromDisplay(num($('.set-weight',r).value)),reps:num($('.set-reps',r).value)})).filter(s=>s.weight||s.reps)})).filter(e=>e.name && e.sets.length);
  // `_draft`/`_unit` son marcas del borrador: no deben acabar en el historial, o
  // al reabrir la sesión sus kilos se releerían como si fueran otra unidad.
  const {_draft, _unit, _datePicked, ...base} = activeSession || {};
  return {...base, name:$('#sessionName').value.trim(), exercises};
}
async function finishSession() {
  const entry=collectSession(); if(!entry.exercises.length){ await showAlert(t('session.needExercise')); return; }
  // CAPTURAR solo crea. Si el id ya está en el historial es un borrador viejo
  // de cuando editar y capturar compartían pantalla: se guarda como sesión
  // nueva en vez de sobrescribir el entrenamiento de aquel día.
  if (sessions.some(x => x.id === entry.id)) entry.id = crypto.randomUUID();
  entry.updatedAt=new Date().toISOString(); // sella la edición para resolver conflictos al fusionar con Drive
  const index=sessions.findIndex(s=>s.id===entry.id); if(index>=0)sessions[index]=entry;else sessions.push(entry); save(); clearDraft(); const prs=detectPRDetails(entry); activeSession=makeSession(); renderActiveSession(); updateDashboard(); stopRest();
  const uploading = window.driveAutoSync?.();
  window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  // Un guardado normal no interrumpe; un récord sí merece su momento.
  if (prs.length) await showPRSheet(prs);
  else showToast(t('session.savedToast', { n: entry.exercises.reduce((a, e) => a + e.sets.length, 0) }));
  // Se espera a la subida ANTES de decidir si hay que avisar: si acaba de
  // respaldar, no tiene sentido abrir un diálogo diciendo que no lo hizo.
  await uploading?.catch(()=>{});
  await window.backupNagIfNeeded?.();
}
// --- Analítica para la barra de indicadores y récords ----------------------
const daysAgo = key => Math.round((new Date(todayKey()+'T12:00')-new Date(key+'T12:00'))/86400000);
const mondayKey = d => { const x=new Date(d); x.setDate(x.getDate()-((x.getDay()+6)%7)); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
// Movimiento estrella: el que aparece en más sesiones (conserva su forma original).
function starLift() {
  const freq=new Map(), label=new Map();
  sessions.forEach(s=>{ new Set(s.exercises.map(e=>exKey(e.name)).filter(Boolean)).forEach(k=>freq.set(k,(freq.get(k)||0)+1));
    s.exercises.forEach(e=>{ const k=exKey(e.name); if(k&&!label.has(k)) label.set(k,e.name.trim()); }); });
  let key=null,c=0; freq.forEach((v,k)=>{ if(v>c){c=v;key=k;} });
  return key ? {key, name:label.get(key)} : null;
}
function exerciseRecords(key) {
  return [...sessions].sort((a,b)=>a.date.localeCompare(b.date))
    .flatMap(s=>s.exercises.filter(e=>exKey(e.name)===key).map(e=>({date:s.date, e1rm:Math.max(0,...e.sets.map(e1rm))})))
    .filter(r=>r.e1rm>0);
}
// Tendencia de fuerza del movimiento estrella: e1RM actual vs ~30 días antes.
function strengthTrend() {
  const star=starLift(); if(!star) return null;
  const recs=exerciseRecords(star.key); if(!recs.length) return null;
  const last=recs.at(-1);
  if(recs.length<2) return {name:star.name, e1rm:last.e1rm, pct:null};
  const targetTime=new Date(last.date+'T12:00').getTime()-30*86400000;
  let base=recs[0];
  for(const r of recs){ if(new Date(r.date+'T12:00').getTime()<=targetTime) base=r; }
  const pct=base.e1rm>0 ? Math.round((last.e1rm-base.e1rm)/base.e1rm*100) : null;
  return {name:star.name, e1rm:last.e1rm, pct};
}
// Constancia = haber entrenado, sea fuerza o cardio. Un día de patineta cuenta
// igual que uno de barra: si no, la racha castigaría por hacer cardio.
const trainedDates = () => [...sessions.map(s=>s.date), ...cardio.map(c=>c.date)].filter(Boolean);
// Semana actual (lunes→domingo) con inicial del día, marcando hoy y futuros.
// Cada día además dice de qué fue: fuerza, cardio o las dos cosas.
function weekStrip() {
  const letters=t('week.days').split(' ');
  const today=new Date(), tKey=todayKey();
  const monday=new Date(today); monday.setDate(today.getDate()-((today.getDay()+6)%7));
  const lifted=new Set(sessions.map(s=>s.date).filter(Boolean));
  const moved=new Set(cardio.map(c=>c.date).filter(Boolean));
  const days=[];
  for(let i=0;i<7;i++){ const d=new Date(monday); d.setDate(monday.getDate()+i); const key=keyOf(d);
    const s=lifted.has(key), c=moved.has(key);
    days.push({ key, letter:letters[i]||'', trained:s||c, kind: s&&c?'both':s?'strength':c?'cardio':null,
                isToday:key===tKey, future:key>tKey }); }
  return days;
}
// Racha: semanas consecutivas (lun-dom) con al menos un entrenamiento.
function weekStreak() {
  const weeks=new Set(trainedDates().map(d=>mondayKey(new Date(d+'T12:00'))));
  let streak=0; const cur=new Date();
  while(weeks.has(mondayKey(cur))){ streak++; cur.setDate(cur.getDate()-7); }
  return streak;
}
// Tonelaje de los últimos 7 días y variación vs los 7 días previos.
function volumeDelta() {
  const vol=list=>list.flatMap(s=>s.exercises.flatMap(e=>e.sets)).reduce((t,x)=>t+(x.weight||0)*(x.reps||0),0);
  const cur=sessions.filter(s=>{const d=daysAgo(s.date); return d>=0&&d<=6;});
  const prev=sessions.filter(s=>{const d=daysAgo(s.date); return d>=7&&d<=13;});
  const c=vol(cur), p=vol(prev);
  return {current:c, pct:p>0 ? Math.round((c-p)/p*100) : null};
}
// Mejor e1RM histórico por movimiento (récord personal), con la serie que lo logró.
// Un movimiento sin carga externa (dominadas, fondos) no tiene 1RM: su marca
// son las repeticiones de la mejor serie. Antes se medía todo con 1RM estimado
// y, al dar 0, esos ejercicios se descartaban enteros del salón de la fama.
function personalRecords() {
  const map=new Map();
  [...sessions].sort((a,b)=>a.date.localeCompare(b.date)).forEach(s=>{
    s.exercises.forEach(e=>{ const key=exKey(e.name); if(!key) return;
      const conCarga=e.sets.some(x=>x.weight>0);
      // Con carga gana el mejor 1RM; sin carga, la serie de más repeticiones.
      const score=x=>conCarga?e1rm(x):(x.reps||0);
      const best=e.sets.reduce((b,x)=> score(x)>(b?score(b):-1) ? x : b, null);
      if(!best || !score(best)) return;
      const cur=map.get(key);
      if(!cur || score(best)>cur.score) map.set(key,{name:e.name.trim(), set:best, score:score(best), loaded:conCarga, date:s.date}); });
  });
  return [...map.values()].sort((a,b)=> b.score-a.score);
}
// Lo único que acompaña a todas las vistas: la racha y la semana en curso.
// Los números de rendimiento viven en MÉTRICAS; acá arriba estorbaban.
function renderStreak() {
  const week=$('#streakWeek'); if(!week) return;
  const strip=weekStrip(), trained=strip.filter(d=>d.trained).length;
  const kindName=k=>t(k==='both'?'streak.both':k==='cardio'?'capture.cardio':'capture.strength');
  week.innerHTML=strip.map(d=>{
    const cls=`wd${d.trained?' on':''}${d.kind?' is-'+d.kind:''}${d.isToday?' today':''}${d.future?' future':''}`;
    // El título es lo que salva al que no distingue los dos colores.
    const pick=d.isToday?t('streak.pickToday'):t('streak.pickDay',{date:dateWeekday(d.key)});
    const label=escapeHtml(d.trained?`${pick} · ${kindName(d.kind)}`:pick);
    return `<button type="button" class="${cls}" data-date="${d.key}" title="${label}" aria-label="${label}"${d.future?' disabled':''}>${d.letter}</button>`;
  }).join('');
  paintPickedDay();
  week.setAttribute('aria-label',t('streak.week',{n:trained}));
  // Sin racha no se muestra un "0": el hueco lo aprovecha mejor la invitación,
  // y de paso desaparece el cero cruzado de DM Mono, que a 29px parece un símbolo.
  const n=weekStreak(), cold=n===0;
  $('#streakValue').textContent=n;
  $('#streakValue').hidden=cold;
  $('#streakUnit').textContent=cold?t('streak.cold'):t(n===1?'streak.unit1':'streak.unit');
  $('#streakBar')?.classList.toggle('is-cold',cold);
}
// Tendencia de fuerza y de carga: dos tarjetas al frente de MÉTRICAS.
function renderTrends() {
  const nf=n=>Math.round(n).toLocaleString(dateLocale());
  const st=strengthTrend(), strengthCard=$('#cardStrength'); if(!strengthCard) return;
  if(st){
    const delta = st.pct==null ? `<small>${t('summary.strengthBase')}</small>`
      : `<small class="delta ${st.pct>=0?'up':'down'}">${st.pct>=0?'▲':'▼'} ${Math.abs(st.pct)}% · 30D</small>`;
    strengthCard.innerHTML=`<span>${t('summary.strength')} · ${escapeHtml(st.name)}</span><strong>${nf(toDisplay(st.e1rm))} <em>${unitLabel()}</em></strong>${delta}`;
  } else strengthCard.innerHTML=`<span>${t('summary.strength')}</span><strong>—</strong><small>${t('summary.noData')}</small>`;
  const vd=volumeDelta();
  const loadDelta = vd.pct==null ? `<small>${t('summary.loadFirst')}</small>`
    : `<small class="delta neutral">${vd.pct>=0?'▲':'▼'} ${Math.abs(vd.pct)}% ${t('summary.vsPrev')}</small>`;
  $('#cardLoad').innerHTML=`<span>${t('summary.load')}</span><strong>${nf(toDisplay(vd.current))} <em>${unitLabel()}</em></strong>${loadDelta}`;
}
function renderPRs() {
  const root=$('#prList'); if(!root) return;
  const prs=personalRecords();
  if(!prs.length){ root.innerHTML=`<p class="no-data">${t('pr.none')}</p>`; return; }
  // Dos grupos: mezclar "128 kg" con "14 reps" en una sola lista ordenada no
  // significa nada. Y se pintan TODOS: antes se cortaba en 10 sin avisar, y lo
  // que se caía eran los récords más viejos, o sea los levantamientos grandes.
  const row = r => `<div class="pr-row">`
    + `<span class="pr-name">${escapeHtml(r.name)}</span>`
    + `<span class="pr-set">${pairLabel(toDisplay(r.set.weight), r.set.reps)}</span>`
    + `<strong class="pr-e1rm">${r.loaded ? `${Math.round(toDisplay(r.score))} ${unitLabel()}` : `${r.score} ${t('set.repsPlaceholder')}`}</strong>`
    + `<span class="pr-date">${dateShort(r.date)}</span></div>`;
  const grupo = (titulo, list) => list.length
    ? `<h3 class="pr-group">${titulo} <b>${list.length}</b></h3><div class="pr-rows">${list.map(row).join('')}</div>` : '';
  root.innerHTML = grupo(t('pr.loaded'), prs.filter(r => r.loaded))
                 + grupo(t('pr.bodyweight'), prs.filter(r => !r.loaded));
}
function updateDashboard() {
  renderStreak(); renderTrends(); renderHistory(); populateProgress(); renderPRs(); renderCardio(); renderOnboarding(); window.renderConfig?.(); window.renderBackupStatus?.(); window.renderSnapshotStatus?.();
}
// El LOG agrupa por mes y muestra cada sesión plegada: con muchas sesiones, la
// lista expandida se volvía un muro de texto imposible de recorrer.
const sessionVolume = s => s.exercises.reduce((tot,e)=>tot+e.sets.reduce((a,x)=>a+(x.weight||0)*(x.reps||0),0),0);
const monthKeyOf = date => date.slice(0,7);
// "1 sesiones" se lee mal. Cuando hay un solo elemento se usa la variante en
// singular de la clave (misma clave + '1'), que cada idioma redacta a su manera.
const countLabel = (key,n) => t(n===1 ? `${key}1` : key, {n});
const monthLabel = key => new Intl.DateTimeFormat(dateLocale(),{month:'long',year:'numeric'}).format(new Date(key+'-01T12:00'));
// Qué meses quedan desplegados. Se conserva entre repintados para no cerrarle
// al usuario lo que acaba de abrir cada vez que se guarda una sesión.
const openMonths = new Set();
let monthsSeeded = false, historyWasFiltered = false;
function renderHistory() {
  const term=$('#historySearch').value.toLowerCase(), period=Number($('#historyPeriod').value);
  const inPeriod=dateKey=>{ if(!period) return true; const d=new Date(); d.setDate(d.getDate()-period); return new Date(dateKey+'T12:00')>=d; };
  let data=[...sessions].sort((a,b)=>b.date.localeCompare(a.date)).filter(s=>inPeriod(s.date));
  data=data.filter(s=>(s.name||'').toLowerCase().includes(term)||s.exercises.some(e=>e.name.toLowerCase().includes(term)));
  // El cardio comparte el LOG con la fuerza: el registro es uno solo, aunque los
  // datos de cada tipo sean distintos.
  const cardioData=[...cardio].filter(c=>c.date&&inPeriod(c.date))
    .filter(c=>(c.activity||'').toLowerCase().includes(term)||(c.note||'').toLowerCase().includes(term));
  const items=[...data.map(s=>({date:s.date, kind:'strength', session:s})),
               ...cardioData.map(c=>({date:c.date, kind:'cardio', entry:c}))]
    .sort((a,b)=>b.date.localeCompare(a.date));
  const root=$('#historyList');
  // Se relee del DOM lo que el usuario dejó abierto. Tras un filtro no se lee:
  // ahí todo estaba abierto a la fuerza y quedaría abierto para siempre.
  if(!historyWasFiltered) $$('.history-month',root).forEach(d=>{ d.open?openMonths.add(d.dataset.month):openMonths.delete(d.dataset.month); });
  if(!items.length){ root.innerHTML=`<p class="no-data">${t('history.noData')}</p>`; historyWasFiltered=true; return; }
  // Al filtrar se abre todo: si el usuario busca algo, quiere verlo, no cazarlo.
  const searching=!!term;
  const groups=new Map();
  items.forEach(it=>{ const k=monthKeyOf(it.date); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(it); });
  if(!monthsSeeded){ const first=groups.keys().next().value; if(first) openMonths.add(first); monthsSeeded=true; }
  const nf=n=>Math.round(n).toLocaleString(dateLocale());
  root.innerHTML=[...groups].map(([key,list])=>{
    const vol=list.filter(it=>it.kind==='strength').reduce((tot,it)=>tot+sessionVolume(it.session),0);
    const mins=list.filter(it=>it.kind==='cardio').reduce((tot,it)=>tot+(it.entry.minutes||0),0);
    const body=list.map(it=>{
      if(it.kind==='cardio') return cardioCardHtml(it.entry, searching);
      const s=it.session;
      const moves=s.exercises.map(e=>`<div class="history-move"><span>${escapeHtml(e.name)}</span><small>${e.sets.map(x=>pairLabel(toDisplay(x.weight),x.reps)).join(' · ')}</small></div>`).join('');
      return `<details class="history-session"${searching?' open':''}><summary><div class="hs-id"><h4>${escapeHtml(s.name||t('history.unnamed'))}</h4><time>${dateFmt(s.date)} · ${countLabel('history.movesCount',s.exercises.length)}</time></div><span class="hs-vol">${nf(toDisplay(sessionVolume(s)))} ${unitLabel()}</span></summary><div class="history-moves">${moves}</div><div class="hs-actions"><button class="secondary-button edit-session" data-id="${s.id}">${t('history.edit')}</button></div></details>`;
    }).join('');
    // El total del mes suma tonelaje y minutos por separado: son magnitudes distintas.
    const totals=[vol?`${nf(toDisplay(vol))} ${unitLabel()}`:'', mins?t('cardio.minutes',{n:nf(mins)}):''].filter(Boolean).join(' · ');
    return `<details class="history-month" data-month="${key}"${searching||openMonths.has(key)?' open':''}><summary><span class="hm-name">${escapeHtml(monthLabel(key))}</span><small>${countLabel('history.monthCount',list.length)}${totals?' · '+totals:''}</small></summary><div class="history-month-body">${body}</div></details>`;
  }).join('');
  historyWasFiltered=searching;
  $$('.edit-session').forEach(b=>b.onclick=()=>editSession(b.dataset.id));
  wireCardioHistory(root);
}
// ¿Hay trabajo sin guardar en la sesión en curso? (cards con contenido y aún no guardada en el historial)
function hasUnsavedSession() {
  if (sessions.some(s=>s.id===activeSession?.id)) return false; // ya guardada: editar no pierde nada nuevo
  return cards().some(card =>
    $('.exercise-name',card).value.trim() ||
    $$('.set-row',card).some(r=>$('.set-weight',r).value.trim()||$('.set-reps',r).value.trim()));
}
// Editar abre su PROPIA vista, con su propia lista y su propia copia. CAPTURAR
// queda intacto detrás: sus movimientos, su fecha y su borrador no se tocan.
function editSession(id) {
  const s = sessions.find(x => x.id === id); if (!s) return;
  editingSession = JSON.parse(JSON.stringify(s));
  renderEditing();
  editBaseline = editSnapshot();
  showEditView(true);
}
let editBaseline = '';
const editSnapshot = () => JSON.stringify([$('#editName').value.trim(), $('#editDate').value, collectEditingExercises()]);
function renderEditing() {
  $('#editName').value = editingSession.name || '';
  $('#editDate').value = editingSession.date || todayKey();
  $('#editTitle').textContent = t('session.editing', { date: dateShort(editingSession.date || todayKey()) });
  $('#editList').innerHTML = (editingSession.exercises || []).map(esRow).join('') || esRow();
  bindEditRows();
}
// Editar NO es entrenar: acá no hay acordeón, ni referencia de la última vez, ni
// récords, ni chuleo de series. Es una ficha compacta con todo a la vista, con
// la misma cara que el editor de rutinas — la app tiene dos lenguajes, "anotar"
// (tarjetas grandes, de una en una) y "editar" (ficha densa), y esto es editar.
function esRow(ex = { name: '', sets: [] }) {
  const sets = (ex.sets || []).length ? ex.sets : [{}];
  return `<div class="re-move es-move">`
    + `<div class="re-move-head"><input class="re-move-name es-name" value="${escapeHtml(ex.name || '')}" autocomplete="off" data-i18n-placeholder="exercise.namePlaceholder" placeholder="${t('exercise.namePlaceholder')}"/>`
    + `<button class="icon-btn es-del-move" type="button" title="${t('exercise.removeTitle')}">×</button></div>`
    + `<div class="re-sets es-sets">${sets.map(esSet).join('')}</div>`
    + `<button class="add-set es-add-set" type="button">${t('set.add')}</button></div>`;
}
function esSet(s = {}) {
  const w = s.weight ? toDisplay(s.weight) : '';
  return `<div class="re-set es-set">`
    + `<span class="re-n"></span>`
    + `<input class="es-w" inputmode="decimal" type="text" value="${w}" placeholder="${unitLabel()}"/>`
    + `<span class="es-x">×</span>`
    + `<input class="es-r" inputmode="numeric" type="number" min="0" step="1" value="${s.reps || ''}" placeholder="${t('set.repsPlaceholder')}"/>`
    + `<button class="remove-set es-del-set" type="button" title="${t('set.removeTitle')}">×</button></div>`;
}
function numberEditSets() {
  $$('.es-move').forEach(m => $$('.re-n', m).forEach((n, i) => { n.textContent = String(i + 1).padStart(2, '0'); }));
}
function bindEditRows() {
  numberEditSets();
  $$('.es-del-move').forEach(b => b.onclick = () => { b.closest('.es-move').remove(); if(!$('#editList').children.length) $('#editList').innerHTML = esRow(); bindEditRows(); });
  $$('.es-add-set').forEach(b => b.onclick = () => { $('.es-sets', b.closest('.es-move')).insertAdjacentHTML('beforeend', esSet()); bindEditRows(); });
  $$('.es-del-set').forEach(b => b.onclick = () => {
    const row = b.closest('.es-set'), box = row.parentElement;
    if (box.children.length > 1) { row.remove(); numberEditSets(); }
  });
}
// Lee la ficha. El peso se teclea en la unidad activa y va al historial en kg.
function collectEditingExercises() {
  return $$('.es-move').map(m => ({
    name: $('.es-name', m).value.trim(),
    sets: $$('.es-set', m).map(r => ({
      weight: fromDisplay(num($('.es-w', r).value)),
      reps: num($('.es-r', r).value),
    })).filter(x => x.weight || x.reps),
  })).filter(e => e.name && e.sets.length);
}

function showEditView(on) {
  $('#editView').classList.toggle('active', on);
  $$('.view').forEach(v => { if (v.id !== 'editView') v.classList.toggle('active', !on && v.id === 'historyView'); });
  $$('.tab').forEach(x => x.classList.toggle('active', !on && x.dataset.view === 'history'));
  window.scrollTo({ top: 0, behavior: 'instant' });
}
// Salir sin guardar es seguro: la sesión original nunca se tocó y lo de hoy
// sigue esperando en CAPTURAR tal como lo dejaste.
function exitEditing() {
  editingSession = null;
  $('#editList').innerHTML = '';
  showEditView(false);
  renderHistory();
}
function saveEditing() {
  const {_draft, _unit, ...base} = editingSession;
  const entry = {...base, name: $('#editName').value.trim(), exercises: collectEditingExercises()};
  entry.date = $('#editDate').value || entry.date;
  entry.updatedAt = new Date().toISOString();
  const i = sessions.findIndex(x => x.id === entry.id);
  // Sin movimientos no queda un registro vacío: se entiende como borrarlo.
  if (!entry.exercises.length) { deleteEditing(); return; }
  if (i >= 0) sessions[i] = entry; else sessions.push(entry);
  save();
  exitEditing();
  updateDashboard();
  window.driveAutoSync?.();
  showToast(t('session.updated')); // antes volvía al LOG sin decir nada
}
async function deleteEditing() {
  if (!(await showConfirm(t('session.deleteConfirm'), { danger: true, okText: t('session.deleteOk') }))) return;
  window.snapshot?.(t('session.deleteSnapReason'));
  markDeleted(editingSession.id);
  sessions = sessions.filter(x => x.id !== editingSession.id);
  save();
  exitEditing();
  updateDashboard();
  window.driveAutoSync?.();
}
function populateProgress() { const names=[...new Set(sessions.flatMap(s=>s.exercises.map(e=>e.name)).filter(Boolean))]; const sel=$('#progressExercise'), current=sel.value; sel.innerHTML=names.length?names.map(n=>`<option>${escapeHtml(n)}</option>`).join(''):`<option>${t('progress.noExercises')}</option>`; if(names.includes(current))sel.value=current; renderGlobalStats(); renderProgress(); }

// --- Resumen global ---------------------------------------------------------
// Encabeza la vista de progreso: la foto acumulada antes del detalle por movimiento.
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
    s.exercises.forEach(e => { const k = exKey(e.name); if (k && !label.has(k)) label.set(k, e.name.trim()); });
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
  const root=$('#globalStats');
  if(!root) return;
  if(!sessions.length){ root.innerHTML=`<p class="no-data">${t('config.noData')}</p>`; return; }
  const g = computeGlobalStats();
  const nf = n => n.toLocaleString(dateLocale());
  const tiles = [
    [t('config.stat.sessions'), nf(g.sessions)],
    [t('config.stat.sets'), nf(g.sets)],
    [t('config.stat.volume'), `${nf(Math.round(toDisplay(g.volume)))} ${unitLabel()}`],
    [t('config.stat.exercises'), nf(g.distinct)],
    [t('config.stat.activeDays'), nf(g.activeDays)],
    [t('config.stat.avgSets'), nf(g.avgSets)],
    [t('config.stat.star'), g.star ? `${g.star} · ${g.starCount}×` : '—'],
    [t('config.stat.first'), g.first ? dateFmt(g.first) : '—'],
  ];
  root.innerHTML = tiles.map(([label, value]) =>
    `<article class="progress-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`).join('');
}
// 1RM estimado (fórmula de Epley): peso × (1 + reps/30). Mide fuerza real
// aunque cambies de repeticiones, mejor que la carga máxima a secas.
const e1rm = s => (s.weight||0) * (1 + (s.reps||0)/30);
const PROGRESS_METRICS = ['e1rm','volume','max'];
let progressMetric = 'e1rm';
// Devuelve ya convertido a la unidad activa: solo se usa para pintar el gráfico.
const metricValue = (r,m) => toDisplay(m==='e1rm' ? r.e1rm : m==='volume' ? r.volume : r.max);
function renderProgress() {
  const name=$('#progressExercise').value;
  const records=[...sessions].sort((a,b)=>a.date.localeCompare(b.date))
    .flatMap(s=>s.exercises.filter(e=>e.name===name).map(e=>{
      const top=e.sets.reduce((b,x)=> e1rm(x) > (b?e1rm(b):-1) ? x : b, null);
      return { date:s.date, max:Math.max(0,...e.sets.map(x=>x.weight)), volume:e.sets.reduce((t,x)=>t+x.weight*x.reps,0), e1rm:Math.max(0,...e.sets.map(e1rm)), top };
    }));
  const root=$('#progressContent');
  if(!records.length){ root.innerHTML=`<p class="no-data">${t('progress.noData')}</p>`; return; }
  const last=records.at(-1), first=records[0];
  const bestE=Math.max(...records.map(r=>r.e1rm));
  const bestRec=records.reduce((b,r)=> e1rm(r.top||{}) > e1rm(b.top||{}) ? r : b);
  const diff=last.e1rm-first.e1rm, pct=first.e1rm>0 ? Math.round(diff/first.e1rm*100) : 0;
  const bars=records.slice(-8), maxVal=Math.max(...bars.map(r=>metricValue(r,progressMetric)),1);
  const fmt=v=> progressMetric==='max' ? Math.round(v*10)/10 : Math.round(v);
  const recent=[...records].slice(-6).reverse();
  const topLabel=r=> r.top ? pairLabel(toDisplay(r.top.weight),r.top.reps) : '—';
  root.innerHTML=`
    <p class="progress-note">${t('progress.note')}</p>
    <div class="progress-stats">
      <article class="progress-stat"><span>${t('progress.e1rmNow')}</span><strong>${Math.round(toDisplay(last.e1rm))} ${unitLabel()}</strong></article>
      <article class="progress-stat"><span>${t('progress.e1rmBest')}</span><strong>${Math.round(toDisplay(bestE))} ${unitLabel()}</strong></article>
      <article class="progress-stat"><span>${t('progress.change')}</span><strong>${diff>=0?'+':''}${Math.round(toDisplay(diff))} ${unitLabel()} · ${pct>=0?'+':''}${pct}%</strong></article>
      <article class="progress-stat"><span>${t('progress.bestSet')}</span><strong>${topLabel(bestRec)}</strong></article>
    </div>
    <div class="metric-switch">${PROGRESS_METRICS.map(m=>`<button data-metric="${m}" class="${m===progressMetric?'is-active':''}">${t('progress.metric.'+m)}</button>`).join('')}</div>
    <div class="progress-cols">
    <article class="chart-card">
      <h3>${escapeHtml(name)}</h3>
      <p>${t('progress.chartMetric',{metric:t('progress.metric.'+progressMetric), n:bars.length})}</p>
      <div class="bar-chart">${bars.map(r=>{const v=metricValue(r,progressMetric);return `<div class="bar-wrap"><span class="bar-value">${fmt(v)}</span><div class="bar" style="height:${Math.max(8,v/maxVal*115)}px"></div><span class="bar-label">${new Date(r.date+'T12:00').toLocaleDateString(dateLocale(),{day:'2-digit',month:'2-digit'})}</span></div>`}).join('')}</div>
    </article>
    <div class="recent-table">
      <div class="recent-row head"><span>${t('progress.col.date')}</span><span>${t('progress.col.top')}</span><span>${t('progress.col.e1rm')}</span><span class="col-vol">${t('progress.col.volume',{unit:unitLabel()})}</span></div>
      ${recent.map(r=>`<div class="recent-row"><span>${dateFmt(r.date)}</span><span>${topLabel(r)}</span><strong>${Math.round(toDisplay(r.e1rm))}</strong><span class="col-vol">${Math.round(toDisplay(r.volume))}</span></div>`).join('')}
    </div>
    </div>`;
  $$('.metric-switch button').forEach(b=>b.onclick=()=>{ progressMetric=b.dataset.metric; renderProgress(); });
}
// --- Temporizador de descanso ---
let restInterval=null, restTimeout=null, restTick=null, restEnds=0, restDuration=Number(localStorage.getItem('loadout-rest-default'))||90;
function fmtRest(s){s=Math.max(0,s);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
function startRest(seconds=restDuration){
  restDuration=seconds; restEnds=Date.now()+seconds*1000; clearInterval(restInterval);
  $('#restTimer').classList.add('is-running');
  // Pide permiso de notificaciones la primera vez: es el único aviso fiable
  // cuando la app queda en segundo plano.
  if('Notification' in window && Notification.permission==='default'){ try{ Notification.requestPermission(); }catch{} }
  restTick=()=>{const left=Math.round((restEnds-Date.now())/1000); showRest(fmtRest(left));
    if(left<=0){stopRest(); beep(); if(navigator.vibrate && localStorage.getItem('loadout-vibrate')!=='off')navigator.vibrate([200,100,200]);
      if(document.hidden) notifyRestDone();}};
  restTick(); restInterval=setInterval(restTick,250);
  // En segundo plano el navegador espacia los intervalos, pero un timeout único
  // apuntado al final suele respetarse (rests < 5 min no entran en la
  // limitación fuerte). Es el aviso puntual sin necesidad de audio.
  clearTimeout(restTimeout); restTimeout=setTimeout(()=>{ if(restInterval&&restTick) restTick(); }, seconds*1000+80);
  primeBeep(); keepAwake();
}

// --- Aviso puntual con la pantalla apagada (opcional, apagado por defecto) ---
// Una pista de audio inaudible en bucle hace que la página cuente como
// "reproduciendo" y el sistema nunca la congela: el pitido suena exacto incluso
// con la pantalla apagada. El costo es que el sistema le da foco de audio y baja
// un poco el volumen de otras apps, así que viene APAGADO por defecto: sin él,
// el timeout apuntado al final + la notificación cubren el caso normal, y solo
// con pantalla apagada mucho rato el aviso puede llegar tarde. Quien quiera
// exactitud a cambio del bajón de volumen lo enciende en ajustes.
const KEEPALIVE_KEY='loadout-bgtimer';
let keepEl=null;
// WAV de un segundo a volumen mínimo: el silencio absoluto lo descartan algunos
// móviles, así que llevamos la amplitud más baja que existe (1 sobre 32767).
function silentTrack(){
  const rate=8000, n=rate, buf=new ArrayBuffer(44+n*2), v=new DataView(buf);
  const txt=(off,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(off+i,s.charCodeAt(i)); };
  txt(0,'RIFF'); v.setUint32(4,36+n*2,true); txt(8,'WAVEfmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,rate,true); v.setUint32(28,rate*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true);
  txt(36,'data'); v.setUint32(40,n*2,true);
  for(let i=0;i<n;i++) v.setInt16(44+i*2, i%2?1:-1, true);
  return URL.createObjectURL(new Blob([buf],{type:'audio/wav'}));
}
function keepAwake(){
  if(localStorage.getItem(KEEPALIVE_KEY)!=='on') return;
  try{
    if(!keepEl){ keepEl=new Audio(silentTrack()); keepEl.loop=true; keepEl.volume=.02; }
    // Se lanza desde el toque que inicia el descanso, así que el navegador lo
    // permite; ese play también "desbloquea" el elemento para poder reanudarlo
    // luego sin gesto, al pasar a segundo plano.
    keepEl.play().then(()=>{ setMediaInfo(); if(!document.hidden) keepEl.pause(); }).catch(()=>{});
  }catch{}
}
function releaseAwake(){ try{ keepEl?.pause(); }catch{} }
// El control de reproducción del sistema queda con el nombre de la app y su
// botón de parar corta el descanso, en vez de dejar un audio fantasma sonando.
function setMediaInfo(){
  if(!('mediaSession' in navigator)) return;
  try{
    navigator.mediaSession.metadata=new MediaMetadata({title:t('rest.mediaTitle'),artist:'LOADOUT',artwork:[{src:'src/img/icon-192.png',sizes:'192x192',type:'image/png'}]});
    navigator.mediaSession.setActionHandler('pause',()=>stopRest());
    navigator.mediaSession.setActionHandler('stop',()=>stopRest());
  }catch{}
}
// Aviso del sistema para cuando el descanso termina con la app en segundo plano.
function notifyRestDone(){
  if(!('Notification' in window) || Notification.permission!=='granted') return;
  const opts={body:t('rest.notifBody'), icon:'src/img/icon-192.png', tag:'loadout-rest', vibrate:[200,100,200]};
  if(navigator.serviceWorker && navigator.serviceWorker.controller){
    navigator.serviceWorker.ready.then(r=>r.showNotification(t('rest.notifTitle'),opts)).catch(()=>{});
  } else { try{ new Notification(t('rest.notifTitle'),opts); }catch{} }
}
// El audio de fondo solo suena con la app oculta: al esconderse arranca (para que
// el sistema no congele el contador) y al volver se corta y el contador se pone al
// día de inmediato (el fin del descanso se calcula con la hora real).
document.addEventListener('visibilitychange',()=>{
  if(!restInterval) return;
  if(document.hidden){ keepAwake(); }
  else { releaseAwake(); if(restTick) restTick(); }
});
// El contador queda fijo: al detener vuelve al estado en reposo mostrando la duración elegida.
function stopRest(){clearInterval(restInterval);restInterval=null;clearTimeout(restTimeout);restTimeout=null;releaseAwake();$('#restTimer').classList.remove('is-running');showRest(fmtRest(restDuration));}
// El panel y la pestaña muestran el mismo tiempo: siempre se escriben juntos.
function showRest(txt){$('#restDisplay').textContent=txt;$('#restTabDisplay').textContent=txt;
  // El número de la pestaña también se toca: que su etiqueta diga qué hará el toque.
  // Se guarda en data-i18n-aria para que sobreviva a un cambio de idioma.
  const tab=$('#restTab'); if(tab){ tab.dataset.i18nAria=restInterval?'rest.running':'rest.start'; tab.setAttribute('aria-label',t(tab.dataset.i18nAria)); }}
// Un solo AudioContext, creado en el toque que inicia el descanso: uno nuevo al
// vencer el timer en segundo plano nace suspendido y el pitido sale mudo — de ahí
// venía el "a veces suena, a veces no".
let beepCtx=null;
function primeBeep(){try{if(!beepCtx)beepCtx=new (window.AudioContext||window.webkitAudioContext)();if(beepCtx.state==='suspended')beepCtx.resume().catch(()=>{});}catch{}}
function beep(){if(localStorage.getItem('loadout-sound')==='off')return;try{primeBeep();const ctx=beepCtx;if(!ctx)return;const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=880;g.gain.setValueAtTime(.3,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.6);o.start();o.stop(ctx.currentTime+.6);}catch{}}
$$('#restTimer [data-rest]').forEach(b=>b.onclick=()=>startRest(Number(b.dataset.rest)));
showRest(fmtRest(restDuration));

// --- El contador es un cajón: siempre anclado a un borde lateral, se arrastra
// solo en vertical y cambia de lado si lo llevas a la otra mitad de la pantalla. ---
const REST_POS_KEY='loadout-rest-pos';
const REST_SLIDE=240;                                      // debe coincidir con la transición del CSS
// Alto de la barra de navegación inferior (0 en desktop, donde el rail es lateral).
function bottomNav(){ if(window.matchMedia('(min-width:1024px)').matches) return 0; const v=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--botnav')); return (Number.isFinite(v)?v:64)+8; }
function readRestState(){ try{ return JSON.parse(localStorage.getItem(REST_POS_KEY))||{}; }catch{ return {}; } }
function saveRestState(s){ localStorage.setItem(REST_POS_KEY,JSON.stringify(s)); }
(function initRest(){
  const el=$('#restTimer'), chev=$('#restChev'), tab=$('#restTab');
  const st=readRestState();
  // Por defecto: anclado a la derecha, a la altura del último tercio de la pantalla.
  let side = st.side==='left' ? 'left' : 'right';
  let collapsed = st.collapsed!==false;                    // arranca plegado, sin tapar nada
  let top = Number.isFinite(st.top) ? st.top : Math.round(window.innerHeight*.62);

  // El alto no cambia entre estados: el tirador es tan alto como el cuerpo.
  function clampTop(v){ const pad=8, max=window.innerHeight-el.offsetHeight-pad-bottomNav(); return Math.min(Math.max(pad,v),Math.max(pad,max)); }
  function place(){
    el.classList.toggle('is-collapsed',collapsed);
    el.classList.toggle('side-right',side==='right');
    el.classList.toggle('side-left',side==='left');
    top=clampTop(top); el.style.top=top+'px';
    chev.setAttribute('aria-expanded',String(!collapsed));
    chev.dataset.i18nAria = collapsed?'rest.expand':'rest.collapse';
    chev.setAttribute('aria-label',t(chev.dataset.i18nAria));
  }
  function saveRest(){ saveRestState({side,top,collapsed}); }
  // Plegar y desplegar es un único desliz de la pieza completa: el cuerpo se
  // esconde tras el borde y el tirador queda asomado. Nada cambia de forma.
  function setCollapsed(next){ if(collapsed===next)return; collapsed=next; place(); saveRest(); }

  place();
  // Teclado: cada botón hace lo suyo. El puntero no puede usar `click` (la captura
  // lo redirige al contenedor), así que se resuelve aparte, más abajo.
  chev.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); setCollapsed(!collapsed); } });
  tab.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); restInterval?stopRest():startRest(); } });

  // Arrastre: vertical libre; cruzar la mitad de la pantalla lo cambia de lado.
  // El toque sin arrastre se resuelve aquí y no con un `click`: al capturar el
  // puntero el navegador dispara el click sobre el contenedor, no sobre el hijo.
  // Plegado, el número de la pestaña es el mismo contador: tocarlo arranca o para
  // el descanso, igual que el número grande, y la pieza no se mueve. Desplegar pasó
  // a ser cosa de la flecha, que es lo único que sigue asomando al desplegarse.
  let dragging=false, sx=0, sy=0, startTop=0, moved=false, onNumber=false, onHandle=false, onChev=false;
  el.addEventListener('pointerdown',e=>{
    if(e.target.closest('.rest-actions'))return;           // los presets funcionan normal
    dragging=true; moved=false;
    onChev=!!e.target.closest('.rest-chev');
    onHandle=!onChev&&!!e.target.closest('.rest-handle');
    onNumber=(!collapsed&&!!e.target.closest('.rest-info'))||(collapsed&&onHandle);
    sx=e.clientX; sy=e.clientY; startTop=top; el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove',e=>{
    if(!dragging)return;
    if(Math.hypot(e.clientX-sx,e.clientY-sy)>6) moved=true;
    if(!moved)return;
    top=clampTop(startTop+(e.clientY-sy)); el.style.top=top+'px';
    if(Math.abs(e.clientX-sx)>50){
      const want = e.clientX < window.innerWidth/2 ? 'left' : 'right';
      if(want!==side){ side=want; place(); }
    }
  });
  const endPointer=()=>{
    if(!dragging)return; dragging=false; el.classList.remove('dragging');
    if(moved) saveRest();
    else if(onChev) setCollapsed(!collapsed);              // la flecha abre y cierra
    else if(onNumber) restInterval?stopRest():startRest(); // el número, plegado o no, arranca y para
    else if(onHandle) setCollapsed(!collapsed);
    onHandle=onNumber=onChev=false;
  };
  el.addEventListener('pointerup',endPointer); el.addEventListener('pointercancel',endPointer);

  window.addEventListener('resize',place);
})();

// --- Récords personales ---
function detectPRs(entry){ return detectPRDetails(entry).map(p=>t('pr.line',p)); }
function detectPRDetails(entry){
  const prs=[];
  for(const ex of entry.exercises){
    const key=exKey(ex.name);
    // Igual que en RÉCORDS: con carga manda el peso; sin ella, las repeticiones.
    // Antes solo se miraba el peso, así que superar tu marca de dominadas o
    // fondos no se celebraba nunca.
    const conCarga=ex.sets.some(x=>x.weight>0);
    const marca=sets=>Math.max(0,...sets.map(x=>conCarga ? (x.weight||0) : (x.reps||0)));
    const ahora=marca(ex.sets); if(!ahora)continue;
    const antes=Math.max(0,...sessions.filter(s=>s.id!==entry.id)
      .flatMap(s=>s.exercises.filter(e=>exKey(e.name)===key))
      .map(e=>marca(e.sets)));
    const pinta=v=>conCarga ? showW(v) : `${v} ${t('set.repsPlaceholder')}`;
    if(antes&&ahora>antes)prs.push({name:ex.name, now:pinta(ahora), before:pinta(antes)});
  }
  return prs;
}

// Un récord no es un guardado más: hoja propia, el valor nuevo en grande con el
// anterior tachado al lado, y una vibración distinta de la de cada serie.
function showPRSheet(prs) {
  if (navigator.vibrate && localStorage.getItem('loadout-vibrate') !== 'off') navigator.vibrate([30, 40, 30]);
  const html = `<span class="pr-eyebrow">${escapeHtml(t(prs.length > 1 ? 'pr.titleMany' : 'pr.title'))}</span>`
    + `<ul class="pr-list">${prs.map(p => `<li><strong>${escapeHtml(p.name)}</strong>`
      + `<span class="pr-vals"><b>${escapeHtml(p.now)}</b><s>${escapeHtml(p.before)}</s></span></li>`).join('')}</ul>`
    + `<span class="pr-foot">${escapeHtml(t('pr.saved'))}</span>`;
  return openDialog('', { html, variant: 'pr', okText: t('pr.ok') });
}
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function renderTodayDates(){
  $('#today').textContent=new Intl.DateTimeFormat(dateLocale(),{weekday:'long',day:'numeric',month:'long'}).format(new Date());
}
renderTodayDates();
// Solo una tarjeta nueva entra animada: antes la animación se repetía en cada
// repintado (cambiar unidad, idioma, sincronizar) y la lista "saltaba".
const addFresh = () => { const c = addExercise(); c.classList.add('is-new'); openOnly(c); saveDraft(); };
$('#addExercise').onclick=addFresh; $('#emptyAddExercise').onclick=addFresh; $('#finishSession').onclick=finishSession;
$('#exampleRoutine').onclick=loadExampleRoutine;
// Cambiar de unidad no toca el historial (siempre en kg): basta repintar, pero
// hay que reinterpretar lo ya tecleado, que estaba en la unidad anterior.
function setUnit(next) {
  if(next===unit()) return;
  const draft=activeSession ? collectDraft() : null; // queda sellado con la unidad vieja
  localStorage.setItem(UNIT_KEY, next);
  if(draft) activeSession=draft;                     // exercisesForRender lo convertirá
  renderActiveSession(); updateDashboard(); saveDraft();
}
// Cambiar la fecha cambia qué cuenta como "la última vez": se repintan las referencias.
$('#sessionDate').onchange=()=>setSessionDate($('#sessionDate').value);
$('#sessionDateReset').onclick=()=>setSessionDate(todayKey());
$('#pastBannerReset').onclick=()=>setSessionDate(todayKey());
// Tocar un día de la semana es "quiero anotar ese día": lleva a CAPTURAR con esa
// fecha (en fuerza o en cardio, lo que esté abierto). Mientras se edita una
// sesión pasada no hace nada: cambiar de pestaña tiraría la edición.
$('#streakWeek').addEventListener('click', e => {
  const day = e.target.closest('.wd[data-date]');
  if (!day || day.disabled || editingSession) return;
  $('.tab[data-view="session"]')?.click();
  if (captureMode === 'cardio') $('#cardioDate').value = day.dataset.date;
  else setSessionDate(day.dataset.date);
  const chip = captureMode === 'cardio' ? $('#cardioDate') : $('#sessionDateChip');
  if (day.dataset.date !== todayKey()) { chip?.classList.remove('is-flash'); void chip?.offsetWidth; chip?.classList.add('is-flash'); }
  window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
});
// Una sesión vacía que nació ayer (la app quedó abierta de un día para otro) no
// debe amanecer con fecha vieja. Si el día lo eligió la persona, se respeta.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !activeSession || activeSession._datePicked || editingSession) return;
  if (activeSession.date !== todayKey() && !draftHasContent(collectDraft())) setSessionDate(todayKey());
});
$('#editCancel').onclick=exitEditing;
$('#editSave').onclick=saveEditing;
$('#editDelete').onclick=deleteEditing;
$('#editAddExercise').onclick=()=>{ $('#editList').insertAdjacentHTML('beforeend', esRow()); bindEditRows(); };
$('#editDate').onchange=()=>{ if(editingSession && $('#editDate').value) editingSession.date=$('#editDate').value; };
$('#sessionName').oninput=()=>{ if(activeSession)activeSession.name=$('#sessionName').value; openRoutinePanel(); saveDraft(); };
// Cualquier tecleo en series/nombres del ejercicio persiste el borrador.
$('#exerciseList').addEventListener('input', saveDraft);

$('#sessionName').onfocus=openRoutinePanel;
$('#sessionName').onkeydown=e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){ e.preventDefault(); if($('#routinePanel').hidden)openRoutinePanel(); moveRoutineHighlight(e.key==='ArrowDown'?1:-1); return; }
  if(e.key==='Enter'){ const active=$('.routine-option.is-active'); if(active){ e.preventDefault(); openRoutine(active.dataset.name); } else closeRoutinePanel(); return; }
  if(e.key==='Escape') closeRoutinePanel();
};
$('#routineToggle').onclick=()=>{ if($('#routinePanel').hidden){ openRoutinePanel(); $('#sessionName').focus(); } else closeRoutinePanel(); };
// Cerrar al tocar fuera del campo.
document.addEventListener('click',e=>{ if(!e.target.closest('.routine-field')) closeRoutinePanel(); });
$('#clearSession').onclick=async ()=>{
  if(!listEl().children.length)return;
  if(!(await showConfirm(t('session.clearConfirm'), {danger:true, okText:t('session.clearOk')})))return;
  // Vaciar de verdad: id y fecha nuevos. Antes solo borraba las tarjetas y
  // dejaba la sesión atada al día que estuvieras arrastrando.
  activeSession = makeSession(); clearDraft(); renderActiveSession();
};
// Borrar un entrenamiento vive ahora en la vista de edición (#editDelete).
// Cambiar de pestaña vuelve arriba (antes quedabas a media página de la vista
// anterior) y, si hay una edición con cambios, pregunta antes de tirarla.
$$('.tab').forEach(tab=>tab.onclick=async()=>{
  if(editingSession){
    if(editSnapshot()!==editBaseline && !(await showConfirm(t('session.discardEdit'),{danger:true,okText:t('session.discardEditOk')}))) return;
    editingSession=null; $('#editList').innerHTML=''; $('#editView').classList.remove('active');
  }
  $$('.tab').forEach(x=>x.classList.toggle('active',x===tab));
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`${tab.dataset.view}View`));
  window.scrollTo({top:0,behavior:'instant'});
  if(tab.dataset.view==='progress')populateProgress();if(tab.dataset.view==='history')renderHistory();if(tab.dataset.view==='records')renderPRs();if(tab.dataset.view==='config')window.renderConfig?.();
});
$('#historySearch').oninput=renderHistory; $('#historyPeriod').onchange=renderHistory; $('#progressExercise').onchange=renderProgress; $('#themeButton').onclick=()=>document.body.classList.toggle('dark');
$('#exportData').onclick=()=>{const payload={app:'LOADOUT',version:1,exportedAt:new Date().toISOString(),sessions,templates,cardio,deleted:deletedIds};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`${t('export.filename')}-${todayKey()}.json`;link.click();URL.revokeObjectURL(link.href);window.markBackupDone?.();};
$('#importData').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{const payload=JSON.parse(await file.text());if(!Array.isArray(payload.sessions))throw new Error();if(!(await showConfirm(t('import.confirm',{n:payload.sessions.length}),{danger:true,okText:t('import.ok')})))return;window.snapshot?.(t('import.reason'));deletedIds=mergeDeleted(deletedIds,payload.deleted);saveDeleted();sessions=payload.sessions;if(Array.isArray(payload.templates)){templates=payload.templates;saveTemplates();}if(Array.isArray(payload.cardio)){cardio=payload.cardio;saveCardio();}save();clearDraft();activeSession=makeSession();renderActiveSession();updateDashboard();await showAlert(t('import.done'));}catch{await showAlert(t('import.invalid'));}finally{event.target.value='';}};
// Recupera el borrador de la sesión en curso si se recargó/cerró sin finalizar.
(function restoreDraft(){
  const draft=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');
  // Un día elegido a mano sobrevive a que el sistema cierre la app, pero solo
  // unas horas: al día siguiente, una fecha vieja sin nada anotado es un despiste.
  const fechaReciente = draft?._datePicked && draft._savedAt && Date.now() - new Date(draft._savedAt) < 12*3600e3;
  if((draftHasContent(draft) || fechaReciente) && !yaGuardada(draft)) activeSession=draft; else clearDraft();
})();
renderActiveSession();updateDashboard();
// Un borrador de otro día no se reanuda como si fuera lo de hoy: se pregunta.
// Es el camino por el que el entrenamiento de hoy terminaba con fecha vieja.
(async () => {
  const d = activeSession?.date;
  if (!d || d === todayKey() || !draftHasContent(activeSession)) return;
  const seguir = await showConfirm(t('session.oldDraft', { date: dateFmt(d) }),
    { okText: t('session.oldDraftKeep'), cancelText: t('session.oldDraftDrop') });
  if (!seguir) { clearDraft(); activeSession = makeSession(); renderActiveSession(); }
})();
// Repintar parte de activeSession, que no se entera de lo agregado en pantalla:
// sin leer la pantalla primero (como hace setUnit), cambiar de idioma a mitad
// del entrenamiento borraba los movimientos cargados desde que se abrió la app.
window.onLangChange=()=>{ if(activeSession) activeSession=collectDraft(); renderTodayDates(); renderActiveSession(); updateDashboard(); };

if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('sw.js');

// Superficie para tests/index.html. Sin `type="module"` las `const` y `let` de
// nivel superior no quedan colgadas de `window`, así que hay que exponerlas a
// mano para poder probarlas desde fuera. Es solo un objeto: no cambia la app.
window.LOADOUT_TEST = {
  e1rm, exKey, getLastExercise, progressionFor, getActive: () => activeSession, toUnit, fromUnit, toDisplay, mergeTemplates, detectPRs, personalRecords, exercisesForRender, syncDraft,
  mergeDeleted, applyDeleted, draftInProgress, collectSession,
  getSessions: () => sessions, setSessions: v => { sessions = v; },
  getTemplates: () => templates, setTemplates: v => { templates = v; },
  getDeleted: () => deletedIds, setDeleted: v => { deletedIds = v; },
};
