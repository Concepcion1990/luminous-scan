/**
 * Service worker — T6 (offline-first sync, app-shell part).
 *
 * The app SHELL (HTML, JS, CSS, icons) is cached so the Scan page
 * still opens with no connection; the offline QUEUE (IndexedDB) holds
 * the work, and the sync endpoint confirms it later. The worker never
 * touches API traffic: every /api request goes to the network, and a
 * failed POST is a failed POST — never a cached answer pretending to
 * be a confirmation. GETs to the app shell are cache-first with a
 * network refresh in the background, so a new deploy still reaches
 * the phone on its next visit.
 *
 * Scope note: the icons referenced by the manifest do not exist yet
 * (no icon files ship in T6) — the manifest lists them so the
 * installable shell is complete once the artwork lands; a missing
 * icon file does not block the worker or the queue.
 */
const CACHE = 'luminous-stockhaven-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // API traffic and all non-GETs always go to the network. A queued
  // change must never be answered from a cache.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/')) return;
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
