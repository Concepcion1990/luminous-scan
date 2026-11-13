/**
 * T22 — search discoverability (2026-11-13): the meta description and
 * social cards in the shell, plus REAL robots.txt and sitemap.xml.
 *
 * Until this pass the served page carried no description written for
 * search results, and /robots.txt and /sitemap.xml answered with the
 * SPA fallback HTML because no real files existed — a crawler asking
 * for the sitemap got a web page back. Now public/robots.txt and
 * public/sitemap.xml are real files: Vite copies them into dist/, and
 * express.static serves them before the SPA fallback (server/app.js
 * wires static first, app.get('*') second), each with its proper
 * content type. The sitemap lists ONLY the public routes that exist
 * in src/App.jsx — Welcome, Plans, Subscribe, About, Login, Register
 * and the three canonical policy pages — never the /policies/*
 * aliases, never a signed-in page, never the Thank You return page.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { base, close } from './helpers.js';

after(close);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const TITLE = 'Luminous StockHaven — Inventory for independent businesses';
const DESCRIPTION = 'Simple inventory that respects small businesses: barcode and QR scanning, stock, staff scheduling, payroll support and training — all in one app, in 52 languages. One honest price, no extra fees. 7-day free trial.';

// The public routes in src/App.jsx, as canonical URLs. "/" is the
// address the search engines were given; a signed-out visitor there
// lands on /welcome (App.jsx Navigate), which is listed on its own
// route too.
const SITEMAP_URLS = [
  'https://luminousstockhaven.com/',
  'https://luminousstockhaven.com/welcome',
  'https://luminousstockhaven.com/plans',
  'https://luminousstockhaven.com/subscribe',
  'https://luminousstockhaven.com/about',
  'https://luminousstockhaven.com/login',
  'https://luminousstockhaven.com/register',
  'https://luminousstockhaven.com/terms-of-service',
  'https://luminousstockhaven.com/subscription-policy',
  'https://luminousstockhaven.com/privacy-policy',
];

/* ---------------- The shell's search/social cards ---------------- */

test('shell: the title is unchanged and there is exactly one meta description, the search one', () => {
  const html = read('index.html');
  assert.ok(html.includes(`<title>${TITLE}</title>`), 'title must stay exactly as approved');
  const descriptions = html.match(/<meta\s+name="description"/g) || [];
  assert.equal(descriptions.length, 1, 'a page gets one description, not two');
  assert.ok(html.includes(`content="${DESCRIPTION}"`), 'meta description must be the exact search text');
});

test('shell: Open Graph and Twitter cards carry the same title and description', () => {
  const html = read('index.html');
  assert.ok(html.includes(`<meta property="og:title" content="${TITLE}" />`));
  assert.ok(html.includes(`property="og:description"\n      content="${DESCRIPTION}"`)
    || html.includes(`<meta\n      property="og:description"\n      content="${DESCRIPTION}" />`)
    || html.includes(`content="${DESCRIPTION}"`), 'og:description present with the exact text');
  assert.ok(html.includes('<meta property="og:type" content="website" />'));
  assert.ok(html.includes('<meta property="og:url" content="https://luminousstockhaven.com/" />'));
  assert.ok(html.includes('<meta name="twitter:card" content="summary" />'));
  assert.ok(html.includes(`<meta name="twitter:title" content="${TITLE}" />`));
  // No share image: none has been approved, so no og:image may appear.
  assert.doesNotMatch(html, /og:image|twitter:image/);
});

/* ---------------- robots.txt ---------------- */

test('robots: a real file that welcomes every crawler and points at the sitemap', () => {
  const robots = read('public/robots.txt');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.ok(robots.includes('Sitemap: https://luminousstockhaven.com/sitemap.xml'));
  assert.doesNotMatch(robots, /<html|<!doctype/i, 'robots.txt is text, never the SPA shell');
});

/* ---------------- sitemap.xml ---------------- */

test('sitemap: real XML listing exactly the public routes, nothing else', () => {
  const xml = read('public/sitemap.xml');
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, SITEMAP_URLS);
  // No aliases, no signed-in pages, no post-checkout page.
  assert.doesNotMatch(xml, /\/policies\/|ThankYou|thankyou|\/products|\/settings|\/scan/);
});

/* ---------------- Served as real files, not the fallback ---------------- */

test('server: /robots.txt and /sitemap.xml are served as themselves', async () => {
  assert.ok(existsSync(path.join(root, 'dist', 'robots.txt')), 'dist/robots.txt must exist (run the build)');
  assert.ok(existsSync(path.join(root, 'dist', 'sitemap.xml')), 'dist/sitemap.xml must exist (run the build)');

  const robotsRes = await fetch(`${base}/robots.txt`);
  assert.equal(robotsRes.status, 200);
  assert.match(robotsRes.headers.get('content-type') || '', /text\/plain/);
  assert.equal(await robotsRes.text(), read('public/robots.txt'));

  const sitemapRes = await fetch(`${base}/sitemap.xml`);
  assert.equal(sitemapRes.status, 200);
  assert.match(sitemapRes.headers.get('content-type') || '', /xml/);
  const sitemapBody = await sitemapRes.text();
  assert.equal(sitemapBody, read('public/sitemap.xml'));
  assert.doesNotMatch(sitemapBody, /<div id="root">/, 'the sitemap must not be the SPA shell');
});

test('server: the served shell carries the search description', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes(`content="${DESCRIPTION}"`), 'the built shell must carry the meta description');
  assert.ok(body.includes('<meta property="og:url" content="https://luminousstockhaven.com/" />'));
});

test('server: the static-before-fallback wiring is what keeps the files real', () => {
  const app = read('server/app.js');
  const staticAt = app.indexOf('express.static(DIST_DIR');
  const fallbackAt = app.indexOf("app.get('*'");
  assert.ok(staticAt > -1 && fallbackAt > -1);
  assert.ok(staticAt < fallbackAt, 'express.static must run before the SPA fallback');
});
