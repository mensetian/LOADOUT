// ---------------------------------------------------------------------------
// Ejecuta tests/index.html en un navegador headless y devuelve el resultado por
// terminal (útil para comprobar de un vistazo antes de publicar).
//
// Es OPCIONAL: la forma normal de correr los tests sigue siendo abrir
// tests/index.html en el navegador, sin instalar nada. Este runner solo añade
// comodidad, así que el proyecto sigue sin dependencias obligatorias.
//
//   npm install playwright-core     (una vez; queda fuera de git)
//   node tests/run.js
//
// No descarga ningún navegador: reutiliza el Chrome o Edge que ya tengas. Abre
// un perfil nuevo y vacío, así que NO toca el localStorage de tu app real.
// ---------------------------------------------------------------------------

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright-core')); }
catch {
  console.error('Falta playwright-core. Instálalo con:\n\n  npm install playwright-core\n\n'
    + 'O simplemente abre tests/index.html en tu navegador: no necesita nada.');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('no encontrado'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// Navegadores ya instalados, por orden de preferencia.
function findBrowser() {
  const candidates = [
    ['chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'],
    ['msedge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
    ['chrome', '/usr/bin/google-chrome'],
    ['chromium', '/usr/bin/chromium'],
    ['chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  ];
  for (const [name, exe] of candidates) if (fs.existsSync(exe)) return { name, exe };
  throw new Error('no encontré Chrome ni Edge instalados');
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const { name, exe } = findBrowser();
  console.log(`navegador: ${name} (headless)\n`);

  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`[error JS] ${e.message}`));

  await page.goto(`http://localhost:${port}/tests/`, { waitUntil: 'load' });
  // El resumen pasa a .pass/.fail cuando terminan todas las pruebas.
  await page.waitForSelector('#summary.pass, #summary.fail', { timeout: 20000 });

  const out = await page.evaluate(() => ({
    summary: document.querySelector('#summary').textContent,
    ok: document.querySelector('#summary').classList.contains('pass'),
    lines: [...document.querySelectorAll('#results li')].map(li => ({ kind: li.className, text: li.textContent })),
  }));

  for (const l of out.lines) {
    if (l.kind === 'group') console.log(`\n${l.text}`);
    else console.log(`  ${l.kind === 'ok' ? 'PASS' : 'FAIL'}  ${l.text}`);
  }
  console.log(`\n${out.summary}`);
  if (errors.length) { console.log('\nErrores de la página:'); errors.forEach(e => console.log(`  ${e}`)); }

  await browser.close();
  server.close();
  process.exit(out.ok ? 0 : 1);
})().catch(e => { console.error('fallo del runner:', e.message); process.exit(2); });
