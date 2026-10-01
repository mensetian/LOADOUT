// Subir la versión invalida la caché anterior en todos los dispositivos.
// OJO: al subirla, cambiar también el `?v=` de index.html al MISMO número (hay un
// test que lo vigila). Es lo que impide que un teléfono junte el HTML nuevo con
// el JS viejo: Chrome guarda los .js en memoria y ni le pregunta a este worker.
const CACHE = 'loadout-v50';
const ASSETS = ['./', './index.html', './manifest.json', './src/css/styles.css',
  './src/js/config.js', './src/js/i18n.js', './src/js/cardio.js', './src/js/app.js', './src/js/backup.js', './src/js/drive.js', './src/js/settings.js', './src/js/routines.js', './src/img/icon.svg',
  './src/img/icon-180.png', './src/img/icon-192.png', './src/img/icon-512.png', './src/img/icon-maskable-512.png'];

// GitHub Pages sirve todo con max-age=600: sin `cache: 'reload'`, la caché nueva
// se llenaba con archivos de la versión anterior que el navegador aún tenía
// guardados, y quedaba el HTML nuevo con el JS viejo (la app se rompía).
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Tocar la notificación de fin de descanso vuelve a la app (o la abre si estaba cerrada).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return clients.openWindow('./');
  }));
});

// Red primero para archivos propios (para recibir actualizaciones), caché como respaldo offline.
// `no-cache` pregunta siempre al servidor si el archivo cambió (si no, responde
// 304 y es casi gratis). Sin eso, "red primero" podía devolver del caché HTTP un
// archivo de hasta 10 minutos atrás y mezclar dos versiones de la app. Se pide
// por URL porque una navegación no admite opciones sobre su propia Request.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Peticiones a otros dominios (Google Identity, Drive API) van directas a la red.
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
