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
  const realRange = localStorage.getItem('loadout-rep-range');

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

    test('superar las repeticiones en un movimiento sin carga también es récord', () => {
      w.setSessions([session('a', '2026-01-01', null, [move('Dominadas', [[0, 8]])])]);
      const nueva = session('b', '2026-01-08', null, [move('Dominadas', [[0, 11]])]);
      equal(w.detectPRs(nueva).length, 1, 'de 8 a 11 repeticiones es un récord');
      const igual = session('c', '2026-01-08', null, [move('Dominadas', [[0, 8]])]);
      equal(w.detectPRs(igual).length, 0, 'repetir la misma marca no lo es');
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

    test('un movimiento sin carga tiene récord propio, medido en repeticiones', () => {
      w.setSessions([session('a', '2026-01-01', null, [
        move('Press', [[100, 5]]),
        move('Dominadas', [[0, 8], [0, 11]]),
      ])]);
      const prs = w.personalRecords();
      equal(prs.length, 2, 'los dos movimientos entran, también el de peso corporal');
      const dom = prs.find(r => r.name === 'Dominadas');
      equal(dom.loaded, false, 'se reconoce como movimiento sin carga');
      equal(dom.set.reps, 11, 'su marca es la serie de más repeticiones');
      equal(dom.score, 11, 'y se puntua por repeticiones, no por 1RM');
    });

    test('un movimiento se reconoce aunque el nombre varíe', () => {
      const mismo = (a, b) => equal(w.exKey(a), w.exKey(b), `"${a}" y "${b}" son el mismo movimiento`);
      const distinto = (a, b) => equal(w.exKey(a) !== w.exKey(b), true, `"${a}" y "${b}" son movimientos distintos`);
      mismo('Curl con mancuernas', 'Curl mancuernas');
      mismo('Elevación lateral', 'Elevaciones laterales');
      mismo('Press Banca', 'press banca');
      // pero no debe fusionar variantes que de verdad son otro ejercicio
      distinto('Press banca', 'Press banca inclinado');
      distinto('Peso muerto', 'Peso muerto rumano');
      equal(w.exKey('Press'), 'press', 'no le come la s a "press"');
    });

    test('"la última vez" desempata por la edición más reciente del mismo día', () => {
      const temprano = session('r-1', '2026-09-24', '2026-09-24T10:00:00Z', [move('Remo', [[40, 10]])]);
      const tarde = session('r-2', '2026-09-24', '2026-09-24T21:00:00Z', [move('Remo', [[45, 8]])]);
      w.setSessions([temprano, tarde]);
      equal(w.getLastExercise('Remo').sets[0].weight, 45, 'gana la sesión guardada más tarde');
      w.setSessions([tarde, temprano]);
      equal(w.getLastExercise('Remo').sets[0].weight, 45, 'sin importar el orden del historial');
    });

    test('anotando un día pasado, la referencia es anterior a ese día', () => {
      w.setSessions([
        session('p-1', '2026-09-10', null, [move('Press banca', [[50, 10]])]),
        session('p-2', '2026-09-20', null, [move('Press banca', [[60, 8]])]),
      ]);
      const act = w.getActive(), fecha = act.date;
      act.date = '2026-09-15';
      equal(w.getLastExercise('Press banca').sets[0].weight, 50, 'no toma el entrenamiento del 20 para el 15');
      act.date = '2026-09-26';
      equal(w.getLastExercise('Press banca').sets[0].weight, 60, 'hoy sí toma el más reciente');
      act.date = fecha;
    });

    test('el borrador de una sesión ya terminada no revive al sincronizar', () => {
      const terminada = session('ses-1', '2026-08-24', 'Empuje', [move('Press banca', [[60, 8]])]);
      w.setSessions([terminada]);
      localStorage.removeItem('loadout-draft-v1');
      // el respaldo remoto todavía trae el borrador de esa misma sesión
      const eco = { ...terminada, _draft: true, _unit: 'kg', _savedAt: '2026-08-24T20:00:00.000Z' };
      equal(w.syncDraft(eco), false, 'no cuenta como cambio: es un eco, no trabajo pendiente');
      equal(localStorage.getItem('loadout-draft-v1'), null, 'y no deja un borrador fantasma');
      // uno de una sesión que NO está en el historial sí debe restaurarse
      const pendiente = { ...session('otro-id', '2026-08-28', 'Tirón', [move('Remo', [[70, 10]])]), _draft: true, _unit: 'kg' };
      equal(w.syncDraft(pendiente), true, 'un borrador de verdad pendiente sí se recupera');
      localStorage.removeItem('loadout-draft-v1');
    });

    group('SOBRECARGA PROGRESIVA');
    // Arma dos sesiones del mismo movimiento (la vieja primero) y pregunta con
    // "hoy" = 26 sep. Cada lado es una lista de [peso, reps].
    const progreso = (antes, ultima, { fechas = ['2026-09-19', '2026-09-23'], nombre = 'Press banca', rango = '' } = {}) => {
      localStorage.setItem('loadout-unit', 'kg');
      if (rango) localStorage.setItem('loadout-rep-range', rango); else localStorage.removeItem('loadout-rep-range');
      w.setSessions([
        session('g-1', fechas[0], null, [move(nombre, antes)]),
        session('g-2', fechas[1], null, [move(nombre, ultima)]),
      ]);
      const act = w.getActive(), fecha = act.date;
      act.date = '2026-09-26';
      const out = w.progressionFor(nombre);
      act.date = fecha;
      localStorage.removeItem('loadout-rep-range');
      return out;
    };
    const tres = (kg, reps) => [[kg, reps], [kg, reps], [kg, reps]];

    test('propone subir tras dos sesiones completas con la misma carga', () => {
      const p = progreso(tres(60, 8), tres(60, 8));
      equal(p && p.w, 60, 'reconoce la carga de trabajo');
      assert(p && !('to' in p), 'avisa que toca subir, sin proponer a cuánto');
    });

    test('con una sola sesión todavía no hay nada consolidado', () => {
      localStorage.setItem('loadout-unit', 'kg');
      w.setSessions([session('g-1', '2026-09-23', null, [move('Press banca', tres(60, 8))])]);
      equal(w.progressionFor('Press banca'), null, 'no propone subir');
    });

    test('recién subida la carga, primero se consolida', () => {
      equal(progreso(tres(60, 8), tres(62.5, 8)), null, 'nunca dos subidas seguidas');
    });

    test('si alguna serie perdió repeticiones, no sube', () => {
      equal(progreso(tres(60, 8), [[60, 8], [60, 8], [60, 6]]), null, 'repetir hasta completar');
      equal(progreso(tres(60, 8), [[60, 8], [60, 8]]), null, 'menos series tampoco es completar');
    });

    test('series que se caen hacia el fallo no cuentan como dominadas', () => {
      const cae = [[60, 10], [60, 8], [60, 6]];
      equal(progreso(cae, cae), null, '10·8·6 no es dominar la carga');
      const p = progreso([[60, 8], [60, 8], [60, 7]], [[60, 8], [60, 8], [60, 7]]);
      equal(p && p.w, 60, 'caer 1 rep sí se tolera');
    });

    test('tras un parón de más de 3 semanas se repite, no se sube', () => {
      equal(progreso(tres(60, 8), tres(60, 8), { fechas: ['2026-08-20', '2026-08-25'] }), null, 'un mes sin entrenar: repetir');
    });

    test('el calentamiento no cuenta como serie de trabajo', () => {
      const p = progreso([[40, 10], [60, 8], [60, 8]], [[40, 10], [60, 8], [60, 8]]);
      equal(p && p.w, 60, 'la carga de trabajo es la más alta');
    });

    test('con mancuernas también avisa', () => {
      const p = progreso(tres(12, 10), tres(12, 10), { nombre: 'Curl con mancuernas' });
      equal(p && p.w, 12, 'la carga de trabajo es la de UNA mancuerna');
    });

    test('sin carga también avisa (toca sumar repeticiones)', () => {
      const p = progreso(tres(0, 10), tres(0, 10), { nombre: 'Dominadas' });
      equal(p && p.w, 0, 'sin carga de trabajo');
    });

    test('con rango de reps: sube al llegar a la meta en todas las series de trabajo', () => {
      const p = progreso(tres(60, 10), [[40, 12], [60, 12], [60, 12], [60, 12]], { rango: '8-12' });
      equal(p && p.w, 60, 'todas en 12: toca subir');
      equal(p && p.goal, 12, 'dice por qué');
      equal(progreso(tres(60, 12), [[60, 12], [60, 12], [60, 11]], { rango: '8-12' }), null, 'una en 11: todavía no');
    });

    test('con rango de reps no hace falta repetir la carga dos veces', () => {
      const p = progreso(tres(57.5, 12), tres(60, 12), { rango: '8-12' });
      equal(p && p.w, 60, 'recién subida, pero ya llegó a 12 en todas');
      localStorage.setItem('loadout-rep-range', '8-12');
      w.setSessions([session('g-1', '2026-09-23', null, [move('Press banca', tres(60, 12))])]);
      const act = w.getActive(), fecha = act.date;
      act.date = '2026-09-26';
      const sola = w.progressionFor('Press banca');
      act.date = fecha;
      localStorage.removeItem('loadout-rep-range');
      equal(sola && sola.w, 60, 'alcanza con una sola sesión');
    });

    test('con rango de reps, lo repetido sin llegar ya no pide subir', () => {
      equal(progreso(tres(60, 5), tres(60, 5), { rango: '8-12' }), null, '5·5·5 dos veces: sigue sin llegar a 12');
      equal(progreso(tres(60, 12), [[60, 12], [60, 12]], { rango: '8-12' }), null, 'menos series que la vez anterior no cuenta');
      equal(progreso(tres(60, 12), tres(60, 12), { rango: '8-12', fechas: ['2026-08-20', '2026-08-25'] }), null, 'tras un parón, repetir');
    });

    test('con rango de reps, sin carga sigue la regla de siempre', () => {
      const p = progreso(tres(0, 8), tres(0, 8), { nombre: 'Dominadas', rango: '8-12' });
      equal(p && p.w, 0, 'consolidado en 8, como antes: la meta no aplica');
      equal(progreso(tres(0, 8), tres(0, 7), { nombre: 'Dominadas', rango: '8-12' }), null, 'perder reps sigue sin contar');
    });

    group('HOY CONTRA LA ÚLTIMA VEZ');
    // compareSets(última vez, hoy, rango): series como [peso, reps].
    const sets = list => list.map(([weight, reps]) => ({ weight, reps }));
    const cmp = (antes, hoy, rango = null) => w.compareSets(sets(antes), sets(hoy), rango);
    const r812 = { min: 8, max: 12 };

    test('mismo peso: más reps es superar, menos es quedar abajo', () => {
      const c = cmp([[50, 10], [50, 10], [50, 10]], [[50, 11], [50, 10], [50, 10]]);
      equal(c.kind, 'more', 'una rep más'); equal(c.delta, 1, 'por una'); assert(c.done, 'series completas');
      equal(cmp([[50, 10], [50, 10]], [[50, 10], [50, 10]]).kind, 'same', 'lo mismo es igual');
      const b = cmp([[50, 10], [50, 10]], [[50, 10], [50, 8]]);
      equal(b.kind, 'less', 'dos menos'); equal(b.delta, -2, 'delta negativo');
    });

    test('una serie de más no infla la comparación', () => {
      const c = cmp([[50, 10], [50, 10]], [[50, 10], [50, 9], [50, 6]]);
      equal(c.kind, 'less', 'se comparan las 2 primeras: 19 contra 20');
    });

    test('a mitad del ejercicio el resultado es "por ahora"', () => {
      const c = cmp([[50, 10], [50, 10], [50, 10]], [[50, 11]]);
      equal(c.kind, 'more', 'va +1'); assert(!c.done, 'falta completar');
    });

    test('el calentamiento y las series livianas no cuentan', () => {
      const c = cmp([[30, 12], [50, 10], [50, 10], [40, 12]], [[30, 8], [50, 10], [50, 11], [40, 6]]);
      equal(c.kind, 'more', 'solo el trabajo con 50'); equal(c.delta, 1, '+1');
    });

    test('más peso: superado si completás las series en el mínimo del rango', () => {
      const ok = cmp([[50, 12], [50, 12]], [[52.5, 9], [52.5, 8]], r812);
      equal(ok.kind, 'heavier', 'subió'); assert(ok.done && !ok.low, 'en rango: superado');
      const bajo = cmp([[50, 12], [50, 12]], [[52.5, 8], [52.5, 6]], r812);
      assert(bajo.low, '6 reps queda bajo el mínimo');
      assert(!cmp([[50, 12], [50, 12]], [[52.5, 8]], r812).done, 'una sola serie: falta');
      assert(!cmp([[50, 12]], [[52.5, 3]]).low, 'sin rango no hay mínimo');
    });

    test('menos peso no se compara', () => {
      equal(cmp([[50, 10]], [[45, 12]]).kind, 'lighter', 'descarga: neutro');
    });

    test('las series sin reps no cuentan, y sin series no hay comparación', () => {
      equal(cmp([[50, 10]], [[60, 0]]), null, 'peso sin reps no es una serie');
      equal(cmp([[50, 10]], []), null, 'nada anotado');
      equal(cmp([], [[50, 10]]), null, 'nada con qué comparar');
    });

    test('el redondeo de las libras no se toma como subida', () => {
      equal(cmp([[60, 8]], [[60.01, 9]]).kind, 'more', '132.3 lb = 60 kg');
    });

    test('sin carga se comparan las reps', () => {
      equal(cmp([[0, 8], [0, 8]], [[0, 9], [0, 8]]).kind, 'more', 'dominadas +1');
    });

    test('al cerrar cuenta cuántos superaste, sin nuevos, parones ni más livianos', () => {
      localStorage.setItem('loadout-unit', 'kg');
      localStorage.setItem('loadout-rep-range', '8-12');
      w.setSessions([
        session('h-1', '2026-08-01', null, [move('Curl', [[12, 10]])]),
        session('h-2', '2026-09-23', null, [move('Press banca', [[50, 10], [50, 10]]), move('Remo', [[50, 12], [50, 12]]),
          move('Fondos', [[0, 10]]), move('Sentadilla', [[80, 8]])]),
      ]);
      const act = w.getActive(), fecha = act.date;
      act.date = '2026-09-26';
      const r = w.beatenCount(session('hoy', '2026-09-26', null, [
        move('Press banca', [[50, 11], [50, 10]]),   // +1: superado
        move('Remo', [[52.5, 8], [52.5, 7]]),        // subió, una bajo 8: no
        move('Fondos', [[0, 10]]),                   // igual: no
        move('Sentadilla', [[70, 10]]),              // más liviano: no cuenta
        move('Curl', [[12, 11]]),                    // tras un parón: no cuenta
        move('Nuevo', [[20, 10]]),                   // sin historial: no cuenta
      ]));
      act.date = fecha;
      localStorage.removeItem('loadout-rep-range');
      equal(r.beaten, 1, 'solo el press');
      equal(r.total, 3, 'press, remo y fondos');
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

    group('PUBLICACIÓN');
    test('index.html pide sus archivos con la misma versión que la caché del service worker', () => {
      // XHR síncrono a propósito: los tests son síncronos y esto es solo leer texto.
      const get = u => { const x = new XMLHttpRequest(); x.open('GET', u + '?t=' + Date.now(), false); x.send(); return x.responseText; };
      const cache = (get('../sw.js').match(/const CACHE = 'loadout-v(\d+)'/) || [])[1];
      const html = get('../index.html');
      const refs = [...html.matchAll(/(?:src|href)="src\/(?:js|css)\/[\w.]+\?v=(\d+)"/g)].map(m => m[1]);
      const plain = html.match(/(?:src|href)="src\/(?:js|css)\/[\w.]+\.(?:js|css)"/g) || [];
      assert(cache, 'no se encontró la versión en sw.js');
      equal(plain, [], 'todo .js/.css propio debe llevar ?v=');
      assert(refs.length >= 9, `se esperaban ≥ 9 archivos versionados, hay ${refs.length}`);
      equal([...new Set(refs)], [cache], `?v= de index.html debe ser ${cache}, igual que CACHE en sw.js`);
    });

    group('FECHA ELEGIDA');
    // Solo se toca la marca en memoria de la sesión activa y se restaura: nada
    // de esto escribe en localStorage.
    const active = w.getActive(), hadPick = active._datePicked;
    try {
      test('un día elegido cuenta como trabajo en curso aunque no haya series', () => {
        active._datePicked = true;
        assert(w.draftInProgress(), 'una sincronización no debe reiniciar la sesión y devolverla a hoy');
      });
      test('la marca de día elegido no llega al historial', () => {
        active._datePicked = true;
        assert(!('_datePicked' in w.collectSession()), 'la sesión guardada no debe llevar _datePicked');
      });
    } finally {
      if (hadPick === undefined) delete active._datePicked; else active._datePicked = hadPick;
    }
  } finally {
    w.setSessions(realSessions);
    w.setTemplates(realTemplates);
    w.setCardio(realCardio);
    if (realUnit === null) localStorage.removeItem('loadout-unit');
    else localStorage.setItem('loadout-unit', realUnit);
    if (realRange === null) localStorage.removeItem('loadout-rep-range');
    else localStorage.setItem('loadout-rep-range', realRange);
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
