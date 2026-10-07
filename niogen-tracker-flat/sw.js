// Niogen Tracker service worker: keeps the app working offline.
// Files are served from the cache first and refreshed in the background, so a
// change you upload shows up the second time the app opens. Bump VERSION when
// you add or rename files so the new list is cached right away.
const VERSION = 'v1';
const CACHE = `niogen-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'style.css',
  'app.js',
  'state.js',
  'ui.js',
  'db.js',
  'pricing.js',
  'backup.js',
  'theme.js',
  'radios.js',
  'radio.js',
  'inventory.js',
  'reports.js',
  'settings.js',
  'dexie.min.mjs',
  'bevan-latin-400-normal.woff2',
  'barlow-latin-400-normal.woff2',
  'barlow-latin-500-normal.woff2',
  'barlow-latin-600-normal.woff2',
  'ibm-plex-mono-latin-500-normal.woff2',
  'favicon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
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
