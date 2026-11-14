/**
 * Service worker — T6 (offline-first sync, app-shell part), freshness
 * rework in the design-polish pass (2026-11-13).
 *
 * The app SHELL (HTML, JS, CSS, icons) is cached so the Scan page
 * still opens with no connection; the offline QUEUE (IndexedDB) holds
 * the work, and the sync endpoint confirms it later. The worker never
 * touches API traffic: every /api request goes to the network, and a
 * failed POST is a failed POST — never a cached answer pretending to
 * be a confirmation.
 *
 * Freshness (the 2026-11-12 stale-shell bug: after a deploy, the
 * phone kept rendering the previous build, so a fix that was live
 * looked broken): three rules keep a returning visitor current.
 *
 * 1. The cache name carries a per-build stamp (__SW_VERSION__ is
 *    replaced at build time by the stamp-service-worker plugin in
 *    vite.config.js with a hash of the built index.html). Every
 *    client-affecting deploy therefore installs a NEW worker and the
 *    activate step deletes every older cache — nothing stale survives
 *    under a recycled name. skipWaiting + clients.claim (below) put
 *    the new worker in charge immediately.
 * 2. Navigations are NETWORK-FIRST: when online, the shell document
 *    always comes from the server (which serves it no-cache), and the
 *    cached copy is only the offline fallback. Assets under /assets/
 *    are fingerprinted by the build, so they stay cache-first; a new
 *    deploy names new files, never rewrites these.
 * 3. Nothing force-reloads an open tab. A tab already running keeps
 *    its in-memory copy until its next navigation, which rule 2 makes
 *    fresh — unsaved work in an open form is never thrown away by an
 *    update landing mid-typing.
 *
 * Scope note: the icons referenced by the manifest landed with the
 * globe wiring (Nov 13, 2026) — public/icon-192.svg and
 * public/icon-512.svg are rendered from the official app-icon
 * masters, and public/globe-mark.svg is the header/footer mark.
 * The .svg files wrap the PNG masters as base64 data URIs: the
 * GitHub snapshot push is UTF-8 only, so the globe travels as
 * text and renders byte-identically in the browser.
 */
const CACHE = 'luminous-stockhaven-shell-__SW_VERSION__';
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

// Navigations: the fresh document wins whenever the network answers;
// the cached shell is the offline fallback (under the canonical
// /index.html key every SPA route can share).
async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put('/index.html', response.clone());
    }
    return response;
  } catch {
    return (await cache.match('/index.html')) || (await cache.match(request)) || Response.error();
  }
}

// Fingerprinted build assets: the URL names the content, so a cache
// hit is never stale; a miss goes to the network once and is kept.
async function cacheFirstAsset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

// Everything else same-origin (manifest, future icons): serve the
// cached copy at once and refresh it in the background.
function staleWhileRevalidate(event) {
  const { request } = event;
  return caches.match(request).then((cached) => {
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
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // API traffic and all non-GETs always go to the network. A queued
  // change must never be answered from a cache.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/')) return;
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstAsset(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(event));
});
