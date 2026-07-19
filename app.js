const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];
const KEY = 'gymlog-sessions-v1';
let sessions = JSON.parse(localStorage.getItem(KEY) || '[]');
let activeSession = null;
const save = () => localStorage.setItem(KEY, JSON.stringify(sessions));
const dateFmt = d => new Intl.DateTimeFormat('es-CO', {day:'numeric', month:'short', year:'numeric'}).format(new Date(d));
const todayKey = () => new Date().toISOString().slice(0,10);

function makeSession() { return { id: crypto.randomUUID(), date: todayKey(), exercises: [] }; }
function getLastExercise(name) {
  const key = name.trim().toLowerCase(); if (!key) return null;
  return sessions.filter(s => s.id !== activeSession?.id).sort((a,b)=>b.date.localeCompare(a.date)).flatMap(s=>s.exercises.map(e=>({...e,date:s.date}))).find(e=>e.name.trim().toLowerCase()===key);
}
function updateLast(card) { const e = getLastExercise($('.exercise-name', card).value); $('.last-time', card).textContent = e ? `Tu última referencia · ${dateFmt(e.date)} · ${e.sets.map(s=>`${s.weight} kg × ${s.reps}`).join(' / ')}` : 'Aún no tienes una referencia para este ejercicio'; }
function addSet(card, values = {}) {
  const node = $('#setTemplate').content.firstElementChild.cloneNode(true); $('.set-weight',node).value = values.weight ?? ''; $('.set-reps',node).value = values.reps ?? '';
  $('.set-rows',card).append(node); refreshSetNumbers(card);
  $('.remove-set',node).onclick = () => { node.remove(); refreshSetNumbers(card); };
}
function refreshSetNumbers(card) { $$('.set-number',card).forEach((n,i)=>n.textContent=`${String(i+1).padStart(2,'0')}`); }
function addExercise(data = {}) {
  $('#sessionEmpty').hidden = true;
  const card = $('#exerciseTemplate').content.firstElementChild.cloneNode(true); $('.exercise-name',card).value = data.name || '';
  (data.sets?.length ? data.sets : [{},{} ,{}]).forEach(s=>addSet(card,s));
  $('.exercise-name',card).oninput = () => updateLast(card); $('.exercise-name',card).onblur = () => updateLast(card);
  $('.add-set',card).onclick = () => addSet(card); $('.remove-exercise',card).onclick = () => { card.remove(); if(!$('#exerciseList').children.length) $('#sessionEmpty').hidden=false; };
  $('#exerciseList').append(card); updateLast(card);
}
function renderActiveSession() {
  $('#exerciseList').innerHTML=''; $('#sessionEmpty').hidden=true;
  if (!activeSession) activeSession = makeSession();
  $('#sessionTitle').textContent = activeSession.id && sessions.some(s=>s.id===activeSession.id) ? `Entrenamiento · ${dateFmt(activeSession.date)}` : 'Entrenamiento actual';
  $('#deleteSession').hidden = !sessions.some(s=>s.id===activeSession.id);
  if (!activeSession.exercises.length) $('#sessionEmpty').hidden=false; else activeSession.exercises.forEach(addExercise);
}
function collectSession() {
  const exercises = $$('.exercise-card').map(card => ({name:$('.exercise-name',card).value.trim(), sets:$$('.set-row',card).map(r=>({weight:Number($('.set-weight',r).value)||0,reps:Number($('.set-reps',r).value)||0})).filter(s=>s.weight||s.reps)})).filter(e=>e.name && e.sets.length);
  return {...activeSession, exercises};
}
function finishSession() {
  const entry=collectSession(); if(!entry.exercises.length) return alert('Añade al menos un ejercicio y una serie antes de guardar.');
  const index=sessions.findIndex(s=>s.id===entry.id); if(index>=0)sessions[index]=entry;else sessions.push(entry); save(); activeSession=makeSession(); renderActiveSession(); updateDashboard(); alert('Entrenamiento guardado. Tu siguiente marca empieza aquí.');
}
function updateDashboard() {
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-6); const recent=sessions.filter(s=>new Date(s.date+'T12:00')>=cutoff); const sets=recent.flatMap(s=>s.exercises.flatMap(e=>e.sets));
  $('#weekSessions').textContent=recent.length; $('#weekSets').textContent=sets.length; $('#weekVolume').textContent=Math.round(sets.reduce((t,s)=>t+s.weight*s.reps,0)).toLocaleString('es-CO'); renderHistory(); populateProgress();
}
function renderHistory() {
  const term=$('#historySearch').value.toLowerCase(), period=Number($('#historyPeriod').value); let data=[...sessions].sort((a,b)=>b.date.localeCompare(a.date)); if(period){const d=new Date();d.setDate(d.getDate()-period);data=data.filter(s=>new Date(s.date+'T12:00')>=d)}
  const items=data.flatMap(s=>s.exercises.map(e=>({...e,date:s.date}))).filter(e=>e.name.toLowerCase().includes(term)); $('#historyList').innerHTML=items.length?items.map(e=>`<article class="history-item"><div><h3>${escapeHtml(e.name)}</h3><p>${e.sets.map(x=>`${x.weight} kg × ${x.reps}`).join(' · ')} <b>— ${e.sets.length} series</b></p></div><time>${dateFmt(e.date)}</time></article>`).join(''):'<p class="no-data">Aún no hay registros que coincidan.</p>';
}
function populateProgress() { const names=[...new Set(sessions.flatMap(s=>s.exercises.map(e=>e.name)).filter(Boolean))]; const sel=$('#progressExercise'), current=sel.value; sel.innerHTML=names.length?names.map(n=>`<option>${escapeHtml(n)}</option>`).join(''):'<option>Sin ejercicios registrados</option>'; if(names.includes(current))sel.value=current; renderProgress(); }
function renderProgress() { const name=$('#progressExercise').value; const records=sessions.sort((a,b)=>a.date.localeCompare(b.date)).flatMap(s=>s.exercises.filter(e=>e.name===name).map(e=>({date:s.date,sets:e.sets,max:Math.max(...e.sets.map(x=>x.weight)),volume:e.sets.reduce((t,x)=>t+x.weight*x.reps,0)}))); const root=$('#progressContent'); if(!records.length){root.innerHTML='<p class="no-data">Cuando registres este ejercicio, su avance aparecerá aquí.</p>';return} const last=records.at(-1), first=records[0], diff=last.max-first.max; const bars=records.slice(-8), max=Math.max(...bars.map(r=>r.max),1); root.innerHTML=`<div class="progress-stats"><article class="progress-stat"><span>Tu última carga</span><strong>${last.max} kg</strong></article><article class="progress-stat"><span>Tu mejor marca</span><strong>${Math.max(...records.map(r=>r.max))} kg</strong></article><article class="progress-stat"><span>Cambio total</span><strong>${diff>=0?'+':''}${diff} kg</strong></article></div><article class="chart-card"><h3>Tu carga máxima en el tiempo</h3><p>${escapeHtml(name)} · ${bars.length} entrenamientos recientes</p><div class="bar-chart">${bars.map(r=>`<div class="bar-wrap"><span class="bar-value">${r.max}</span><div class="bar" style="height:${Math.max(8,r.max/max*115)}px"></div><span class="bar-label">${new Date(r.date+'T12:00').toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit'})}</span></div>`).join('')}</div></article>`; }
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

$('#today').textContent=new Intl.DateTimeFormat('es-CO',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
$('#heroDate').textContent=new Intl.DateTimeFormat('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date());
$('#startSession').onclick=()=>{activeSession=makeSession();renderActiveSession();document.querySelector('.tabs').scrollIntoView({behavior:'smooth'});}; $('#addExercise').onclick=()=>addExercise(); $('#emptyAddExercise').onclick=()=>addExercise(); $('#finishSession').onclick=finishSession;
$('#deleteSession').onclick=()=>{if(confirm('¿Descartar este entrenamiento? No se podrá recuperar.')){sessions=sessions.filter(s=>s.id!==activeSession.id);save();activeSession=makeSession();renderActiveSession();updateDashboard();}};
$$('.tab').forEach(t=>t.onclick=()=>{$$('.tab').forEach(x=>x.classList.toggle('active',x===t));$$('.view').forEach(v=>v.classList.toggle('active',v.id===`${t.dataset.view}View`));if(t.dataset.view==='progress')populateProgress();if(t.dataset.view==='history')renderHistory();});
$('#historySearch').oninput=renderHistory; $('#historyPeriod').onchange=renderHistory; $('#progressExercise').onchange=renderProgress; $('#themeButton').onclick=()=>document.body.classList.toggle('dark');
$('#exportData').onclick=()=>{const payload={app:'GymLog',version:1,exportedAt:new Date().toISOString(),sessions};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`gymlog-respaldo-${todayKey()}.json`;link.click();URL.revokeObjectURL(link.href);};
$('#importData').onchange=async event=>{const file=event.target.files[0];if(!file)return;try{const payload=JSON.parse(await file.text());if(!Array.isArray(payload.sessions))throw new Error();if(!confirm(`¿Restaurar ${payload.sessions.length} sesiones? Esto reemplazará los datos actuales de este navegador.`))return;sessions=payload.sessions;save();activeSession=makeSession();renderActiveSession();updateDashboard();alert('Respaldo restaurado correctamente.');}catch{alert('Este archivo no parece ser un respaldo válido de GymLog.');}finally{event.target.value='';}};
renderActiveSession();updateDashboard();
