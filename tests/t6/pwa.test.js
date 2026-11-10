/**
 * T6 — PWA app shell (public/manifest.webmanifest + public/sw.js).
 *
 * The shell is the offline half of the sync story: the Scan page
 * still opens with no connection, the queue holds the work, and the
 * server confirms it later. The worker must NEVER answer API traffic
 * from a cache — a queued change is only confirmed by the server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestPath = path.join(root, 'public', 'manifest.webmanifest');
const swPath = path.join(root, 'public', 'sw.js');

test('the manifest names the app Luminous Stockhaven', () => {
  assert.ok(existsSync(manifestPath), 'manifest.webmanifest is missing');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.name, 'Luminous Stockhaven');
  assert.equal(manifest.short_name, 'Stockhaven');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.theme_color);
});

test('the service worker caches the shell but never API traffic', () => {
  assert.ok(existsSync(swPath), 'sw.js is missing');
  const sw = readFileSync(swPath, 'utf8');
  // Only GETs are considered, and /api + /webhooks always go to the network.
  assert.match(sw, /request\.method !== 'GET'/);
  assert.match(sw, /startsWith\('\/api\/'\)/);
  assert.match(sw, /startsWith\('\/webhooks\/'\)/);
  // The shell is cached for offline opening.
  assert.match(sw, /caches\.open/);
  assert.match(sw, /skipWaiting/);
});

test('the app links the manifest', () => {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /manifest\.webmanifest/);
  const main = readFileSync(path.join(root, 'src', 'main.jsx'), 'utf8');
  assert.match(main, /serviceWorker.*register\('\/sw\.js'\)/);
});
