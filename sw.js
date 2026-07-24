// Subir la versión invalida la caché anterior en todos los dispositivos.
const CACHE = 'loadout-v10';
const ASSETS = ['./', './index.html', './manifest.json', './src/css/styles.css',
  './src/js/config.js', './src/js/i18n.js', './src/js/app.js', './src/js/backup.js', './src/js/drive.js', './src/img/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Red primero para archivos propios (para recibir actualizaciones), caché como respaldo offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Peticiones a otros dominios (Google Identity, Drive API) van directas a la red.
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
