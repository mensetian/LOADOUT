// ---------------------------------------------------------------------------
// Tests de LOADOUT
//
// No hay framework ni build: la app real se carga en un iframe y aquí se llaman
// sus funciones globales. Así se prueba el código que se publica, sin copiarlo.
//
// REGLA DE ORO: estos tests JAMÁS deben llamar a save(), saveTemplates() ni a
// nada que escriba en localStorage, porque comparten origen con la app y
// borrarían el historial real del usuario. Solo se leen funciones puras y se
// reasignan variables en memoria, restaurándolas al terminar.
// ---------------------------------------------------------------------------

const results = document.querySelector('#results');
const summary = document.querySelector('#summary');
let passed = 0, failed = 0;

function report(name, error) {
  const li = document.createElement('li');
  li.className = error ? 'no' : 'ok';
  li.textContent = name;
  if (error) {
    const why = document.createElement('span');
    why.className = 'why';
    why.textContent = error.message || String(error);
    li.append(why);
    failed++;
  } else passed++;
  results.append(li);
}

function group(title) {
  const li = document.createElement('li');
  li.className = 'group';
  li.textContent = title;
  results.append(li);
}

function test(name, fn) {
  try { fn(); report(name); } catch (error) { report(name, error); }
}

function assert(cond, message) {
  if (!cond) throw new Error(message || 'la condición no se cumplió');
}
function equal(actual, expected, message) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message || 'valores distintos'} · esperado ${b}, recibido ${a}`);
}
function close(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message || 'fuera de tolerancia'} · esperado ~${expected}, recibido ${actual}`);
  }
}

// Atajos para construir datos de prueba.
const session = (id, date, updatedAt, exercises = []) => ({ id, date, ...(updatedAt ? { updatedAt } : {}), name: 'Test', exercises });
const move = (name, sets) => ({ name, sets: sets.map(([weight, reps]) => ({ weight, reps })) });

function run(frameWindow) {
  // `window.LOADOUT_TEST` es la superficie que la app expone: sin módulos ES,
  // sus `const`/`let` de nivel superior no son propiedades de window.
  const w = frameWindow.LOADOUT_TEST;
  if (!w) throw new Error('la app no expuso window.LOADOUT_TEST');

  // Copias de seguridad en memoria: las devolvemos intactas al terminar.
  const realSessions = w.getSessions(), realTemplates = w.getTemplates(), realCardio = w.getCardio();
  const realUnit = localStorage.getItem('loadout-unit');

  try {
    group('FUSIÓN DE SESIONES (Drive)');

    test('une los dos lados sin perder ninguna sesión', () => {
      const local = [session('a', '2026-01-01'), session('b', '2026-01-02')];
      const remote = [session('c', '2026-01-03')];
      const merged = w.mergeSessions(local, remote);
      equal(merged.map(s => s.id).sort(), ['a', 'b', 'c'], 'ids tras fusionar');
    });

    test('ante el mismo id gana la edición más reciente', () => {
      const local = [session('a', '2026-01-01', '2026-01-05T10:00:00.000Z', [move('Press', [[100, 5]])])];
      const remote = [session('a', '2026-01-01', '2026-01-06T10:00:00.000Z', [move('Press', [[110, 5]])])];
      const merged = w.mergeSessions(local, remote);
      equal(merged.length, 1, 'no debe duplicar el id');
      equal(merged[0].exercises[0].sets[0].weight, 110, 'debe quedarse la versión remota, más nueva');
    });

    test('en un empate exacto gana el dispositivo local', () => {
      const stamp = '2026-01-05T10:00:00.000Z';
      const local = [session('a', '2026-01-01', stamp, [move('Press', [[100, 5]])])];
      const remote = [session('a', '2026-01-01', stamp, [move('Press', [[110, 5]])])];
      equal(w.mergeSessions(local, remote)[0].exercises[0].sets[0].weight, 100, 'debe ganar lo local');
    });

    test('sin sello de edición se usa la fecha del entrenamiento', () => {
      const local = [session('a', '2026-01-01', null, [move('Press', [[100, 5]])])];
      const remote = [session('a', '2026-03-01', null, [move('Press', [[110, 5]])])];
      equal(w.mergeSessions(local, remote)[0].exercises[0].sets[0].weight, 110, 'debe ganar la fecha mayor');
    });

    test('devuelve el historial ordenado de más nuevo a más viejo', () => {
      const merged = w.mergeSessions([session('a', '2026-01-01')], [session('b', '2026-05-05'), session('c', '2026-03-03')]);
      equal(merged.map(s => s.date), ['2026-05-05', '2026-03-03', '2026-01-01'], 'orden por fecha descendente');
    });

    test('fusionar con un lado vacío no altera el otro', () => {
      const local = [session('a', '2026-01-01'), session('b', '2026-02-02')];
      equal(w.mergeSessions(local, []).map(s => s.id).sort(), ['a', 'b'], 'no debe perder nada');
    });

    group('FUSIÓN DE PLANTILLAS');

    const tpl = (id, name, updatedAt, exercises = []) => ({ id, name, updatedAt, exercises });

    test('une plantillas de ambos lados por id', () => {
      const merged = w.mergeTemplates([tpl('1', 'Pecho', '2026-01-01T00:00:00.000Z')], [tpl('2', 'Pierna', '2026-01-01T00:00:00.000Z')]);
      equal(merged.map(x => x.name), ['Pecho', 'Pierna'], 'debe quedarse con las dos');
    });

    test('ante el mismo id gana la plantilla editada más tarde', () => {
      const local = [tpl('1', 'Viejo', '2026-01-01T00:00:00.000Z')];
      const remote = [tpl('1', 'Nuevo', '2026-06-01T00:00:00.000Z')];
      const merged = w.mergeTemplates(local, remote);
      equal(merged.length, 1, 'no debe duplicar');
      equal(merged[0].name, 'Nuevo', 'debe ganar la más reciente');
    });

    test('tolera que el otro lado no traiga plantillas', () => {
      equal(w.mergeTemplates([tpl('1', 'Pecho', '2026-01-01T00:00:00.000Z')], undefined).length, 1, 'undefined debe tratarse como vacío');
    });

    group('RÉCORDS PERSONALES');

    test('detecta un récord cuando se supera la carga anterior', () => {
      w.setSessions([session('vieja', '2026-01-01', null, [move('Press banca', [[100, 5]])])]);
      const entry = session('nueva', '2026-02-01', null, [move('Press banca', [[110, 5]])]);
      const prs = w.detectPRs(entry);
      equal(prs.length, 1, 'debería haber un récord');
      assert(prs[0].includes('Press banca'), 'el aviso debe nombrar el movimiento');
    });

    test('no inventa un récord si no se supera la marca', () => {
      w.setSessions([session('vieja', '2026-01-01', null, [move('Press banca', [[120, 5]])])]);
      const entry = session('nueva', '2026-02-01', null, [move('Press banca', [[110, 5]])]);
      equal(w.detectPRs(entry).length, 0, 'no debe marcar récord');
    });

    test('la primera vez que haces un movimiento no cuenta como récord', () => {
      w.setSessions([]);
      const entry = session('nueva', '2026-02-01', null, [move('Sentadilla', [[80, 5]])]);
      equal(w.detectPRs(entry).length, 0, 'sin referencia previa no hay récord');
    });

    test('no se compara consigo misma al reeditar una sesión guardada', () => {
      const same = session('x', '2026-02-01', null, [move('Peso muerto', [[150, 3]])]);
      w.setSessions([same]);
      equal(w.detectPRs(same).length, 0, 'editar la propia sesión no debe generar un récord');
    });

    test('el nombre del movimiento no distingue mayúsculas', () => {
      w.setSessions([session('vieja', '2026-01-01', null, [move('press banca', [[100, 5]])])]);
      const entry = session('nueva', '2026-02-01', null, [move('PRESS BANCA', [[110, 5]])]);
      equal(w.detectPRs(entry).length, 1, 'debe reconocerlo como el mismo ejercicio');
    });

    test('el 1RM estimado sigue la fórmula de Epley', () => {
      close(w.e1rm({ weight: 100, reps: 0 }), 100, 0.001, 'a 1 rep el estimado es el propio peso');
      close(w.e1rm({ weight: 100, reps: 10 }), 133.333, 0.01, '100 kg × 10 reps');
    });

    test('el mejor 1RM por movimiento manda sobre la carga máxima suelta', () => {
      // 100×5 (e1RM ≈ 116,7) supera a 110×1 (e1RM ≈ 113,7) pese a pesar menos.
      w.setSessions([session('a', '2026-01-01', null, [move('Press', [[110, 1], [100, 5]])])]);
      const prs = w.personalRecords();
      equal(prs.length, 1, 'un movimiento, un récord');
      equal(prs[0].set.weight, 100, 'debe elegir la serie con mejor 1RM estimado');
    });

    group('UNIDADES (kg / lb)');

    test('convertir a libras y volver no pierde el valor', () => {
      [20, 62.5, 100, 137.5].forEach(kg => {
        close(w.fromUnit(w.toUnit(kg, 'lb'), 'lb'), kg, 0.05, `ida y vuelta de ${kg} kg`);
      });
    });

    test('la conversión a libras usa el factor real', () => {
      close(w.toUnit(100, 'kg'), 100, 0.001, 'en kg no debe convertir nada');
      close(w.toUnit(100, 'lb'), 220.5, 0.05, '100 kg en libras, redondeado a 1 decimal');
      close(w.fromUnit(220.462, 'lb'), 100, 0.01, '220,462 lb en kilos');
    });

    test('cambiar de unidad no altera lo guardado en el historial', () => {
      const original = session('a', '2026-01-01', null, [move('Press', [[100, 5]])]);
      const copy = JSON.parse(JSON.stringify(original));
      localStorage.setItem('loadout-unit', 'lb');
      w.toDisplay(copy.exercises[0].sets[0].weight);
      localStorage.setItem('loadout-unit', 'kg');
      equal(copy, original, 'pintar en otra unidad no debe tocar los datos');
    });

    group('PINTAR LA SESIÓN EN LA UNIDAD ACTIVA');

    // Una sesión guardada trae kilos; un borrador trae el texto tal cual se
    // tecleó, sellado con la unidad de ese momento. Confundirlos falsea cargas.
    const setUnitPref = u => localStorage.setItem('loadout-unit', u);

    test('una sesión del historial se convierte de kg a la unidad activa', () => {
      setUnitPref('lb');
      const out = w.exercisesForRender(session('a', '2026-01-01', null, [move('Press', [[100, 5]])]));
      close(out[0].sets[0].weight, 220.5, 0.1, '100 kg deben verse como ~220,5 lb');
    });

    test('un borrador escrito en la unidad activa se deja intacto', () => {
      setUnitPref('lb');
      const draft = { _draft: true, _unit: 'lb', exercises: [{ name: 'Press', sets: [{ weight: '225', reps: '5' }] }] };
      equal(w.exercisesForRender(draft)[0].sets[0].weight, '225', 'no debe reconvertir lo ya tecleado en lb');
    });

    test('un borrador escrito en otra unidad se reinterpreta al pintarlo', () => {
      setUnitPref('lb');
      const draft = { _draft: true, _unit: 'kg', exercises: [{ name: 'Press', sets: [{ weight: '100', reps: '5' }] }] };
      close(w.exercisesForRender(draft)[0].sets[0].weight, 220.5, 0.1, '100 kg tecleados deben pasar a libras');
    });

    test('una sesión guardada nunca lleva las marcas del borrador', () => {
      // Si `_draft` se colara al historial, sus kilos se releerían como si
      // fueran otra unidad y la carga quedaría falseada al reabrir la sesión.
      w.setSessions([]);
      const saved = session('a', '2026-01-01', null, [move('Press', [[100, 5]])]);
      assert(!('_draft' in saved) && !('_unit' in saved), 'la sesión guardada debe estar limpia');
      setUnitPref('kg');
      equal(w.exercisesForRender(saved)[0].sets[0].weight, 100, 'en kg debe verse igual que lo guardado');
    });

    test('los campos vacíos siguen vacíos, no se vuelven cero', () => {
      setUnitPref('lb');
      const draft = { _draft: true, _unit: 'kg', exercises: [{ name: 'Press', sets: [{ weight: '', reps: '' }] }] };
      equal(w.exercisesForRender(draft)[0].sets[0].weight, '', 'un peso sin teclear debe quedarse vacío');
    });

    group('EXPORTAR → IMPORTAR');

    test('el respaldo lleva sesiones y plantillas, y se relee igual', () => {
      const sessionsOut = [session('a', '2026-01-01', null, [move('Press', [[100, 5]])])];
      const templatesOut = [tpl('1', 'Pecho', '2026-01-01T00:00:00.000Z', [move('Press', [[100, 5]])])];
      const payload = { app: 'LOADOUT', version: 1, exportedAt: new Date().toISOString(), sessions: sessionsOut, templates: templatesOut };
      const back = JSON.parse(JSON.stringify(payload));
      assert(Array.isArray(back.sessions), 'importar exige que sessions sea un array');
      equal(back.sessions, sessionsOut, 'las sesiones deben volver idénticas');
      equal(back.templates, templatesOut, 'las plantillas deben volver idénticas');
    });

    test('un respaldo viejo sin plantillas sigue siendo válido', () => {
      const back = JSON.parse(JSON.stringify({ app: 'LOADOUT', version: 1, sessions: [session('a', '2026-01-01')] }));
      assert(Array.isArray(back.sessions), 'debe seguir importándose');
      assert(!Array.isArray(back.templates), 'sin plantillas no debe tocarlas');
      equal(w.mergeTemplates([tpl('1', 'Pecho', '2026-01-01T00:00:00.000Z')], back.templates).length, 1, 'las plantillas locales se conservan');
    });

    test('reimportar el mismo respaldo no duplica sesiones', () => {
      const list = [session('a', '2026-01-01'), session('b', '2026-02-02')];
      const again = JSON.parse(JSON.stringify(list));
      equal(w.mergeSessions(list, again).length, 2, 'la fusión debe ser idempotente');
    });
    group('CARDIO');

    const card = (id, date, activity, minutes, updatedAt, extra = {}) => ({ id, date, activity, minutes, updatedAt, ...extra });
    const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

    test('une el cardio de ambos lados por id', () => {
      const merged = w.mergeCardio(
        [card('1', '2026-01-01', 'Patineta', 60, '2026-01-01T00:00:00.000Z')],
        [card('2', '2026-01-02', 'Bici', 30, '2026-01-02T00:00:00.000Z')]);
      equal(merged.map(c => c.id).sort(), ['1', '2'], 'no debe perder ninguna entrada');
    });

    test('ante el mismo id gana la entrada editada más tarde', () => {
      const merged = w.mergeCardio(
        [card('1', '2026-01-01', 'Patineta', 60, '2026-01-01T00:00:00.000Z')],
        [card('1', '2026-01-01', 'Patineta', 90, '2026-06-01T00:00:00.000Z')]);
      equal(merged.length, 1, 'no debe duplicar');
      equal(merged[0].minutes, 90, 'debe quedarse la versión más nueva');
    });

    test('tolera que el otro lado no traiga cardio (respaldo viejo)', () => {
      equal(w.mergeCardio([card('1', '2026-01-01', 'Patineta', 60, '2026-01-01T00:00:00.000Z')], undefined).length, 1,
        'undefined debe tratarse como lista vacía');
    });

    test('reimportar el mismo respaldo no duplica cardio', () => {
      const list = [card('1', '2026-01-01', 'Patineta', 60, '2026-01-01T00:00:00.000Z')];
      equal(w.mergeCardio(list, JSON.parse(JSON.stringify(list))).length, 1, 'la fusión debe ser idempotente');
    });

    test('el acumulado suma minutos y promedia el esfuerzo', () => {
      w.setCardio([
        card('1', '2026-01-01', 'Patineta', 60, '2026-01-01T00:00:00.000Z', { rpe: 6 }),
        card('2', '2026-01-02', 'Patineta', 40, '2026-01-02T00:00:00.000Z', { rpe: 8 }),
        card('3', '2026-01-03', 'Bici', 30, '2026-01-03T00:00:00.000Z'),
      ]);
      const s = w.cardioStats();
      equal(s.count, 3, 'tres registros');
      equal(s.minutes, 130, 'minutos totales');
      equal(s.avgRpe, 7, 'el promedio ignora los registros sin esfuerzo marcado');
      equal(s.top.name, 'Patineta', 'la actividad principal es la de más minutos');
      equal(s.top.minutes, 100, 'minutos de la actividad principal');
    });

    test('los últimos 7 días solo cuentan lo reciente', () => {
      w.setCardio([
        card('viejo', '2020-01-01', 'Patineta', 999, '2020-01-01T00:00:00.000Z'),
        card('hoy', todayISO(), 'Patineta', 45, new Date().toISOString()),
      ]);
      equal(w.cardioStats().weekMinutes, 45, 'lo antiguo no debe entrar en la ventana de 7 días');
    });

    test('sin esfuerzo marcado el promedio queda vacío, no en cero', () => {
      w.setCardio([card('1', '2026-01-01', 'Patineta', 60, '2026-01-01T00:00:00.000Z')]);
      equal(w.cardioStats().avgRpe, null, 'no debe inventar un 0/10');
    });

    group('BORRADOS (lápidas)');

    // Mismo criterio que sessionStamp() en drive.js: sin sello de edición vale
    // la fecha del entrenamiento.
    const stampOf = s => s.updatedAt || `${s.date}T00:00:00.000Z`;
    const recent = new Date(Date.now() - 86400000).toISOString();   // ayer
    const older = new Date(Date.now() - 172800000).toISOString();   // anteayer

    test('une lápidas quedándose con la marca más reciente', () => {
      const merged = w.mergeDeleted({ a: older }, { a: recent, b: recent });
      equal(merged.a, recent, 'debe ganar la marca más nueva');
      equal(Object.keys(merged).sort(), ['a', 'b'], 'debe conservar las de ambos lados');
    });

    test('olvida las lápidas demasiado viejas', () => {
      const merged = w.mergeDeleted({ vieja: '2020-01-01T00:00:00.000Z' }, {});
      equal(Object.keys(merged), [], 'una lápida caducada no debe seguir ocupando sitio');
    });

    test('una sesión borrada no revive al fusionar', () => {
      const list = [session('a', '2026-01-01'), session('b', '2026-01-02')];
      const kept = w.applyDeleted(list, stampOf, { a: recent });
      equal(kept.map(s => s.id), ['b'], 'la sesión con lápida debe desaparecer');
    });

    test('si se editó después del borrado, gana la edición', () => {
      const list = [session('a', '2026-01-01', new Date().toISOString())];
      const kept = w.applyDeleted(list, stampOf, { a: older });
      equal(kept.length, 1, 'una lápida vieja no debe enterrar una edición nueva');
    });

    test('sin lápidas no toca nada', () => {
      const list = [session('a', '2026-01-01'), session('b', '2026-01-02')];
      equal(w.applyDeleted(list, stampOf, {}).length, 2, 'no debe descartar nada');
    });
  } finally {
    w.setSessions(realSessions);
    w.setTemplates(realTemplates);
    w.setCardio(realCardio);
    if (realUnit === null) localStorage.removeItem('loadout-unit');
    else localStorage.setItem('loadout-unit', realUnit);
  }

  summary.className = failed ? 'fail' : 'pass';
  summary.textContent = failed
    ? `${failed} fallo(s) · ${passed} correcto(s) de ${passed + failed}`
    : `Todo en orden · ${passed} pruebas correctas`;
}

const frame = document.querySelector('#app');
frame.addEventListener('load', () => {
  try {
    run(frame.contentWindow);
  } catch (error) {
    summary.className = 'fail';
    summary.textContent = `No se pudieron ejecutar los tests: ${error.message}`;
  }
});
