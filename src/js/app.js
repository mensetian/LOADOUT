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

// --- Borrador de la sesión en curso -----------------------------------------
// Guarda todo lo tecleado (aunque esté a medias) para no perderlo al recargar.
function collectDraft() {
  const exercises = $$('.exercise-card').map(card => ({
    name: $('.exercise-name', card).value,
    done: card.classList.contains('is-collapsed'),
    sets: $$('.set-row', card).map(r => ({ weight: $('.set-weight', r).value, reps: $('.set-reps', r).value })),
  }));
  return { ...activeSession, name: $('#sessionName').value, date: $('#sessionDate').value || activeSession?.date, exercises };
}
function draftHasContent(d) { return !!d && Array.isArray(d.exercises) && d.exercises.some(e => (e.name || '').trim() || e.sets?.some(s => s.weight || s.reps)); }
function saveDraft() { if (restoring || !activeSession) return; localStorage.setItem(DRAFT_KEY, JSON.stringify(collectDraft())); }
function clearDraft() { localStorage.removeItem(DRAFT_KEY); }
const dateFmt = d => new Intl.DateTimeFormat(dateLocale(), {day:'numeric', month:'short', year:'numeric'}).format(new Date(d+'T12:00'));
// Fecha local (no UTC): con toISOString por la noche saltaba al día siguiente.
const todayKey = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

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
function renderRoutinePanel(filter='') {
  const term=filter.trim().toLowerCase();
  const items=routineSummaries().filter(r=>r.name.toLowerCase().includes(term));
  const panel=$('#routinePanel');
  if(!items.length){
    panel.innerHTML=`<p class="routine-empty">${sessions.some(s=>(s.name||'').trim())
      ? t('routine.empty.some')
      : t('routine.empty.none')}</p>`;
    return;
  }
  panel.innerHTML=items.map(r=>`<button type="button" class="routine-option" role="option" data-name="${escapeHtml(r.name)}"><span class="routine-option-name">${escapeHtml(r.name)}</span><span class="routine-option-meta">${daysAgoLabel(r.date)} · ${r.moves} ${t('routine.moves')} · ${r.times} ${r.times===1?t('routine.time'):t('routine.times')}</span></button>`).join('');
  $$('.routine-option',panel).forEach(b=>b.onclick=()=>pickRoutine(b.dataset.name));
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
function updateLast(card) { const e = getLastExercise($('.exercise-name', card).value); $('.last-time', card).textContent = e ? t('exercise.last',{date:dateFmt(e.date), sets:e.sets.map(s=>`${s.weight} kg × ${s.reps}`).join(' / ')}) : t('exercise.noLast'); }
function addSet(card, values = {}) {
  const node = $('#setTemplate').content.firstElementChild.cloneNode(true); $('.set-weight',node).value = values.weight ?? ''; $('.set-reps',node).value = values.reps ?? '';
  $('.set-weight',node).placeholder = values.targetWeight != null ? `${values.targetWeight} kg` : t('set.weightPlaceholder');
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
    return { w:w.value||parseFloat(w.placeholder)||0, reps:reps.value||parseFloat(reps.placeholder)||0 };
  }).filter(s=>s.w||s.reps);
  return sets.length ? sets.map(s=>`${s.w}×${s.reps}`).join(' · ') : t('exercise.noSets');
}
function setCollapsed(card, collapsed) {
  card.classList.toggle('is-collapsed', collapsed);
  const summary=$('.exercise-summary',card);
  summary.hidden=!collapsed; if(collapsed) summary.textContent=exerciseSummaryText(card);
  const btn=$('.collapse-exercise',card);
  btn.textContent=collapsed?'↺':'✓'; btn.title=t(collapsed?'exercise.expand':'exercise.collapse');
}
function addExercise(data = {}) {
  $('#sessionEmpty').hidden = true;
  const card = $('#exerciseTemplate').content.firstElementChild.cloneNode(true); $('.exercise-name',card).value = data.name || '';
  $('.exercise-name',card).placeholder = t('exercise.namePlaceholder');
  $('.remove-exercise',card).title = t('exercise.removeTitle');
  $('.collapse-exercise',card).title = t('exercise.collapse');
  $$('.set-labels span',card).forEach((el,i)=>{ el.textContent = [t('set.label.set'),t('set.label.load'),t('set.label.reps'),''][i] ?? ''; });
  $('.add-set',card).textContent = t('set.add');
  (data.sets?.length ? data.sets : [{}]).forEach(s=>addSet(card,s));
  $('.exercise-name',card).oninput = () => updateLast(card); $('.exercise-name',card).onblur = () => updateLast(card);
  $('.add-set',card).onclick = () => { const last=$$('.set-row',card).at(-1); addSet(card, last?{weight:$('.set-weight',last).value, reps:$('.set-reps',last).value}:{}); saveDraft(); }; $('.remove-exercise',card).onclick = () => { card.remove(); if(!$('#exerciseList').children.length) $('#sessionEmpty').hidden=false; saveDraft(); };
  $('.collapse-exercise',card).onclick = () => { setCollapsed(card, !card.classList.contains('is-collapsed')); saveDraft(); };
  $('#exerciseList').append(card); updateLast(card);
  if(data.done) setCollapsed(card, true);
}
function renderActiveSession() {
  restoring = true;
  $('#exerciseList').innerHTML=''; $('#sessionEmpty').hidden=true;
  if (!activeSession) activeSession = makeSession();
  const saved = sessions.some(s=>s.id===activeSession.id);
  $('#sessionTitle').textContent = saved ? t('session.editing',{date:dateFmt(activeSession.date)}) : t('session.current');
  $('#sessionName').value = activeSession.name || '';
  $('#sessionDate').value = activeSession.date || todayKey();
  $('#deleteSession').hidden = !saved;
  refreshDatalists();
  if (!activeSession.exercises.length) $('#sessionEmpty').hidden=false; else activeSession.exercises.forEach(addExercise);
  restoring = false;
}
function collectSession() {
  const exercises = $$('.exercise-card').map(card => ({name:$('.exercise-name',card).value.trim(), sets:$$('.set-row',card).map(r=>({weight:Number($('.set-weight',r).value)||0,reps:Number($('.set-reps',r).value)||0})).filter(s=>s.weight||s.reps)})).filter(e=>e.name && e.sets.length);
  return {...activeSession, name:$('#sessionName').value.trim(), exercises};
}
async function finishSession() {
  const entry=collectSession(); if(!entry.exercises.length){ await showAlert(t('session.needExercise')); return; }
  entry.updatedAt=new Date().toISOString(); // sella la edición para resolver conflictos al fusionar con Drive
  const index=sessions.findIndex(s=>s.id===entry.id); if(index>=0)sessions[index]=entry;else sessions.push(entry); save(); clearDraft(); const prs=detectPRs(entry); activeSession=makeSession(); renderActiveSession(); updateDashboard(); stopRest(); window.driveAutoSync?.();
  await showAlert(prs.length?t('session.pr',{list:prs.join('\n')}):t('session.saved'));
}
function updateDashboard() {
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-6); const recent=sessions.filter(s=>new Date(s.date+'T12:00')>=cutoff); const sets=recent.flatMap(s=>s.exercises.flatMap(e=>e.sets));
  $('#weekSessions').textContent=recent.length; $('#weekSets').textContent=sets.length; $('#weekVolume').textContent=Math.round(sets.reduce((t,s)=>t+s.weight*s.reps,0)).toLocaleString(dateLocale()); renderHistory(); populateProgress(); window.renderBackupStatus?.(); window.renderSnapshotStatus?.();
}
function renderHistory() {
  const term=$('#historySearch').value.toLowerCase(), period=Number($('#historyPeriod').value); let data=[...sessions].sort((a,b)=>b.date.localeCompare(a.date)); if(period){const d=new Date();d.setDate(d.getDate()-period);data=data.filter(s=>new Date(s.date+'T12:00')>=d)}
  data=data.filter(s=>(s.name||'').toLowerCase().includes(term)||s.exercises.some(e=>e.name.toLowerCase().includes(term)));
  $('#historyList').innerHTML=data.length?data.map(s=>`<article class="history-session"><header><div><h3>${escapeHtml(s.name||t('history.unnamed'))}</h3><time>${dateFmt(s.date)} · ${t('history.movesCount',{n:s.exercises.length})}</time></div><button class="secondary-button edit-session" data-id="${s.id}">${t('history.edit')}</button></header><div class="history-moves">${s.exercises.map(e=>`<div class="history-move"><span>${escapeHtml(e.name)}</span><small>${e.sets.map(x=>`${x.weight}×${x.reps}`).join(' · ')}</small></div>`).join('')}</div></article>`).join(''):`<p class="no-data">${t('history.noData')}</p>`;
  $$('.edit-session').forEach(b=>b.onclick=()=>editSession(b.dataset.id));
}
function editSession(id) {
  const s=sessions.find(x=>x.id===id); if(!s) return; activeSession=JSON.parse(JSON.stringify(s)); renderActiveSession();
  $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view==='session')); $$('.view').forEach(v=>v.classList.toggle('active',v.id==='sessionView'));
  $('#sessionView').scrollIntoView({behavior:'smooth'});
}
function populateProgress() { const names=[...new Set(sessions.flatMap(s=>s.exercises.map(e=>e.name)).filter(Boolean))]; const sel=$('#progressExercise'), current=sel.value; sel.innerHTML=names.length?names.map(n=>`<option>${escapeHtml(n)}</option>`).join(''):`<option>${t('progress.noExercises')}</option>`; if(names.includes(current))sel.value=current; renderProgress(); }
function renderProgress() { const name=$('#progressExercise').value; const records=sessions.sort((a,b)=>a.date.localeCompare(b.date)).flatMap(s=>s.exercises.filter(e=>e.name===name).map(e=>({date:s.date,sets:e.sets,max:Math.max(...e.sets.map(x=>x.weight)),volume:e.sets.reduce((t,x)=>t+x.weight*x.reps,0)}))); const root=$('#progressContent'); if(!records.length){root.innerHTML=`<p class="no-data">${t('progress.noData')}</p>`;return} const last=records.at(-1), first=records[0], diff=last.max-first.max; const bars=records.slice(-8), max=Math.max(...bars.map(r=>r.max),1); root.innerHTML=`<div class="progress-stats"><article class="progress-stat"><span>${t('progress.lastLoad')}</span><strong>${last.max} kg</strong></article><article class="progress-stat"><span>${t('progress.bestMark')}</span><strong>${Math.max(...records.map(r=>r.max))} kg</strong></article><article class="progress-stat"><span>${t('progress.totalChange')}</span><strong>${diff>=0?'+':''}${diff} kg</strong></article></div><article class="chart-card"><h3>${t('progress.chartTitle')}</h3><p>${t('progress.chartSub',{name:escapeHtml(name),n:bars.length})}</p><div class="bar-chart">${bars.map(r=>`<div class="bar-wrap"><span class="bar-value">${r.max}</span><div class="bar" style="height:${Math.max(8,r.max/max*115)}px"></div><span class="bar-label">${new Date(r.date+'T12:00').toLocaleDateString(dateLocale(),{day:'2-digit',month:'2-digit'})}</span></div>`).join('')}</div></article>`; }
// --- Temporizador de descanso ---
let restInterval=null, restEnds=0, restDuration=90;
function fmtRest(s){s=Math.max(0,s);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
function startRest(seconds=restDuration){
  restDuration=seconds; restEnds=Date.now()+seconds*1000; clearInterval(restInterval);
  $('#restTimer').classList.add('is-running'); $('#restToggle').classList.add('is-on'); $('#restToggle').title=t('rest.running');
  const tick=()=>{const left=Math.round((restEnds-Date.now())/1000); $('#restDisplay').textContent=fmtRest(left);
    if(left<=0){stopRest(); beep(); if(navigator.vibrate)navigator.vibrate([200,100,200]);}};
  tick(); restInterval=setInterval(tick,250);
}
// El contador queda fijo: al detener vuelve al estado en reposo mostrando la duración elegida.
function stopRest(){clearInterval(restInterval);restInterval=null;$('#restTimer').classList.remove('is-running');$('#restToggle').classList.remove('is-on');$('#restToggle').title=t('rest.start');$('#restDisplay').textContent=fmtRest(restDuration);}
function beep(){try{const ctx=new (window.AudioContext||window.webkitAudioContext)();const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=880;g.gain.setValueAtTime(.3,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.6);o.start();o.stop(ctx.currentTime+.6);}catch{}}
$('#restToggle').onclick=()=>{ restInterval?stopRest():startRest(); };
$$('#restTimer [data-rest]').forEach(b=>b.onclick=()=>startRest(Number(b.dataset.rest)));
$('#restStop').onclick=stopRest;
$('#restDisplay').textContent=fmtRest(restDuration);

// --- Arrastrar el temporizador de descanso y recordar su posición ---
const REST_POS_KEY='loadout-rest-pos';
function clampRestPos(left,top){
  const el=$('#restTimer'), pad=8; const w=el.offsetWidth||220, h=el.offsetHeight||70;
  const maxLeft=window.innerWidth-w-pad, maxTop=window.innerHeight-h-pad;
  return {left:Math.min(Math.max(pad,left),Math.max(pad,maxLeft)), top:Math.min(Math.max(pad,top),Math.max(pad,maxTop))};
}
function applyRestPos(pos){
  const el=$('#restTimer'); if(!pos)return;
  el.style.left=pos.left+'px'; el.style.top=pos.top+'px'; el.style.bottom='auto'; el.style.right='auto';
}
(function initRestDrag(){
  const el=$('#restTimer');
  const saved=JSON.parse(localStorage.getItem(REST_POS_KEY)||'null');
  if(saved) applyRestPos(saved);
  let dragging=false, offX=0, offY=0, moved=false;
  el.addEventListener('pointerdown',e=>{
    if(e.target.closest('button'))return;
    dragging=true; moved=false; el.setPointerCapture(e.pointerId);
    const rect=el.getBoundingClientRect(); offX=e.clientX-rect.left; offY=e.clientY-rect.top;
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove',e=>{
    if(!dragging)return; moved=true;
    const pos=clampRestPos(e.clientX-offX,e.clientY-offY); applyRestPos(pos);
  });
  const endDrag=e=>{
    if(!dragging)return; dragging=false; el.classList.remove('dragging');
    if(moved){ const rect=el.getBoundingClientRect(); const pos=clampRestPos(rect.left,rect.top); applyRestPos(pos); localStorage.setItem(REST_POS_KEY,JSON.stringify(pos)); }
  };
  el.addEventListener('pointerup',endDrag); el.addEventListener('pointercancel',endDrag);
  window.addEventListener('resize',()=>{ const saved=JSON.parse(localStorage.getItem(REST_POS_KEY)||'null'); if(saved){ const pos=clampRestPos(saved.left,saved.top); applyRestPos(pos); } });
})();

// --- Bienvenida (hero) solo la primera vez ---
const HERO_KEY='loadout-hero-seen';
function collapseHero(){ $('#heroText').hidden=true; $('#inicio').classList.add('hero--min'); }
if(localStorage.getItem(HERO_KEY)) collapseHero();
$('#heroClose').onclick=()=>{ collapseHero(); localStorage.setItem(HERO_KEY,'1'); };

// --- Récords personales ---
function detectPRs(entry){
  const prs=[];
  for(const ex of entry.exercises){
    const key=ex.name.trim().toLowerCase(); const newMax=Math.max(...ex.sets.map(s=>s.weight),0); if(!newMax)continue;
    const oldMax=Math.max(0,...sessions.filter(s=>s.id!==entry.id).flatMap(s=>s.exercises.filter(e=>e.name.trim().toLowerCase()===key)).flatMap(e=>e.sets.map(x=>x.weight)));
    if(oldMax&&newMax>oldMax)prs.push(`${ex.name}: ${newMax} kg (antes ${oldMax} kg)`);
  }
  return prs;
}

function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function renderTodayDates(){
  $('#today').textContent=new Intl.DateTimeFormat(dateLocale(),{weekday:'long',day:'numeric',month:'long'}).format(new Date());
  $('#heroDate').textContent=new Intl.DateTimeFormat(dateLocale(),{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
}
renderTodayDates();
$('#addExercise').onclick=()=>{ addExercise(); saveDraft(); }; $('#emptyAddExercise').onclick=()=>{ addExercise(); saveDraft(); }; $('#finishSession').onclick=finishSession;
$('#sessionDate').onchange=()=>{ if(activeSession && $('#sessionDate').value) activeSession.date=$('#sessionDate').value; saveDraft(); };
$('#sessionName').oninput=()=>{ if(activeSession)activeSession.name=$('#sessionName').value; openRoutinePanel(); saveDraft(); };
// Cualquier tecleo en series/nombres del ejercicio persiste el borrador.
$('#exerciseList').addEventListener('input', saveDraft);
$('#sessionName').onfocus=openRoutinePanel;
$('#sessionName').onkeydown=e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){ e.preventDefault(); if($('#routinePanel').hidden)openRoutinePanel(); moveRoutineHighlight(e.key==='ArrowDown'?1:-1); return; }
  if(e.key==='Enter'){ const active=$('.routine-option.is-active'); if(active){ e.preventDefault(); pickRoutine(active.dataset.name); } else closeRoutinePanel(); return; }
  if(e.key==='Escape') closeRoutinePanel();
};
$('#routineToggle').onclick=()=>{ if($('#routinePanel').hidden){ openRoutinePanel(); $('#sessionName').focus(); } else closeRoutinePanel(); };
// Cerrar al tocar fuera del campo.
document.addEventListener('click',e=>{ if(!e.target.closest('.routine-field')) closeRoutinePanel(); });
$('#loadRoutine').onclick=async ()=>{
  const prev=lastSessionByRoutine($('#sessionName').value);
  if(!prev){ await showAlert(t('routine.loadNeedName')); return; }
  if($('#exerciseList').children.length && !(await showConfirm(t('routine.loadConfirm'), {danger:true, okText:t('routine.loadOk')})))return;
  $('#exerciseList').innerHTML=''; $('#sessionEmpty').hidden=true;
  // Se cargan colapsados: solo trabajas uno a la vez, lo abres cuando te toca.
  prev.exercises.forEach(e=>addExercise({name:e.name, done:true, sets:e.sets.map(s=>({targetWeight:s.weight, targetReps:s.reps}))}));
  if(!$('#exerciseList').children.length)$('#sessionEmpty').hidden=false;
  saveDraft();
};
$('#clearSession').onclick=async ()=>{
  if(!$('#exerciseList').children.length)return;
  if(!(await showConfirm(t('session.clearConfirm'), {danger:true, okText:t('session.clearOk')})))return;
  $('#exerciseList').innerHTML=''; $('#sessionEmpty').hidden=false; saveDraft();
};
$('#deleteSession').onclick=async ()=>{if(await showConfirm(t('session.deleteConfirm'), {danger:true, okText:t('session.deleteOk')})){window.snapshot?.(t('session.deleteSnapReason'));sessions=sessions.filter(s=>s.id!==activeSession.id);save();clearDraft();activeSession=makeSession();renderActiveSession();updateDashboard();}};
$$('.tab').forEach(t=>t.onclick=()=>{$$('.tab').forEach(x=>x.classList.toggle('active',x===t));$$('.view').forEach(v=>v.classList.toggle('active',v.id===`${t.dataset.view}View`));if(t.dataset.view==='progress')populateProgress();if(t.dataset.view==='history')renderHistory();});
$('#historySearch').oninput=renderHistory; $('#historyPeriod').onchange=renderHistory; $('#progressExercise').onchange=renderProgress; $('#themeButton').onclick=()=>document.body.classList.toggle('dark');
$('#exportData').onclick=()=>{const payload={app:'LOADOUT',version:1,exportedAt:new Date().toISOString(),sessions};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`${t('export.filename')}-${todayKey()}.json`;link.click();URL.revokeObjectURL(link.href);window.markBackupDone?.();};
$('#importData').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{const payload=JSON.parse(await file.text());if(!Array.isArray(payload.sessions))throw new Error();if(!(await showConfirm(t('import.confirm',{n:payload.sessions.length}),{danger:true,okText:t('import.ok')})))return;window.snapshot?.(t('import.reason'));sessions=payload.sessions;save();clearDraft();activeSession=makeSession();renderActiveSession();updateDashboard();await showAlert(t('import.done'));}catch{await showAlert(t('import.invalid'));}finally{event.target.value='';}};
// Recupera el borrador de la sesión en curso si se recargó/cerró sin finalizar.
(function restoreDraft(){
  const draft=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');
  if(draftHasContent(draft)) activeSession=draft; else clearDraft();
})();
renderActiveSession();updateDashboard();
window.onLangChange=()=>{ renderTodayDates(); renderActiveSession(); updateDashboard(); };

if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('sw.js');
