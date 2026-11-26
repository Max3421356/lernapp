/* Lernapp – Offline-Speicher. App-Dateien aus dem Speicher, Inhalte zuerst aus dem Netz (damit Neues ankommt). */
const CACHE = 'lernapp-202611261711';
const MEDIA = 'lernapp-media';
const SHELL = ['./', 'index.html', 'app.css', 'engine.js', 'checker.js', 'ui.js', 'crypto.js', 'textcheck.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-32.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' – sonst kann eine kurz vorher geladene alte Datei im neuen Speicher landen
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
// alte Videos (nicht mehr in meta.json) vom Gerät löschen
async function pruneMedia() {
  try {
    const meta = await (await fetch('data/meta.json', { cache: 'no-store' })).json();
    const keep = new Set(Object.values(meta.videos || {}).map((v) => v.file.split('/').pop()));
    const c = await caches.open(MEDIA);
    for (const req of await c.keys()) if (!keep.has(new URL(req.url).pathname.split('/').pop())) await c.delete(req);
  } catch (e) { /* offline – beim nächsten Mal */ }
}
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== MEDIA).map((k) => caches.delete(k))))
    .then(pruneMedia).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/data/')) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  if (url.pathname.includes('/media/')) {
    e.respondWith(caches.open(MEDIA).then((c) => c.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }))));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
