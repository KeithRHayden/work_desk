// Bump CACHE whenever this file changes so old caches are cleared on activate.
const CACHE = 'work-desk-v2';
const ASSETS = [
  '/work_desk/',
  '/work_desk/index.html',
  '/work_desk/manifest.json',
  '/work_desk/icon-192.png',
  '/work_desk/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isPage(request) {
  if (request.mode === 'navigate') return true;
  const path = new URL(request.url).pathname;
  return path === '/work_desk/' || path.endsWith('.html');
}

// Pages: network first (revalidated against GitHub Pages, bypassing the 10-minute HTTP cache),
// so a new deploy shows on the first load. The cached copy is only used offline.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request, { cache: 'no-cache' });
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (_) {
    return (await cache.match(request, { ignoreSearch: true }))
      || (await cache.match('/work_desk/index.html'))
      || Response.error();
  }
}

// Icons/manifest: serve cached, refresh in the background.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const net = fetch(request).then(res => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(isPage(e.request) ? networkFirst(e.request) : staleWhileRevalidate(e.request));
});
