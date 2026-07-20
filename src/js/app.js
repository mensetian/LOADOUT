const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];
const KEY = 'gymlog-sessions-v1';
let sessions = JSON.parse(localStorage.getItem(KEY) || '[]');
let activeSession = null;
const save = () => localStorage.setItem(KEY, JSON.stringify(sessions));
const dateFmt = d => new Intl.DateTimeFormat('es-CO', {day:'numeric', month:'short', year:'numeric'}).format(new Date(d));
const todayKey = () => new Date().toISOString().slice(0,10);

function makeSession() { return { id: crypto.randomUUID(), date: todayKey(), name: '', exercises: [] }; }
function routineNames() { return [...new Set(sessions.map(s=>(s.name||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b)); }
function exerciseNames() { return [...new Set(sessions.flatMap(s=>s.exercises.map(e=>e.name.trim())).filter(Boolean))].sort((a,b)=>a.localeCompare(b)); }
function refreshDatalists() { $('#routineNames').innerHTML=routineNames().map(n=>`<option value="${escapeHtml(n)}">`).join(''); $('#exerciseNames').innerHTML=exerciseNames().map(n=>`<option value="${escapeHtml(n)}">`).join(''); }
function lastSessionByRoutine(name) { const key=name.trim().toLowerCase(); if(!key) return null; return sessions.filter(s=>s.id!==activeSession?.id && (s.name||'').trim().toLowerCase()===key).sort((a,b)=>b.date.localeCompare(a.date))[0]||null; }
function getLastExercise(name) {
  const key = name.trim().toLowerCase(); if (!key) return null;
  return sessions.filter(s => s.id !== activeSession?.id).sort((a,b)=>b.date.localeCompare(a.date)).flatMap(s=>s.exercises.map(e=>({...e,date:s.date}))).find(e=>e.name.trim().toLowerCase()===key);
}
function updateLast(card) { const e = getLastExercise($('.exercise-name', card).value); $('.last-time', card).textContent = e ? `Tu última referencia · ${dateFmt(e.date)} · ${e.sets.map(s=>`${s.weight} kg × ${s.reps}`).join(' / ')}` : 'Aún no tienes una referencia para este ejercicio'; }
function addSet(card, values = {}) {
  const node = $('#setTemplate').content.firstElementChild.cloneNode(true); $('.set-weight',node).value = values.weight ?? ''; $('.set-reps',node).value = values.reps ?? '';
  if (values.targetWeight != null) $('.set-weight',node).placeholder = `${values.targetWeight} kg`; if (values.targetReps != null) $('.set-reps',node).placeholder = `${values.targetReps} reps`;
  $('.set-rows',card).append(node); refreshSetNumbers(card);
  $('.remove-set',node).onclick = () => { node.remove(); refreshSetNumbers(card); };
}
function refreshSetNumbers(card) { $$('.set-number',card).forEach((n,i)=>n.textContent=`${String(i+1).padStart(2,'0')}`); }
function addExercise(data = {}) {
  $('#sessionEmpty').hidden = true;
  const card = $('#exerciseTemplate').content.firstElementChild.cloneNode(true); $('.exercise-name',card).value = data.name || '';
  (data.sets?.length ? data.sets : [{}]).forEach(s=>addSet(card,s));
  $('.exercise-name',card).oninput = () => updateLast(card); $('.exercise-name',card).onblur = () => updateLast(card);
  $('.add-set',card).onclick = () => { const last=$$('.set-row',card).at(-1); addSet(card, last?{weight:$('.set-weight',last).value, reps:$('.set-reps',last).value}:{}); }; $('.remove-exercise',card).onclick = () => { card.remove(); if(!$('#exerciseList').children.length) $('#sessionEmpty').hidden=false; };
  $('#exerciseList').append(card); updateLast(card);
}
function renderActiveSession() {
  $('#exerciseList').innerHTML=''; $('#sessionEmpty').hidden=true;
  if (!activeSession) activeSession = makeSession();
  const saved = sessions.some(s=>s.id===activeSession.id);
  $('#sessionTitle').textContent = saved ? `Editando · ${dateFmt(activeSession.date)}` : 'Entrenamiento actual';
  $('#sessionName').value = activeSession.name || '';
  $('#deleteSession').hidden = !saved;
  refreshDatalists();
  if (!activeSession.exercises.length) $('#sessionEmpty').hidden=false; else activeSession.exercises.forEach(addExercise);
}
function collectSession() {
  const exercises = $$('.exercise-card').map(card => ({name:$('.exercise-name',card).value.trim(), sets:$$('.set-row',card).map(r=>({weight:Number($('.set-weight',r).value)||0,reps:Number($('.set-reps',r).value)||0})).filter(s=>s.weight||s.reps)})).filter(e=>e.name && e.sets.length);
  return {...activeSession, name:$('#sessionName').value.trim(), exercises};
}
function finishSession() {
  const entry=collectSession(); if(!entry.exercises.length) return alert('Añade al menos un ejercicio y una serie antes de guardar.');
  const index=sessions.findIndex(s=>s.id===entry.id); if(index>=0)sessions[index]=entry;else sessions.push(entry); save(); const prs=detectPRs(entry); activeSession=makeSession(); renderActiveSession(); updateDashboard(); stopRest(); window.driveAutoSync?.();
  alert(prs.length?`🏆 ¡NUEVO RÉCORD PERSONAL!\n\n${prs.join('\n')}\n\nEntrenamiento guardado.`:'Entrenamiento guardado. Tu siguiente marca empieza aquí.');
}
function updateDashboard() {
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-6); const recent=sessions.filter(s=>new Date(s.date+'T12:00')>=cutoff); const sets=recent.flatMap(s=>s.exercises.flatMap(e=>e.sets));
  $('#weekSessions').textContent=recent.length; $('#weekSets').textContent=sets.length; $('#weekVolume').textContent=Math.round(sets.reduce((t,s)=>t+s.weight*s.reps,0)).toLocaleString('es-CO'); renderHistory(); populateProgress(); window.renderBackupStatus?.();
}
function renderHistory() {
  const term=$('#historySearch').value.toLowerCase(), period=Number($('#historyPeriod').value); let data=[...sessions].sort((a,b)=>b.date.localeCompare(a.date)); if(period){const d=new Date();d.setDate(d.getDate()-period);data=data.filter(s=>new Date(s.date+'T12:00')>=d)}
  data=data.filter(s=>(s.name||'').toLowerCase().includes(term)||s.exercises.some(e=>e.name.toLowerCase().includes(term)));
  $('#historyList').innerHTML=data.length?data.map(s=>`<article class="history-session"><header><div><h3>${escapeHtml(s.name||'Sesión sin nombre')}</h3><time>${dateFmt(s.date)} · ${s.exercises.length} movimientos</time></div><button class="secondary-button edit-session" data-id="${s.id}">Editar</button></header><div class="history-moves">${s.exercises.map(e=>`<div class="history-move"><span>${escapeHtml(e.name)}</span><small>${e.sets.map(x=>`${x.weight}×${x.reps}`).join(' · ')}</small></div>`).join('')}</div></article>`).join(''):'<p class="no-data">Aún no hay registros que coincidan.</p>';
  $$('.edit-session').forEach(b=>b.onclick=()=>editSession(b.dataset.id));
}
function editSession(id) {
  const s=sessions.find(x=>x.id===id); if(!s) return; activeSession=JSON.parse(JSON.stringify(s)); renderActiveSession();
  $$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view==='session')); $$('.view').forEach(v=>v.classList.toggle('active',v.id==='sessionView'));
  $('#sessionView').scrollIntoView({behavior:'smooth'});
}
function populateProgress() { const names=[...new Set(sessions.flatMap(s=>s.exercises.map(e=>e.name)).filter(Boolean))]; const sel=$('#progressExercise'), current=sel.value; sel.innerHTML=names.length?names.map(n=>`<option>${escapeHtml(n)}</option>`).join(''):'<option>Sin ejercicios registrados</option>'; if(names.includes(current))sel.value=current; renderProgress(); }
function renderProgress() { const name=$('#progressExercise').value; const records=sessions.sort((a,b)=>a.date.localeCompare(b.date)).flatMap(s=>s.exercises.filter(e=>e.name===name).map(e=>({date:s.date,sets:e.sets,max:Math.max(...e.sets.map(x=>x.weight)),volume:e.sets.reduce((t,x)=>t+x.weight*x.reps,0)}))); const root=$('#progressContent'); if(!records.length){root.innerHTML='<p class="no-data">Cuando registres este ejercicio, su avance aparecerá aquí.</p>';return} const last=records.at(-1), first=records[0], diff=last.max-first.max; const bars=records.slice(-8), max=Math.max(...bars.map(r=>r.max),1); root.innerHTML=`<div class="progress-stats"><article class="progress-stat"><span>Tu última carga</span><strong>${last.max} kg</strong></article><article class="progress-stat"><span>Tu mejor marca</span><strong>${Math.max(...records.map(r=>r.max))} kg</strong></article><article class="progress-stat"><span>Cambio total</span><strong>${diff>=0?'+':''}${diff} kg</strong></article></div><article class="chart-card"><h3>Tu carga máxima en el tiempo</h3><p>${escapeHtml(name)} · ${bars.length} entrenamientos recientes</p><div class="bar-chart">${bars.map(r=>`<div class="bar-wrap"><span class="bar-value">${r.max}</span><div class="bar" style="height:${Math.max(8,r.max/max*115)}px"></div><span class="bar-label">${new Date(r.date+'T12:00').toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit'})}</span></div>`).join('')}</div></article>`; }
// --- Temporizador de descanso ---
let restInterval=null, restEnds=0, restDuration=90;
let restAuto = localStorage.getItem('loadout-rest-auto')!=='0'; // activado por defecto
function fmtRest(s){s=Math.max(0,s);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
function startRest(seconds=restDuration){
  restDuration=seconds; restEnds=Date.now()+seconds*1000; $('#restTimer').hidden=false; document.body.classList.add('rest-active'); clearInterval(restInterval);
  const tick=()=>{const left=Math.round((restEnds-Date.now())/1000); $('#restDisplay').textContent=fmtRest(left);
    if(left<=0){stopRest(); beep(); if(navigator.vibrate)navigator.vibrate([200,100,200]);}};
  tick(); restInterval=setInterval(tick,250);
}
function stopRest(){clearInterval(restInterval);restInterval=null;$('#restTimer').hidden=true;document.body.classList.remove('rest-active');}
function beep(){try{const ctx=new (window.AudioContext||window.webkitAudioContext)();const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=880;g.gain.setValueAtTime(.3,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.6);o.start();o.stop(ctx.currentTime+.6);}catch{}}
function updateRestToggle(){ $('#restToggle').classList.toggle('is-on',restAuto); $('#restToggle').title=restAuto?'Descanso automático: ACTIVADO':'Descanso automático: desactivado'; }
$('#restToggle').onclick=()=>{ restAuto=!restAuto; localStorage.setItem('loadout-rest-auto',restAuto?'1':'0'); updateRestToggle(); if(!restAuto)stopRest(); };
updateRestToggle();
$('#exerciseList').addEventListener('change',e=>{if(restAuto && e.target.matches('.set-reps')&&e.target.value)startRest();});
$$('#restTimer [data-rest]').forEach(b=>b.onclick=()=>startRest(Number(b.dataset.rest)));
$('#restStop').onclick=stopRest;

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

$('#today').textContent=new Intl.DateTimeFormat('es-CO',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
$('#heroDate').textContent=new Intl.DateTimeFormat('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
$('#startSession').onclick=()=>{activeSession=makeSession();renderActiveSession();addExercise();document.querySelector('.tabs').scrollIntoView({behavior:'smooth'});$('.exercise-name')?.focus();}; $('#addExercise').onclick=()=>addExercise(); $('#emptyAddExercise').onclick=()=>addExercise(); $('#finishSession').onclick=finishSession;
$('#sessionName').oninput=()=>{if(activeSession)activeSession.name=$('#sessionName').value;};
$('#loadRoutine').onclick=()=>{
  const prev=lastSessionByRoutine($('#sessionName').value);
  if(!prev)return alert('Escribe el nombre de una rutina que ya hayas guardado (ej. Pecho) para cargar sus ejercicios.');
  if($('#exerciseList').children.length && !confirm('Esto reemplazará los movimientos actuales con los de tu última sesión de esta rutina. ¿Continuar?'))return;
  $('#exerciseList').innerHTML=''; $('#sessionEmpty').hidden=true;
  prev.exercises.forEach(e=>addExercise({name:e.name, sets:e.sets.map(s=>({targetWeight:s.weight, targetReps:s.reps}))}));
  if(!$('#exerciseList').children.length)$('#sessionEmpty').hidden=false;
};
$('#deleteSession').onclick=()=>{if(confirm('¿Descartar este entrenamiento? Quedará una copia local por si te arrepientes.')){window.snapshot?.('antes de borrar una sesión');sessions=sessions.filter(s=>s.id!==activeSession.id);save();activeSession=makeSession();renderActiveSession();updateDashboard();}};
$$('.tab').forEach(t=>t.onclick=()=>{$$('.tab').forEach(x=>x.classList.toggle('active',x===t));$$('.view').forEach(v=>v.classList.toggle('active',v.id===`${t.dataset.view}View`));if(t.dataset.view==='progress')populateProgress();if(t.dataset.view==='history')renderHistory();});
$('#historySearch').oninput=renderHistory; $('#historyPeriod').onchange=renderHistory; $('#progressExercise').onchange=renderProgress; $('#themeButton').onclick=()=>document.body.classList.toggle('dark');
$('#exportData').onclick=()=>{const payload={app:'LOADOUT',version:1,exportedAt:new Date().toISOString(),sessions};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`loadout-respaldo-${todayKey()}.json`;link.click();URL.revokeObjectURL(link.href);window.markBackupDone?.();};
$('#importData').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{const payload=JSON.parse(await file.text());if(!Array.isArray(payload.sessions))throw new Error();if(!confirm(`¿Restaurar ${payload.sessions.length} sesiones? Esto reemplazará los datos actuales de este navegador.`))return;window.snapshot?.('antes de importar un archivo');sessions=payload.sessions;save();activeSession=makeSession();renderActiveSession();updateDashboard();alert('Respaldo restaurado correctamente.');}catch{alert('Este archivo no parece ser un respaldo válido de LOADOUT.');}finally{event.target.value='';}};
renderActiveSession();updateDashboard();

if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('sw.js');
