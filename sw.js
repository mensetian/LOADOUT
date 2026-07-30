// Subir la versión invalida la caché anterior en todos los dispositivos.
const CACHE = 'loadout-v40';
const ASSETS = ['./', './index.html', './manifest.json', './src/css/styles.css',
  './src/js/config.js', './src/js/i18n.js', './src/js/cardio.js', './src/js/app.js', './src/js/backup.js', './src/js/drive.js', './src/js/settings.js', './src/img/icon.svg',
  './src/img/icon-180.png', './src/img/icon-192.png', './src/img/icon-512.png', './src/img/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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
