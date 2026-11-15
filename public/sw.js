// Service Worker der Geräte-Variante: macht die App offline nutzbar.
// Mit Internet kommt immer die neueste Fassung vom Server und landet im Zwischenspeicher,
// ohne Internet wird aus dem Zwischenspeicher geliefert.
// VERSION wird beim Bauen ersetzt, damit alte Zwischenspeicher verschwinden.
const VERSION = 'dev';
const CACHE = `planer-${VERSION}`;
const KERN = ['./', 'index.html', 'style.css', 'app.js', 'logic.js', 'held.js', 'setup.js', 'tipps.js', 'stand.js', 'gamedata.json', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(KERN)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('planer-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // Schriften und Kartenbilder gehen direkt ins Netz
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
