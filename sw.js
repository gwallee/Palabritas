/* Palabritas service worker — makes the app work fully offline */
const CACHE = 'palabritas-v19';
// AI word pictures live in their own cache that deploys DON'T wipe (v2.1) —
// they're keyed by URL and never change. Capped so it can't grow forever.
const IMG_CACHE = 'palabritas-img';
const IMG_MAX = 400;
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './syllables.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './lists.json',
];

self.addEventListener('install', e => {
  // no-cache: don't let a stale HTTP/CDN copy get baked into a new version's precache
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'no-cache' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== IMG_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function trimImages(c) {
  return c.keys().then(keys => Promise.all(
    keys.slice(0, Math.max(0, keys.length - IMG_MAX)).map(k => c.delete(k))));   // oldest first
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // AI word-picture images (from the in-app "Generate pictures" button) are
  // hotlinked from Pollinations.ai, not vendored — cache-first once fetched so
  // a word seen before still shows offline. Never-cached ones fall back to emoji.
  // The app loads them with crossOrigin='anonymous' (Pollinations sends
  // Access-Control-Allow-Origin: *), so responses are real CORS responses with
  // resp.ok — the old no-cors loads were opaque (ok=false) and never cached.
  if (url.hostname === 'image.pollinations.ai') {
    e.respondWith(
      caches.open(IMG_CACHE).then(c => c.match(e.request.url).then(cached => cached || fetch(e.request).then(resp => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          e.waitUntil(c.put(e.request.url, copy).then(() => trimImages(c)));
        }
        return resp;
      })))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

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
