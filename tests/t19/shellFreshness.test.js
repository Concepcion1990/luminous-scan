/**
 * T19 — design-polish technical pass (2026-11-13): shell freshness,
 * the signed-out landing, and cold-hit waiting.
 *
 * Three defects from Concepcion's phone session on 2026-11-12:
 *
 * 1. STALE SHELL. The service worker's cache name was a fixed
 *    'luminous-stockhaven-shell-v1' and navigations were cache-first
 *    (stale-while-revalidate): the first visit after a deploy always
 *    rendered the previous build, so the login-loop fix — live on the
 *    server — looked broken on her phone. express.static also sent
 *    the shell and sw.js with no Cache-Control at all. Now the cache
 *    name carries a per-build stamp, navigations are network-first,
 *    and the server marks shell/sw.js/manifest no-cache while the
 *    fingerprinted /assets are immutable.
 *
 * 2. COLD-START WOBBLE. The shell rendered ONLY a spinner while the
 *    session check (and the public-settings flag chained behind it)
 *    resolved — for every route, public pages included — so a
 *    signed-out landing depended on the whole chain's timing. The
 *    gate is now the pure shellShouldWait decision: public and auth
 *    pages render immediately; "/" and the protected pages keep
 *    waiting for the session, exactly as before (t9's semantics).
 *
 * 3. SPINNER TIME. The only network wait in the twin's bootstrap is
 *    GET /api/auth/me (getPublicSettings is a local stub — see
 *    src/api/client.js); after this pass it gates only the routes
 *    whose destination is the session's answer.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { base, close } from './helpers.js';
import { shellShouldWait } from '../../src/lib/authReturnTo.js';

after(close);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

/* ---------------- 1. Service worker freshness ---------------- */

test('sw: the cache name carries the build-stamp marker, stamped by the vite plugin', () => {
  const sw = read('public/sw.js');
  assert.match(sw, /const CACHE = 'luminous-stockhaven-shell-__SW_VERSION__'/);
  // No recycled fixed version name — that was the stale-shell bug.
  assert.doesNotMatch(sw, /luminous-stockhaven-shell-v1/);
  const config = read('vite.config.js');
  assert.match(config, /stamp-service-worker/);
  assert.match(config, /__SW_VERSION__/);
  assert.match(config, /createHash\('sha256'\)/);
  assert.match(config, /dist', 'sw\.js'|dist\/sw\.js/);
});

test('sw: the built worker is stamped (no marker survives a build)', { skip: !existsSync(path.join(root, 'dist', 'sw.js')) && 'dist/sw.js not built' }, () => {
  const built = read('dist/sw.js');
  assert.doesNotMatch(built, /__SW_VERSION__/);
  assert.match(built, /luminous-stockhaven-shell-[0-9a-f]{12}/);
});

test('sw: navigations are network-first, the cached shell only the offline fallback', () => {
  const sw = read('public/sw.js');
  assert.match(sw, /request\.mode === 'navigate'/);
  assert.match(sw, /event\.respondWith\(networkFirstNavigation\(request\)\)/);
  // Inside the navigation handler the network is tried BEFORE any
  // cache read — a cache-first handler would match the cache first.
  const handler = sw.slice(sw.indexOf('async function networkFirstNavigation'), sw.indexOf('self.addEventListener(\'fetch\''));
  assert.ok(handler.indexOf('await fetch(request)') > -1, 'navigation handler must fetch');
  assert.ok(handler.indexOf('await fetch(request)') < handler.indexOf("cache.match('/index.html')"), 'fetch must come before the cache fallback');
});

test('sw: fingerprinted assets stay cache-first, and activation purges old caches', () => {
  const sw = read('public/sw.js');
  assert.match(sw, /url\.pathname\.startsWith\('\/assets\/'\)/);
  assert.match(sw, /event\.respondWith\(cacheFirstAsset\(request\)\)/);
  // A new build's worker deletes every cache but its own, then takes
  // control — the takeover that strands nobody on the old shell.
  assert.match(sw, /keys\.filter\(\(key\) => key !== CACHE\)\.map\(\(key\) => caches\.delete\(key\)\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  // Nothing force-reloads an open tab: the worker never posts a
  // reload command and the registration never reloads the page — an
  // update lands on the next navigation, not mid-typing.
  assert.doesNotMatch(sw, /location\.reload/);
  assert.doesNotMatch(read('src/main.jsx'), /location\.reload/);
});

test('server: shell, sw.js and manifest revalidate; fingerprinted assets are immutable', async () => {
  const swRes = await fetch(`${base}/sw.js`);
  assert.equal(swRes.status, 200);
  assert.match(swRes.headers.get('cache-control') || '', /no-cache/);

  const shellRes = await fetch(`${base}/`);
  assert.equal(shellRes.status, 200);
  assert.match(shellRes.headers.get('cache-control') || '', /no-cache/);

  // An SPA deep link hits the fallback — same no-cache shell.
  const spaRes = await fetch(`${base}/welcome`);
  assert.equal(spaRes.status, 200);
  assert.match(spaRes.headers.get('cache-control') || '', /no-cache/);

  const manifestRes = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifestRes.status, 200);
  assert.match(manifestRes.headers.get('cache-control') || '', /no-cache/);

  const assetsDir = path.join(root, 'dist', 'assets');
  assert.ok(existsSync(assetsDir), 'dist/assets must exist (run the build)');
  const asset = readdirSync(assetsDir).find((name) => name.endsWith('.js'));
  assert.ok(asset, 'a built JS asset must exist');
  const assetRes = await fetch(`${base}/assets/${asset}`);
  assert.equal(assetRes.status, 200);
  const cc = assetRes.headers.get('cache-control') || '';
  assert.match(cc, /max-age=31536000/);
  assert.match(cc, /immutable/);
});

test('server: the header rules live in the static + fallback wiring', () => {
  const app = read('server/app.js');
  assert.match(app, /express\.static\(DIST_DIR, \{\s*setHeaders/);
  assert.match(app, /max-age=31536000, immutable/);
  assert.match(app, /filePath\.endsWith\('sw\.js'\)/);
  // The SPA fallback sets no-cache on its sendFile too.
  assert.match(app, /res\.setHeader\('Cache-Control', 'no-cache'\);\s*res\.sendFile/);
});

/* ---------------- 2 + 3. The shell gate ---------------- */

test('gate: public and auth pages never wait for the session check', () => {
  // Every public route class (Welcome, Plans, Subscribe, About, the
  // policy pages, Thank You) — App.jsx computes openToEveryone for
  // exactly these pathnames, pinned by the t1 policy tests.
  for (const isLoadingAuth of [true, false]) {
    assert.equal(shellShouldWait({ openToEveryone: true, authPage: false, isLoadingAuth }), false);
    assert.equal(shellShouldWait({ openToEveryone: false, authPage: true, isLoadingAuth }), false);
    assert.equal(shellShouldWait({ openToEveryone: true, authPage: true, isLoadingAuth }), false);
  }
});

test('gate: "/" and the protected pages wait for the session, and only for it', () => {
  // "/" is neither public nor an auth page: its destination IS the
  // session's answer (Dashboard vs the /welcome landing), so it waits
  // while the check runs and renders the moment it resolves — the
  // cold-start wobble cannot route it anywhere else in between.
  assert.equal(shellShouldWait({ openToEveryone: false, authPage: false, isLoadingAuth: true }), true);
  assert.equal(shellShouldWait({ openToEveryone: false, authPage: false, isLoadingAuth: false }), false);
  // A slow or failed public-settings load plays no part in the
  // decision at all — the helper has no such input.
  assert.equal(shellShouldWait.length, 1);
  assert.doesNotMatch(read('src/lib/authReturnTo.js'), /shellShouldWait[\s\S]{0,400}isLoadingPublicSettings/);
});

test('gate: App.jsx routes its spinner through shellShouldWait, settings flag excluded', () => {
  const app = read('src/App.jsx');
  assert.match(app, /import \{ shellShouldWait \} from '\.\/lib\/authReturnTo';/);
  assert.match(app, /if \(shellShouldWait\(\{ openToEveryone, authPage, isLoadingAuth \}\)\) \{/);
  // The old every-route gate is gone, in both its halves.
  assert.doesNotMatch(app, /isLoadingPublicSettings \|\| isLoadingAuth/);
  assert.doesNotMatch(app, /isLoadingPublicSettings/);
  // The route table itself is untouched by the gate change: built
  // once, returned after the checks.
  assert.match(app, /const routes = \(\s*<Routes>/);
  assert.match(app, /return routes;\s*\};/);
});

test('bootstrap: the settings flag clears when the settings call settles, before the session check', () => {
  const ctx = read('src/lib/AuthContext.jsx');
  const settled = ctx.indexOf('setIsLoadingPublicSettings(false)');
  const sessionCheck = ctx.indexOf('await checkUserAuth()');
  assert.ok(settled > -1 && sessionCheck > -1);
  assert.ok(settled < sessionCheck, 'settings loading must not stay chained behind the session check');
});
