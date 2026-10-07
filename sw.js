// Niogen Tracker service worker: keeps the app working offline.
// Files are served from the cache first and refreshed in the background, so a
// change you upload shows up the second time the app opens. Bump VERSION when
// you add or rename files so the new list is cached right away.
const VERSION = 'v1';
const CACHE = `niogen-${VERSION}`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/state.js', 'js/ui.js', 'js/db.js', 'js/pricing.js', 'js/backup.js', 'js/theme.js',
  'js/views/radios.js', 'js/views/radio.js', 'js/views/inventory.js', 'js/views/reports.js', 'js/views/settings.js',
  'js/vendor/dexie.min.mjs',
  'fonts/bevan-latin-400-normal.woff2', 'fonts/barlow-latin-400-normal.woff2', 'fonts/barlow-latin-500-normal.woff2',
  'fonts/barlow-latin-600-normal.woff2', 'fonts/ibm-plex-mono-latin-500-normal.woff2',
  'icons/favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('niogen-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { fresh.catch(() => {}); return hit; }
    return (await fresh) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  })());
});
