// Service worker: lets ClearPage open and work with no internet.
//  - App files: try the network first (so updates arrive), fall back to the saved copy offline.
//  - Text engine files (large, never change for a given version): saved copy first.
// Your scans are not touched here; they live in IndexedDB.

const CACHE = 'clearpage-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/main.js',
  './js/engine/client.js',
  './js/engine/detect.js',
  './js/engine/filters.js',
  './js/engine/geometry.js',
  './js/engine/render.js',
  './js/engine/warp.js',
  './js/engine/worker.js',
  './js/services/backup.js',
  './js/services/db.js',
  './js/services/events.js',
  './js/services/export.js',
  './js/services/imageio.js',
  './js/services/library.js',
  './js/services/ocr.js',
  './js/services/pdf.js',
  './js/services/render.js',
  './js/services/settings.js',
  './js/services/share.js',
  './js/services/zip.js',
  './js/ui/camera.js',
  './js/ui/crop.js',
  './js/ui/document.js',
  './js/ui/dom.js',
  './js/ui/edit.js',
  './js/ui/exportSheet.js',
  './js/ui/library.js',
  './js/ui/router.js',
  './js/ui/settings.js',
  './js/ui/shared.js',
  './js/ui/text.js',
  './js/ui/theme.js',
  './js/ui/trash.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    // On a weak signal, do not keep the user waiting: use the saved copy after 3 seconds.
    const response = await Promise.race([fetch(request), timeout(3000)]);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // language files are cached by Tesseract itself
  if (url.pathname.includes('/vendor/')) event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request));
});
