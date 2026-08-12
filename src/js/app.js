const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];

// --- Diálogos con estilo (reemplazan alert/confirm nativos) ---
function openDialog(message, {okText='Aceptar', cancelText=null, danger=false} = {}) {
  return new Promise(resolve => {
    const overlay=$('#modalOverlay'), okBtn=$('#modalOk'), cancelBtn=$('#modalCancel');
    $('#modalMessage').textContent = message;
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
function showConfirm(message, opts = {}) { return openDialog(message, { okText: t('modal.confirm'), cancelText: t('modal.cancel'), ...opts }); }
const KEY = 'gymlog-sessions-v1';
const DRAFT_KEY = 'loadout-draft-v1';
let sessions = JSON.parse(localStorage.getItem(KEY) || '[]');
let activeSession = null;
let restoring = false; // evita reescribir el borrador mientras se pinta la sesión
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
  const exercises = $$('.exercise-card').map(card => ({
    name: $('.exercise-name', card).value,
    done: card.classList.contains('is-done'),
    sets: $$('.set-row', card).map(r => {
      const set = { weight: $('.set-weight', r).value, reps: $('.set-reps', r).value };
      if (r.dataset.targetWeight != null) set.targetWeight = num(r.dataset.targetWeight);
      if (r.dataset.targetReps != null) set.targetReps = num(r.dataset.targetReps);
      return set;
    }),
  }));
  // `_draft` marca que los pesos son texto tal cual se tecleó (no kg), y `_unit`
  // en qué unidad se escribieron, para reinterpretarlos bien al restaurar.
  return { ...activeSession, name: $('#sessionName').value, date: $('#sessionDate').value || activeSession?.date, exercises, _draft: true, _unit: unit() };
}
function draftHasContent(d) { return !!d && Array.isArray(d.exercises) && d.exercises.some(e => (e.name || '').trim() || e.sets?.some(s => s.weight || s.reps)); }
function saveDraft() {
  if (restoring || !activeSession) return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...collectDraft(), _savedAt: new Date().toISOString() }));
  renderLiveSummary();
  window.driveDraftChanged?.(); // sube el entrenamiento en curso, sin esperar al final
}
function clearDraft() { localStorage.removeItem(DRAFT_KEY); }
const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; } };
// ¿Hay un entrenamiento abierto ahora mismo en pantalla? Lo consulta la fusión
// antes de reiniciar la captura, para no borrar series a medio anotar.
const draftInProgress = () => { try { return !!activeSession && draftHasContent(collectDraft()); } catch { return false; } };

// Reconcilia el entrenamiento en curso con el que venga de Drive. Regla dura:
// nunca pisa trabajo que esté abierto aquí; solo rellena cuando este dispositivo
// no tiene nada a medias. Devuelve true si cambió algo.
function syncDraft(remote) {
  const local = readDraft();
  // Se terminó en otro dispositivo: el borrador de aquí ya es historia.
  if (local?.id && sessions.some(s => s.id === local.id)) {
    clearDraft();
    if (activeSession?.id === local.id) { activeSession = makeSession(); renderActiveSession(); }
    return true;
  }
  if (!draftHasContent(remote) || draftHasContent(local)) return false;
  if (local?._savedAt && remote._savedAt && remote._savedAt <= local._savedAt) return false;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(remote));
  activeSession = remote;
  renderActiveSession();
  return true;
}
const dateFmt = d => new Intl.DateTimeFormat(dateLocale(), {day:'numeric', month:'short', year:'numeric'}).format(new Date(d+'T12:00'));
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
const pinnedFor = name => templates.find(x=>(x.name||'').trim().toLowerCase()===(name||'').trim().toLowerCase());
// Fusiona lo fijado con lo entrenado en una lista sola, sin repetir nombres.
// Las fijadas van primero; el resto, por lo más reciente.
function routineEntries(filter='') {
  const term=filter.trim().toLowerCase();
  const byKey=new Map();
  for (const tpl of templates) {
    const name=(tpl.name||'').trim(); if(!name) continue;
    byKey.set(name.toLowerCase(), {name, pinned:true, tplId:tpl.id, moves:(tpl.exercises||[]).length});
  }
  for (const r of routineSummaries()) {
    const key=r.name.toLowerCase(); const prev=byKey.get(key);
    if(prev) Object.assign(prev, {date:r.date, times:r.times});
    else byKey.set(key, {...r, pinned:false});
  }
  return [...byKey.values()]
    .filter(r=>r.name.toLowerCase().includes(term))
    .sort((a,b)=> (b.pinned-a.pinned) || (b.date||'').localeCompare(a.date||'') || a.name.localeCompare(b.name));
}
// La línea de detalle dice las dos cosas que importan: si es un plan fijo y
// cuánto hace que la entrenaste. Una fijada que nunca hiciste solo cuenta sus
// movimientos; una sin fijar mantiene el detalle de siempre.
function routineMeta(r) {
  const trained = r.date
    ? `${daysAgoLabel(r.date)} · ${r.moves} ${t('routine.moves')} · ${r.times} ${r.times===1?t('routine.time'):t('routine.times')}`
    : '';
  if(!r.pinned) return trained;
  return trained ? `${t('routine.pinnedPrefix')} · ${trained}` : t('routine.pinnedMeta',{n:r.moves});
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
  panel.innerHTML=items.map(r=>`<div class="routine-row${r.pinned?' is-pinned':''}">`
    +`<button type="button" class="routine-option" role="option" data-name="${escapeHtml(r.name)}"><span class="routine-option-name">${escapeHtml(r.name)}</span><span class="routine-option-meta">${routineMeta(r)}</span></button>`
    +`<button type="button" class="routine-pin" data-pin="${escapeHtml(r.name)}" aria-pressed="${r.pinned}" title="${r.pinned?t('routine.unpin'):t('routine.pin')}" aria-label="${t('routine.pinAria')}">📌</button>`
    +`</div>`).join('');
  $$('.routine-option',panel).forEach(b=>b.onclick=()=>openRoutine(b.dataset.name));
  $$('.routine-pin',panel).forEach(b=>b.onclick=e=>{ e.stopPropagation(); togglePin(b.dataset.pin); });
}
// Abrir una rutina carga sus movimientos, venga el plan de estar fijado o de la
// última sesión. Un solo gesto, un solo resultado: por eso desapareció el botón
// "Cargar rutina anterior", que hacía justo esto pero por otro camino.
async function openRoutine(name) {
  const tpl=pinnedFor(name);
  if(tpl) return applyTemplate(tpl.id);
  const prev=lastSessionByRoutine(name);
  closeRoutinePanel();
  if(!prev){ pickRoutine(name); return; }
  if($('#exerciseList').children.length && !(await showConfirm(t('routine.loadConfirm'), {danger:true, okText:t('routine.loadOk')}))) return;
  $('#sessionName').value=name; if(activeSession) activeSession.name=name; syncPinButton();
  $('#exerciseList').innerHTML=''; $('#sessionEmpty').hidden=true;
  // Se cargan colapsados: solo trabajas uno a la vez, lo abres cuando te toca.
  prev.exercises.forEach(e=>addExercise({name:e.name, sets:e.sets.map(s=>({targetWeight:s.weight, targetReps:s.reps}))}));
  openFirstPending();
  if(!$('#exerciseList').children.length)$('#sessionEmpty').hidden=false;
  saveDraft();
}
// El 📌 de cada fila fija con lo que ya entrenaste esa vez; el de la barra usa
// lo que hay en pantalla. Quitar el pin nunca borra entrenamientos.
async function togglePin(name) {
  const tpl=pinnedFor(name);
  if(tpl){ await deleteTemplate(tpl.id); renderRoutinePanel($('#sessionName').value); syncPinButton(); return; }
  const prev=lastSessionByRoutine(name);
  if(!prev){ await showAlert(t('template.needSession',{name})); return; }
  const exercises=prev.exercises.map(e=>({name:e.name, sets:(e.sets||[]).map(s=>({weight:s.weight, reps:s.reps}))})).filter(e=>e.name&&e.sets.length);
  if(!exercises.length){ await showAlert(t('template.needSession',{name})); return; }
  templates.push(makeTemplate(name.trim(), exercises));
  saveTemplates(); window.renderConfig?.(); window.driveAutoSync?.();
  renderRoutinePanel($('#sessionName').value); syncPinButton();
  await showAlert(t('template.saved',{name}));
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
  syncPinButton(); closeRoutinePanel();
}
// Cargar una plantilla llena la sesión con sus movimientos colapsados y sus
// pesos previstos como marca a superar, igual que "cargar rutina anterior".
async function applyTemplate(id) {
  const tpl=templates.find(x=>x.id===id); if(!tpl) return;
  closeRoutinePanel();
  if($('#exerciseList').children.length && !(await showConfirm(t('routine.loadConfirm'), {danger:true, okText:t('routine.loadOk')}))) return;
  $('#sessionName').value=tpl.name; if(activeSession) activeSession.name=tpl.name; syncPinButton();
  $('#exerciseList').innerHTML=''; $('#sessionEmpty').hidden=true;
  (tpl.exercises||[]).forEach(e=>addExercise({name:e.name, sets:(e.sets||[]).map(s=>({targetWeight:s.weight, targetReps:s.reps}))}));
  openFirstPending();
  if(!$('#exerciseList').children.length) $('#sessionEmpty').hidden=false;
  saveDraft();
}
// Para una plantilla vale tanto lo tecleado como lo previsto (los objetivos en
// gris), así una rutina recién cargada se puede convertir en plan tal cual.
function collectTemplateExercises() {
  return $$('.exercise-card').map(card=>({
    name:$('.exercise-name',card).value.trim(),
    sets:$$('.set-row',card).map(r=>{
      const typedW=$('.set-weight',r).value.trim(), typedR=$('.set-reps',r).value.trim();
      return {
        weight: typedW ? fromDisplay(num(typedW)) : (r.dataset.targetWeight!=null ? num(r.dataset.targetWeight) : 0),
        reps:   typedR ? num(typedR)             : (r.dataset.targetReps!=null   ? num(r.dataset.targetReps)   : 0),
      };
    }).filter(s=>s.weight||s.reps),
  })).filter(e=>e.name && e.sets.length);
}
// El botón de la barra refleja el estado de la rutina que tienes escrita: fija
// la de ahora, o la suelta si ya lo estaba. Sin él, fijar solo se podría hacer
// desde el panel, y justo al terminar de armar la sesión es cuando apetece.
function syncPinButton() {
  const btn=$('#pinRoutine'); if(!btn) return;
  const pinned=!!pinnedFor($('#sessionName').value);
  btn.textContent=pinned ? t('routine.unpin') : t('routine.pin');
  btn.setAttribute('aria-pressed', String(pinned));
  btn.classList.toggle('is-pinned', pinned);
}
async function toggleCurrentPin() {
  const name=$('#sessionName').value.trim();
  if(!name){ await showAlert(t('template.needName')); return; }
  const existing=pinnedFor(name);
  const exercises=collectTemplateExercises();
  // Con la sesión vacía, el botón solo sirve para soltar lo que ya estaba fijo.
  if(existing && !exercises.length){ await deleteTemplate(existing.id); syncPinButton(); return; }
  if(!exercises.length){ await showAlert(t('template.needExercises')); return; }
  if(existing){
    if(!(await showConfirm(t('template.overwrite',{name}), {okText:t('template.overwriteOk')}))) return;
    Object.assign(existing, {name, exercises, updatedAt:new Date().toISOString()});
  } else templates.push(makeTemplate(name, exercises));
  saveTemplates(); window.renderConfig?.(); window.driveAutoSync?.(); syncPinButton();
  await showAlert(t('template.saved',{name}));
}
// --- Primer arranque --------------------------------------------------------
// Una app de registro vacía no explica nada por sí sola: hasta que haya algo
// guardado, la pantalla vacía enseña los tres pasos y ofrece un plan de ejemplo.
function exampleTemplateSeed() {
  const reps=(w,r,n=3)=>Array.from({length:n},()=>({weight:w,reps:r}));
  return { name:t('example.name'), exercises:[
    { name:t('example.squat'), sets:reps(40,5) },
    { name:t('example.bench'), sets:reps(30,5) },
    { name:t('example.row'),   sets:reps(30,8) },
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
  saveTemplates(); window.renderConfig?.(); window.driveAutoSync?.(); syncPinButton();
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
function lastSessionByRoutine(name) { const key=name.trim().toLowerCase(); if(!key) return null; return sessions.filter(s=>s.id!==activeSession?.id && (s.name||'').trim().toLowerCase()===key).sort((a,b)=>b.date.localeCompare(a.date))[0]||null; }
function getLastExercise(name) {
  const key = name.trim().toLowerCase(); if (!key) return null;
  return sessions.filter(s => s.id !== activeSession?.id).sort((a,b)=>b.date.localeCompare(a.date)).flatMap(s=>s.exercises.map(e=>({...e,date:s.date}))).find(e=>e.name.trim().toLowerCase()===key);
}
function updateLast(card) { const e = getLastExercise($('.exercise-name', card).value); $('.last-time', card).textContent = e ? t('exercise.last',{date:dateFmt(e.date), sets:e.sets.map(s=>`${showW(s.weight)} × ${s.reps}`).join(' / ')}) : t('exercise.noLast'); }
// `values.weight`/`values.reps` llegan listos para pintar (ya en la unidad
// activa). `targetWeight` es la marca a superar y va SIEMPRE en kg: se guarda en
// el dataset para sobrevivir a una recarga y a un cambio de unidad.
function addSet(card, values = {}) {
  const node = $('#setTemplate').content.firstElementChild.cloneNode(true); $('.set-weight',node).value = values.weight ?? ''; $('.set-reps',node).value = values.reps ?? '';
  if (values.targetWeight != null) node.dataset.targetWeight = values.targetWeight;
  if (values.targetReps != null) node.dataset.targetReps = values.targetReps;
  $('.set-weight',node).placeholder = values.targetWeight != null ? `${toDisplay(values.targetWeight)} ${unitLabel()}` : unitLabel();
  $('.set-reps',node).placeholder = values.targetReps != null ? `${values.targetReps} ${t('set.repsPlaceholder')}` : t('set.repsPlaceholder');
  $('.remove-set',node).title = t('set.removeTitle');
  $('.set-rows',card).append(node); refreshSetNumbers(card);
  $('.remove-set',node).onclick = () => { node.remove(); refreshSetNumbers(card); saveDraft(); };
}
function refreshSetNumbers(card) { $$('.set-number',card).forEach((n,i)=>n.textContent=`${String(i+1).padStart(2,'0')}`); }
// Resumen compacto que se muestra cuando el movimiento está colapsado/terminado.
function exerciseSummaryText(card) {
  // Usa el valor tecleado; si está vacío, cae al objetivo (placeholder) de la rutina.
  const sets=$$('.set-row',card).map(r=>{
    const w=$('.set-weight',r), reps=$('.set-reps',r);
    return { w:num(w.value)||parseFloat(w.placeholder)||0, reps:num(reps.value)||parseFloat(reps.placeholder)||0 };
  }).filter(s=>s.w||s.reps);
  return sets.length ? sets.map(s=>`${s.w}×${s.reps}`).join(' · ') : t('exercise.noSets');
}
// Plegado y "terminado" eran lo mismo, y por eso una rutina recién cargada ya
// se contaba entera como hecha. Ahora son dos cosas: `is-collapsed` es dónde
// estás parado (lo mueve el acordeón) y `is-done` es lo que ya trabajaste.
function setCollapsed(card, collapsed, done) {
  card.classList.toggle('is-collapsed', collapsed);
  if (done !== undefined) card.classList.toggle('is-done', done);
  const summary=$('.exercise-summary',card);
  summary.hidden=!collapsed; if(collapsed) summary.textContent=exerciseSummaryText(card);
  const isDone=card.classList.contains('is-done');
  const btn=$('.collapse-exercise',card);
  btn.textContent=isDone?'↺':'✓'; btn.title=t(isDone?'exercise.expand':'exercise.collapse');
}
// Un solo movimiento abierto a la vez: con seis ejercicios desplegados el móvil
// era un scroll interminable y se perdía de vista en cuál estabas.
function openOnly(card) {
  $$('.exercise-card').forEach(c => { if (c !== card) setCollapsed(c, true); });
  if (card) setCollapsed(card, false);
  return card;
}
// Al entrar a una sesión siempre queda uno listo para escribir: el primero que
// falta. Si ya está todo hecho, no se abre ninguno.
function openFirstPending() {
  openOnly($$('.exercise-card').find(c => !c.classList.contains('is-done')) || null);
}
function addExercise(data = {}) {
  $('#sessionEmpty').hidden = true;
  const card = $('#exerciseTemplate').content.firstElementChild.cloneNode(true); $('.exercise-name',card).value = data.name || '';
  $('.exercise-name',card).placeholder = t('exercise.namePlaceholder');
  $('.remove-exercise',card).title = t('exercise.removeTitle');
  $('.collapse-exercise',card).title = t('exercise.collapse');
  $$('.set-labels span',card).forEach((el,i)=>{ el.textContent = [t('set.label.set'),t('set.label.load',{unit:unitLabel().toUpperCase()}),t('set.label.reps'),''][i] ?? ''; });
  $('.add-set',card).textContent = t('set.add');
  (data.sets?.length ? data.sets : [{}]).forEach(s=>addSet(card,s));
  // Autocompletado propio de nombres (reemplaza el datalist nativo, de estilo pobre).
  const nameInput = $('.exercise-name',card), acPanel = $('.ac-panel',card);
  const renderAc = () => {
    const term = nameInput.value.trim().toLowerCase();
    const items = exerciseNames().filter(n => n.toLowerCase().includes(term)).slice(0,8);
    if (!items.length || (items.length===1 && items[0].toLowerCase()===term)) { acPanel.hidden=true; nameInput.setAttribute('aria-expanded','false'); return; }
    acPanel.innerHTML = items.map(n=>`<button type="button" class="ac-option" role="option">${escapeHtml(n)}</button>`).join('');
    $$('.ac-option',acPanel).forEach(b=>b.onclick=()=>{ nameInput.value=b.textContent; acPanel.hidden=true; nameInput.setAttribute('aria-expanded','false'); updateLast(card); saveDraft(); });
    acPanel.hidden=false; nameInput.setAttribute('aria-expanded','true');
  };
  nameInput.oninput = () => { updateLast(card); renderAc(); };
  nameInput.onfocus = renderAc;
  nameInput.onblur = () => { updateLast(card); setTimeout(()=>{ acPanel.hidden=true; nameInput.setAttribute('aria-expanded','false'); }, 150); };
  nameInput.onkeydown = e => { if (e.key==='Escape') { acPanel.hidden=true; nameInput.setAttribute('aria-expanded','false'); } };
  $('.add-set',card).onclick = () => { const last=$$('.set-row',card).at(-1); addSet(card, last?{weight:$('.set-weight',last).value, reps:$('.set-reps',last).value}:{}); saveDraft(); }; $('.remove-exercise',card).onclick = () => { card.remove(); if(!$('#exerciseList').children.length) $('#sessionEmpty').hidden=false; saveDraft(); };
  $('.collapse-exercise',card).onclick = e => {
    e.stopPropagation();
    if (card.classList.contains('is-done')) { card.classList.remove('is-done'); openOnly(card); }
    else setCollapsed(card, true, true);
    saveDraft();
  };
  // Tocar la tarjeta plegada en cualquier parte la abre y pliega las demás: en
  // el gimnasio se apunta con el pulgar, apuntarle a la flecha es pedir mucho.
  card.addEventListener('click', e => {
    if (!card.classList.contains('is-collapsed')) return;
    if (e.target.closest('.collapse-exercise, .remove-exercise')) return;
    openOnly(card);
    saveDraft();
  });
  $('#exerciseList').append(card); updateLast(card);
  setCollapsed(card, true, !!data.done); // quién queda abierto lo decide el acordeón
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
  restoring = true;
  $('#exerciseList').innerHTML=''; $('#sessionEmpty').hidden=true;
  if (!activeSession) activeSession = makeSession();
  const saved = sessions.some(s=>s.id===activeSession.id);
  paintSessionChrome();
  $('#sessionName').value = activeSession.name || '';
  $('#sessionDate').value = activeSession.date || todayKey();
  $('#deleteSession').hidden = !saved;
  refreshDatalists(); syncPinButton();
  if (!activeSession.exercises.length) $('#sessionEmpty').hidden=false; else { exercisesForRender(activeSession).forEach(e=>addExercise(e)); openFirstPending(); }
  restoring = false;
  renderLiveSummary();
}
// Editar un entrenamiento ya guardado se veía igual que empezar uno nuevo, y el
// botón seguía diciendo "finalizar": parecía que iba a crear otro registro. Acá
// se marca el encabezado y se cambia la etiqueta a "guardar cambios".
// Se escribe también data-i18n para que un cambio de idioma no lo pise.
function paintSessionChrome() {
  const editing = !!activeSession && captureMode !== 'cardio' && sessions.some(s => s.id === activeSession.id);
  const title = $('#sessionTitle'), eyebrow = $('#sessionEyebrow'), label = $('#finishSessionLabel');
  // Con el capturador en modo cardio el encabezado es suyo, no el de la sesión de fuerza.
  if (captureMode === 'cardio') {
    title.textContent = t('cardio.title');
  } else {
    title.textContent = editing
      ? t('session.editing', { date: dateFmt(activeSession?.date || todayKey()) })
      : t('session.current');
  }
  eyebrow.dataset.i18n = editing ? 'session.eyebrowEditing' : 'session.eyebrow';
  eyebrow.textContent = t(eyebrow.dataset.i18n);
  label.dataset.i18n = editing ? 'session.saveEdit' : 'session.finish';
  label.textContent = t(label.dataset.i18n);
  $('#sessionView').classList.toggle('is-editing', editing);
}
// Panel lateral en vivo (desktop) / resumen sobre "Finalizar" (móvil).
function renderLiveSummary() {
  const root = $('#liveSummary'); if (!root) return;
  const cards = $$('.exercise-card');
  if (!cards.length) { root.hidden = true; return; }
  let done = 0, sets = 0, vol = 0;
  cards.forEach(card => {
    if (card.classList.contains('is-done')) done++;
    $$('.set-row', card).forEach(r => {
      const w = num($('.set-weight', r).value) || parseFloat($('.set-weight', r).placeholder) || 0;
      const reps = num($('.set-reps', r).value) || parseFloat($('.set-reps', r).placeholder) || 0;
      if (w || reps) sets++;
      vol += w * reps;
    });
  });
  const nf = n => Math.round(n).toLocaleString(dateLocale());
  root.hidden = false;
  root.innerHTML = `<span class="ls-title">${t('live.title')}</span><div class="ls-grid">`
    + `<div class="ls-cell"><b>${done}/${cards.length}</b><i>${t('live.moves')}</i></div>`
    + `<div class="ls-cell"><b>${sets}</b><i>${t('live.sets')}</i></div>`
    + `<div class="ls-cell"><b>${nf(vol)}<em style="font-style:normal;font-size:.6em;color:var(--muted)"> ${unitLabel()}</em></b><i>${t('live.volume')}</i></div>`
    + `</div>`;
}
function collectSession() {
  // Lo tecleado está en la unidad activa; al historial va siempre en kg.
  const exercises = $$('.exercise-card').map(card => ({name:$('.exercise-name',card).value.trim(), sets:$$('.set-row',card).map(r=>({weight:fromDisplay(num($('.set-weight',r).value)),reps:num($('.set-reps',r).value)})).filter(s=>s.weight||s.reps)})).filter(e=>e.name && e.sets.length);
  // `_draft`/`_unit` son marcas del borrador: no deben acabar en el historial, o
  // al reabrir la sesión sus kilos se releerían como si fueran otra unidad.
  const {_draft, _unit, ...base} = activeSession || {};
  return {...base, name:$('#sessionName').value.trim(), exercises};
}
async function finishSession() {
  const entry=collectSession(); if(!entry.exercises.length){ await showAlert(t('session.needExercise')); return; }
  entry.updatedAt=new Date().toISOString(); // sella la edición para resolver conflictos al fusionar con Drive
  const index=sessions.findIndex(s=>s.id===entry.id); if(index>=0)sessions[index]=entry;else sessions.push(entry); save(); clearDraft(); const prs=detectPRs(entry); activeSession=makeSession(); renderActiveSession(); updateDashboard(); stopRest();
  const uploading = window.driveAutoSync?.();
  await showAlert(prs.length?t('session.pr',{list:prs.join('\n')}):t('session.saved'));
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
  sessions.forEach(s=>{ new Set(s.exercises.map(e=>e.name.trim().toLowerCase()).filter(Boolean)).forEach(k=>freq.set(k,(freq.get(k)||0)+1));
    s.exercises.forEach(e=>{ const k=e.name.trim().toLowerCase(); if(k&&!label.has(k)) label.set(k,e.name.trim()); }); });
  let key=null,c=0; freq.forEach((v,k)=>{ if(v>c){c=v;key=k;} });
  return key ? {key, name:label.get(key)} : null;
}
function exerciseRecords(key) {
  return [...sessions].sort((a,b)=>a.date.localeCompare(b.date))
    .flatMap(s=>s.exercises.filter(e=>e.name.trim().toLowerCase()===key).map(e=>({date:s.date, e1rm:Math.max(0,...e.sets.map(e1rm))})))
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
function weekStrip() {
  const letters=t('week.days').split(' ');
  const today=new Date(), tKey=todayKey();
  const monday=new Date(today); monday.setDate(today.getDate()-((today.getDay()+6)%7));
  const active=new Set(trainedDates());
  const days=[];
  for(let i=0;i<7;i++){ const d=new Date(monday); d.setDate(monday.getDate()+i); const key=keyOf(d);
    days.push({ key, letter:letters[i]||'', trained:active.has(key), isToday:key===tKey, future:key>tKey }); }
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
function personalRecords() {
  const map=new Map();
  [...sessions].sort((a,b)=>a.date.localeCompare(b.date)).forEach(s=>{
    s.exercises.forEach(e=>{ const key=e.name.trim().toLowerCase(); if(!key) return;
      const best=e.sets.reduce((b,x)=> e1rm(x)>(b?e1rm(b):-1) ? x : b, null);
      if(!best || !e1rm(best)) return;
      const cur=map.get(key);
      if(!cur || e1rm(best)>cur.e1rm) map.set(key,{name:e.name.trim(), set:best, e1rm:e1rm(best), date:s.date}); });
  });
  return [...map.values()].sort((a,b)=> b.date.localeCompare(a.date) || b.e1rm-a.e1rm);
}
function renderSummary() {
  const nf=n=>Math.round(n).toLocaleString(dateLocale());
  const st=strengthTrend(), strengthCard=$('#cardStrength');
  if(st){
    const delta = st.pct==null ? `<small>${t('summary.strengthBase')}</small>`
      : `<small class="delta ${st.pct>=0?'up':'down'}">${st.pct>=0?'▲':'▼'} ${Math.abs(st.pct)}% · 30D</small>`;
    strengthCard.innerHTML=`<span>${t('summary.strength')} · ${escapeHtml(st.name)}</span><strong>${nf(toDisplay(st.e1rm))} <em>${unitLabel()}</em></strong>${delta}`;
  } else strengthCard.innerHTML=`<span>${t('summary.strength')}</span><strong>—</strong><small>${t('summary.noData')}</small>`;
  const strip=weekStrip(), trained=strip.filter(d=>d.trained).length;
  const cal=strip.map(d=>`<span class="wd${d.trained?' on':''}${d.isToday?' today':''}${d.future?' future':''}">${d.letter}</span>`).join('');
  $('#cardConsistency').innerHTML=`<span>${t('summary.consistency')}</span><strong>${trained}<em>/7</em></strong><div class="week-cal">${cal}</div><small>${t('summary.streak',{n:weekStreak()})}</small>`;
  const vd=volumeDelta();
  const loadDelta = vd.pct==null ? `<small>${t('summary.loadFirst')}</small>`
    : `<small class="delta neutral">${vd.pct>=0?'▲':'▼'} ${Math.abs(vd.pct)}% ${t('summary.vsPrev')}</small>`;
  $('#cardLoad').innerHTML=`<span>${t('summary.load')}</span><strong>${nf(toDisplay(vd.current))} <em>${unitLabel()}</em></strong>${loadDelta}`;
}
function renderPRs() {
  const root=$('#prList'); if(!root) return;
  const prs=personalRecords();
  if(!prs.length){ root.innerHTML=`<p class="no-data">${t('pr.none')}</p>`; return; }
  root.innerHTML=prs.slice(0,10).map(r=>`<div class="pr-row"><span class="pr-name">${escapeHtml(r.name)}</span><span class="pr-set">${toDisplay(r.set.weight)}×${r.set.reps}</span><strong class="pr-e1rm">${Math.round(toDisplay(r.e1rm))} ${unitLabel()}</strong><span class="pr-date">${dateFmt(r.date)}</span></div>`).join('');
}
function updateDashboard() {
  renderSummary(); renderHistory(); populateProgress(); renderPRs(); renderCardio(); renderOnboarding(); window.renderConfig?.(); window.renderBackupStatus?.(); window.renderSnapshotStatus?.();
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
      const moves=s.exercises.map(e=>`<div class="history-move"><span>${escapeHtml(e.name)}</span><small>${e.sets.map(x=>`${toDisplay(x.weight)}×${x.reps}`).join(' · ')}</small></div>`).join('');
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
  return $$('.exercise-card').some(card =>
    $('.exercise-name',card).value.trim() ||
    $$('.set-row',card).some(r=>$('.set-weight',r).value.trim()||$('.set-reps',r).value.trim()));
}
async function editSession(id) {
  const s=sessions.find(x=>x.id===id); if(!s) return;
  // Evita pisar el progreso del día sin querer al abrir una rutina vieja para editarla.
  if(hasUnsavedSession() && !(await showConfirm(t('session.switchConfirm'), {danger:true, okText:t('session.switchOk')}))) return;
  activeSession=JSON.parse(JSON.stringify(s)); renderActiveSession();
  $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view==='session')); $$('.view').forEach(v=>v.classList.toggle('active',v.id==='sessionView'));
  $('#sessionView').scrollIntoView({behavior:'smooth'});
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
  const topLabel=r=> r.top ? `${toDisplay(r.top.weight)}×${r.top.reps}` : '—';
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

// --- Barra de indicadores colapsable (recordada) ---
const SUMMARY_KEY='loadout-summary-collapsed';
function applySummaryCollapsed(c){ $('#summaryWrap')?.classList.toggle('is-collapsed',c); $('#summaryToggle')?.setAttribute('aria-expanded',String(!c)); }
$('#summaryToggle')?.addEventListener('click',()=>{ const c=!$('#summaryWrap').classList.contains('is-collapsed'); localStorage.setItem(SUMMARY_KEY,c?'1':'0'); applySummaryCollapsed(c); });
applySummaryCollapsed(localStorage.getItem(SUMMARY_KEY)==='1');

// --- Récords personales ---
function detectPRs(entry){
  const prs=[];
  for(const ex of entry.exercises){
    const key=ex.name.trim().toLowerCase(); const newMax=Math.max(...ex.sets.map(s=>s.weight),0); if(!newMax)continue;
    const oldMax=Math.max(0,...sessions.filter(s=>s.id!==entry.id).flatMap(s=>s.exercises.filter(e=>e.name.trim().toLowerCase()===key)).flatMap(e=>e.sets.map(x=>x.weight)));
    if(oldMax&&newMax>oldMax)prs.push(t('pr.line',{name:ex.name, now:showW(newMax), before:showW(oldMax)}));
  }
  return prs;
}

function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function renderTodayDates(){
  $('#today').textContent=new Intl.DateTimeFormat(dateLocale(),{weekday:'long',day:'numeric',month:'long'}).format(new Date());
}
renderTodayDates();
$('#addExercise').onclick=()=>{ openOnly(addExercise()); saveDraft(); }; $('#emptyAddExercise').onclick=()=>{ openOnly(addExercise()); saveDraft(); }; $('#finishSession').onclick=finishSession;
$('#pinRoutine').onclick=toggleCurrentPin;
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
$('#sessionDate').onchange=()=>{ if(activeSession && $('#sessionDate').value) activeSession.date=$('#sessionDate').value; saveDraft(); };
$('#sessionName').oninput=()=>{ if(activeSession)activeSession.name=$('#sessionName').value; openRoutinePanel(); syncPinButton(); saveDraft(); };
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
  if(!$('#exerciseList').children.length)return;
  if(!(await showConfirm(t('session.clearConfirm'), {danger:true, okText:t('session.clearOk')})))return;
  $('#exerciseList').innerHTML=''; $('#sessionEmpty').hidden=false; saveDraft();
};
$('#deleteSession').onclick=async ()=>{if(await showConfirm(t('session.deleteConfirm'), {danger:true, okText:t('session.deleteOk')})){window.snapshot?.(t('session.deleteSnapReason'));markDeleted(activeSession.id);sessions=sessions.filter(s=>s.id!==activeSession.id);save();clearDraft();activeSession=makeSession();renderActiveSession();updateDashboard();window.driveAutoSync?.();}};
$$('.tab').forEach(t=>t.onclick=()=>{$$('.tab').forEach(x=>x.classList.toggle('active',x===t));$$('.view').forEach(v=>v.classList.toggle('active',v.id===`${t.dataset.view}View`));if(t.dataset.view==='progress')populateProgress();if(t.dataset.view==='history')renderHistory();if(t.dataset.view==='records')renderPRs();if(t.dataset.view==='config')window.renderConfig?.();});
$('#historySearch').oninput=renderHistory; $('#historyPeriod').onchange=renderHistory; $('#progressExercise').onchange=renderProgress; $('#themeButton').onclick=()=>document.body.classList.toggle('dark');
$('#exportData').onclick=()=>{const payload={app:'LOADOUT',version:1,exportedAt:new Date().toISOString(),sessions,templates,cardio,deleted:deletedIds};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`${t('export.filename')}-${todayKey()}.json`;link.click();URL.revokeObjectURL(link.href);window.markBackupDone?.();};
$('#importData').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{const payload=JSON.parse(await file.text());if(!Array.isArray(payload.sessions))throw new Error();if(!(await showConfirm(t('import.confirm',{n:payload.sessions.length}),{danger:true,okText:t('import.ok')})))return;window.snapshot?.(t('import.reason'));deletedIds=mergeDeleted(deletedIds,payload.deleted);saveDeleted();sessions=payload.sessions;if(Array.isArray(payload.templates)){templates=payload.templates;saveTemplates();}if(Array.isArray(payload.cardio)){cardio=payload.cardio;saveCardio();}save();clearDraft();activeSession=makeSession();renderActiveSession();updateDashboard();await showAlert(t('import.done'));}catch{await showAlert(t('import.invalid'));}finally{event.target.value='';}};
// Recupera el borrador de la sesión en curso si se recargó/cerró sin finalizar.
(function restoreDraft(){
  const draft=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');
  if(draftHasContent(draft)) activeSession=draft; else clearDraft();
})();
renderActiveSession();updateDashboard();
window.onLangChange=()=>{ renderTodayDates(); renderActiveSession(); updateDashboard(); };

if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('sw.js');

// Superficie para tests/index.html. Sin `type="module"` las `const` y `let` de
// nivel superior no quedan colgadas de `window`, así que hay que exponerlas a
// mano para poder probarlas desde fuera. Es solo un objeto: no cambia la app.
window.LOADOUT_TEST = {
  e1rm, toUnit, fromUnit, toDisplay, mergeTemplates, detectPRs, personalRecords, exercisesForRender,
  mergeDeleted, applyDeleted,
  getSessions: () => sessions, setSessions: v => { sessions = v; },
  getTemplates: () => templates, setTemplates: v => { templates = v; },
  getDeleted: () => deletedIds, setDeleted: v => { deletedIds = v; },
};
