// ---------------------------------------------------------------------------
// Pestaña RUTINAS — donde se arman los planes
// ---------------------------------------------------------------------------
// Planear y anotar son dos actividades distintas, en dos momentos distintos:
// el plan lo pensás sentado en tu casa, lo de hoy lo anotás entre serie y serie
// con el pulso a 140. Cuando los controles de planear vivían dentro de CAPTURAR
// —un botón "fijar" en la barra, una chincheta en cada fila del selector— la
// pantalla de hacer cobraba ruido todos los días por algo que se toca una vez
// al mes. Acá está todo eso junto, y CAPTURAR se quedó solo con lo de hoy.

// Rutina en edición. `null` = el editor está cerrado; sin id = es nueva.
let editing = null;

// --- Lista -------------------------------------------------------------------
// Muestra todas las rutinas, tengan plan o no. Las que no lo tienen son nombres
// que aparecieron al entrenar: ofrecen crear el plan a partir de esa sesión, que
// es de lejos la forma más cómoda de empezar una — ya está casi escrita.
function renderRoutines() {
  const root = document.querySelector('#routinesList');
  if (!root) return;
  const items = routineEntries();
  if (!items.length) {
    root.innerHTML = `<div class="routines-empty"><p>${t('routines.empty')}</p></div>`;
    return;
  }
  root.innerHTML = items.map(r => {
    const plan = r.planned ? planFor(r.name) : null;
    const moves = plan ? (plan.exercises || []).map(e => e.name).join(' · ') : t('routines.noPlan');
    const actions = plan
      ? `<button class="secondary-button" data-edit="${escapeHtml(r.name)}">${t('routines.edit')}</button>`
        + `<button class="secondary-button danger-btn" data-del="${escapeHtml(plan.id)}">${t('routines.delete')}</button>`
      : `<button class="secondary-button" data-from="${escapeHtml(r.name)}">${t('routines.createPlan')}</button>`;
    return `<div class="routine-card${plan ? ' has-plan' : ''}">`
      + `<div class="rc-main"><strong>${escapeHtml(r.name)}</strong>`
      + `<small>${escapeHtml(moves)}</small>`
      + `<small class="rc-meta">${routineMeta(r)}</small></div>`
      + `<div class="rc-actions">${actions}</div></div>`;
  }).join('');
  root.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
  root.querySelectorAll('[data-from]').forEach(b => b.onclick = () => openEditorFromHistory(b.dataset.from));
  root.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await deleteTemplate(b.dataset.del); renderRoutines(); });
}

// --- Editor ------------------------------------------------------------------
// Una fila por movimiento, con sus series como pares peso×reps. Es un editor
// aparte y no la tarjeta de CAPTURAR: aquella arrastra récords, referencia de la
// última vez y el acordeón, cosas que acá no significan nada.
function reRow(ex = { name: '', sets: [] }) {
  const sets = (ex.sets || []).length ? ex.sets : [{ weight: 0, reps: 0 }];
  return `<div class="re-move">`
    + `<div class="re-move-head">`
    + `<input class="re-move-name" list="exerciseNames" autocomplete="off" value="${escapeHtml(ex.name || '')}" data-i18n-placeholder="exercise.namePlaceholder" placeholder="${t('exercise.namePlaceholder')}"/>`
    + `<button class="icon-btn re-move-del" type="button" title="${t('exercise.removeTitle')}">×</button></div>`
    + `<div class="re-sets">${sets.map(reSet).join('')}</div>`
    + `<button class="add-set re-set-add" type="button">${t('set.add')}</button></div>`;
}
// El peso se muestra en la unidad elegida, pero se guarda siempre en kg.
function reSet(s = { weight: 0, reps: 0 }) {
  const w = s.weight ? toDisplay(s.weight) : '';
  return `<div class="re-set">`
    + `<input class="re-set-w" inputmode="decimal" type="text" value="${w}" placeholder="${unit()}"/>`
    + `<span class="re-x">×</span>`
    + `<input class="re-set-r" inputmode="numeric" type="number" min="0" step="1" value="${s.reps || ''}" placeholder="${t('set.repsPlaceholder')}"/>`
    + `<button class="remove-set re-set-del" type="button" title="${t('set.removeTitle')}">×</button></div>`;
}
function bindEditorRows() {
  const list = document.querySelector('#reList');
  list.querySelectorAll('.re-move-del').forEach(b => b.onclick = () => { b.closest('.re-move').remove(); });
  list.querySelectorAll('.re-set-add').forEach(b => b.onclick = () => {
    b.previousElementSibling.insertAdjacentHTML('beforeend', reSet());
    bindEditorRows();
  });
  list.querySelectorAll('.re-set-del').forEach(b => b.onclick = () => {
    const row = b.closest('.re-set'), box = row.parentElement;
    // Un movimiento sin ninguna serie no se puede guardar: dejamos siempre una.
    if (box.children.length > 1) row.remove();
  });
}
function openEditor(name) {
  const plan = name ? planFor(name) : null;
  editing = plan ? { id: plan.id, name: plan.name } : { id: null, name: name || '' };
  document.querySelector('#reName').value = editing.name;
  document.querySelector('#reList').innerHTML = (plan?.exercises || []).map(reRow).join('') || reRow();
  bindEditorRows();
  document.querySelector('#routineEditor').hidden = false;
  document.querySelector('#routinesList').hidden = true;
  document.querySelector('#reName').focus();
}
// Crear el plan de una rutina que ya entrenaste: se precarga con lo que hiciste
// la última vez y desde ahí lo ajustás. Escribirlo de cero sería absurdo.
function openEditorFromHistory(name) {
  const prev = lastSessionByRoutine(name);
  editing = { id: null, name };
  document.querySelector('#reName').value = name;
  const rows = (prev?.exercises || []).map(e => reRow({ name: e.name, sets: e.sets }));
  document.querySelector('#reList').innerHTML = rows.join('') || reRow();
  bindEditorRows();
  document.querySelector('#routineEditor').hidden = false;
  document.querySelector('#routinesList').hidden = true;
}
function closeEditor() {
  editing = null;
  document.querySelector('#routineEditor').hidden = true;
  document.querySelector('#routinesList').hidden = false;
  renderRoutines();
}
function collectEditor() {
  return [...document.querySelectorAll('#reList .re-move')].map(m => ({
    name: m.querySelector('.re-move-name').value.trim(),
    sets: [...m.querySelectorAll('.re-set')].map(r => ({
      weight: fromDisplay(num(r.querySelector('.re-set-w').value.trim())),
      reps: num(r.querySelector('.re-set-r').value.trim()),
    })).filter(s => s.weight || s.reps),
  })).filter(e => e.name && e.sets.length);
}
async function saveEditor() {
  const name = document.querySelector('#reName').value.trim();
  if (!name) { await showAlert(t('routines.needName')); return; }
  const exercises = collectEditor();
  if (!exercises.length) { await showAlert(t('routines.needMoves')); return; }
  // Renombrar hacia un nombre ya usado por otro plan pisaría ese plan sin avisar.
  const clash = planFor(name);
  if (clash && clash.id !== editing?.id) {
    if (!(await showConfirm(t('routines.overwrite', { name }), { okText: t('routines.overwriteOk') }))) return;
  }
  if (editing?.id) {
    const plan = templates.find(x => x.id === editing.id);
    if (plan) Object.assign(plan, { name, exercises, updatedAt: new Date().toISOString() });
    saveTemplates(); window.renderConfig?.(); window.driveAutoSync?.();
  } else {
    saveRoutinePlan(name, exercises);
  }
  closeEditor();
}

document.querySelector('#newRoutine')?.addEventListener('click', () => openEditor(''));
document.querySelector('#reSave')?.addEventListener('click', saveEditor);
document.querySelector('#reCancel')?.addEventListener('click', closeEditor);
document.querySelector('#reClose')?.addEventListener('click', closeEditor);
document.querySelector('#reAdd')?.addEventListener('click', () => {
  document.querySelector('#reList').insertAdjacentHTML('beforeend', reRow());
  bindEditorRows();
});
document.querySelector('.tab[data-view="routines"]')?.addEventListener('click', () => { closeEditor(); });

window.renderRoutines = renderRoutines;
const prevRoutinesLangChange = window.onLangChange;
window.onLangChange = () => { prevRoutinesLangChange?.(); renderRoutines(); };
renderRoutines();
