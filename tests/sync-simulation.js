// Simulación de dos dispositivos + Drive usando el CÓDIGO REAL extraído de
// app.js (lápidas) y drive.js (fusión). Reproduce el ciclo completo de
// sincronización para verificar que ningún escenario pierde ni revive datos.
//
// Los otros tests viven en tests/index.html porque necesitan el navegador; este
// no toca el DOM, así que corre en la terminal:  node tests/sync-simulation.js
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f), 'utf8');
const app = read('app.js');
const drv = read('drive.js');

const slice = (src, from, to, name) => {
  const a = src.indexOf(from), b = src.indexOf(to);
  if (a < 0 || b < 0 || b <= a) { console.error(`NO PUDE EXTRAER ${name}`); process.exit(1); }
  return src.slice(a, b);
};
const tombBlock = slice(app, "const DELETED_KEY = 'loadout-deleted-v1';", '// --- Unidades de carga', 'lapidas');
const mergeBlock = slice(drv, 'function sessionStamp', 'function adoptSessions', 'fusion');

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const lib = new Function(`${tombBlock}\n${mergeBlock}\nreturn { mergeDeleted, applyDeleted, mergeSessions, sessionStamp };`)();

// El paso de sincronización tal cual lo hace driveSync: unir lápidas, fusionar,
// aplicar lápidas, y subir el resultado a Drive.
function sync(device, driveFile) {
  device.tombs = lib.mergeDeleted(device.tombs, driveFile.deleted);
  device.sessions = lib.applyDeleted(lib.mergeSessions(device.sessions, driveFile.sessions), lib.sessionStamp, device.tombs);
  driveFile.sessions = device.sessions;
  driveFile.deleted = device.tombs;
}

let fail = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { fail++; console.log(`  FALLO: ${msg}\n    esperado ${JSON.stringify(b)}\n    obtenido ${JSON.stringify(a)}`); }
  else console.log(`  ok: ${msg}`);
};
const s = (id, date, updatedAt) => ({ id, date, ...(updatedAt ? { updatedAt } : {}), name: 'x', exercises: [] });
const ids = list => list.map(x => x.id).sort();
const iso = minsAgo => new Date(Date.now() - minsAgo * 60000).toISOString();

// ESCENARIO 1: borrar en A no revive al sincronizar B (el bug original).
{
  console.log('ESCENARIO 1: el borrado se propaga y no revive');
  const A = { sessions: [s('s1', '2026-07-01'), s('s2', '2026-07-02')], tombs: {} };
  const B = { sessions: [s('s1', '2026-07-01'), s('s2', '2026-07-02')], tombs: {} };
  const drive = { sessions: [s('s1', '2026-07-01'), s('s2', '2026-07-02')], deleted: {} };
  // A borra s1 y sincroniza.
  A.tombs.s1 = iso(10);
  A.sessions = A.sessions.filter(x => x.id !== 's1');
  sync(A, drive);
  eq(ids(drive.sessions), ['s2'], 'Drive ya no tiene la borrada');
  // B sincroniza: antes esto revivía s1.
  sync(B, drive);
  eq(ids(B.sessions), ['s2'], 'B obedece el borrado en vez de revivirlo');
  // Tercera pasada de A: sigue sin revivir.
  sync(A, drive);
  eq(ids(A.sessions), ['s2'], 'ninguna pasada posterior lo resucita');
}

// ESCENARIO 2: B editó la sesión DESPUÉS del borrado de A → gana la edición.
{
  console.log('ESCENARIO 2: editar después del borrado gana');
  const drive = { sessions: [s('s1', '2026-07-01', iso(60))], deleted: {} };
  const A = { sessions: [s('s1', '2026-07-01', iso(60))], tombs: {} };
  const B = { sessions: [s('s1', '2026-07-01', iso(60))], tombs: {} };
  A.tombs.s1 = iso(30);            // A la borró hace 30 min
  A.sessions = [];
  sync(A, drive);
  B.sessions = [s('s1', '2026-07-01', iso(5))]; // B la editó hace 5 min (después)
  sync(B, drive);
  eq(ids(B.sessions), ['s1'], 'la edición posterior sobrevive en B');
  sync(A, drive);
  eq(ids(A.sessions), ['s1'], 'y vuelve también al dispositivo que la borró');
}

// ESCENARIO 3: sentido inverso — se edita ANTES del borrado → borrado gana.
{
  console.log('ESCENARIO 3: el borrado posterior a la edición gana');
  const drive = { sessions: [s('s1', '2026-07-01', iso(60))], deleted: {} };
  const A = { sessions: [s('s1', '2026-07-01', iso(60))], tombs: {} };
  const B = { sessions: [s('s1', '2026-07-01', iso(40))], tombs: {} }; // edición vieja
  A.tombs.s1 = iso(10); // borrado más reciente
  A.sessions = [];
  sync(A, drive); sync(B, drive);
  eq(ids(B.sessions), [], 'la edición anterior al borrado no lo deshace');
}

// ESCENARIO 4: entrenar en dos aparatos distintos días — nada se pierde.
{
  console.log('ESCENARIO 4: la unión normal sigue intacta');
  const drive = { sessions: [], deleted: {} };
  const A = { sessions: [s('a1', '2026-07-01')], tombs: {} };
  const B = { sessions: [s('b1', '2026-07-02')], tombs: {} };
  sync(A, drive); sync(B, drive); sync(A, drive);
  eq(ids(A.sessions), ['a1', 'b1'], 'A tiene lo de ambos');
  eq(ids(B.sessions), ['a1', 'b1'], 'B tiene lo de ambos');
}

// ESCENARIO 5: respaldo antiguo en Drive (sin campo deleted) no revienta nada.
{
  console.log('ESCENARIO 5: compatibilidad con respaldos sin lápidas');
  const drive = { sessions: [s('s1', '2026-07-01')] }; // sin .deleted
  const A = { sessions: [s('s2', '2026-07-02')], tombs: {} };
  sync(A, drive);
  eq(ids(A.sessions), ['s1', 's2'], 'fusiona normal aunque el respaldo sea viejo');
}

// ESCENARIO 6: la lápida caducada deja de viajar (limpieza a los 180 días).
{
  console.log('ESCENARIO 6: caducidad de lápidas');
  const old = new Date(Date.now() - 200 * 86400000).toISOString();
  const merged = lib.mergeDeleted({ vieja: old, fresca: iso(10) }, {});
  eq(Object.keys(merged), ['fresca'], 'la caducada se limpia, la fresca sigue');
}

console.log(fail ? `\n${fail} FALLO(S)` : '\nTODO CORRECTO');
process.exit(fail ? 1 : 0);
