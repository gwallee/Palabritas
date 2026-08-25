/* Palabritas service worker — makes the app work fully offline */
const CACHE = 'palabritas-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './lists.json',
  './vendor/tesseract.min.js',
  './vendor/worker.min.js',
  './vendor/core/tesseract-core-simd-lstm.wasm.js',
  './vendor/core/tesseract-core-lstm.wasm.js',
  './vendor/lang/spa.traineddata.gz',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // lists.json is the shared word-list feed: network-first so new lists arrive promptly.
  if (url.pathname.endsWith('/lists.json')) {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return resp;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }

  // Everything else: cache-first, refreshed in the background.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => {
      const refresh = fetch(e.request)
        .then(resp => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
