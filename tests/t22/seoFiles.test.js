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
import {
  SEO_ROUTES,
  buildPrerenderedHtml,
  buildSeoJsonLd,
  serializeSeoJsonLd,
  seoCanonicalUrl,
} from '../../src/lib/seo.js';
import { PLANS, TRIAL_DAYS, formatPrice } from '../../src/lib/plans.js';
import { SOCIAL_LINKS } from '../../src/lib/socialLinks.js';
import { ABOUT_FOUNDER } from '../../src/lib/aboutFounder.js';

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

/* ---------------- Prerendered public pages + JSON-LD (Nov 19, 2026) ----------------
 * Her ruling: the features and subscription fees must be findable
 * and explained exactly as they are on every search engine. The
 * public pages are now baked to static HTML at build time from the
 * same modules the app renders from, and the marketing pages carry
 * JSON-LD whose prices are READ from plans.js — change a price
 * there and the schema changes with it. */

test('seo: the prerender route list is exactly the public marketing + legal pages', () => {
  assert.deepEqual(
    SEO_ROUTES.map((route) => route.path),
    ['/', '/welcome', '/plans', '/about', '/terms-of-service', '/subscription-policy', '/privacy-policy'],
  );
  // The app flows stay on the plain shell: per-visitor forms, not copy.
  assert.ok(!SEO_ROUTES.some((route) => ['/login', '/register', '/subscribe'].includes(route.path)));
});

test('seo: JSON-LD parses, and its offer prices ARE the plans.js prices', () => {
  const parsed = JSON.parse(serializeSeoJsonLd('/plans'));
  const app = parsed['@graph'].find((node) => node['@type'] === 'SoftwareApplication');
  assert.ok(app, 'a SoftwareApplication node exists');
  assert.equal(app.name, 'Luminous StockHaven');
  assert.equal(app.applicationCategory, 'BusinessApplication');
  assert.equal(app.operatingSystem, 'Web');
  const catalog = app.offers;
  assert.equal(catalog['@type'], 'OfferCatalog');
  const offers = catalog.itemListElement;
  assert.equal(offers.length, 2, 'exactly the two sellable website plans');
  assert.equal(offers[0].price, PLANS.essentials.price.toFixed(2), 'Essentials price read from plans.js');
  assert.equal(offers[1].price, PLANS.business.price.toFixed(2), 'Business price read from plans.js');
  assert.ok(offers.every((offer) => offer.priceCurrency === 'USD'));
  // The trial is a plain honest sentence, never a fake $0 offer.
  assert.ok(offers.every((offer) => offer.description.includes(`${TRIAL_DAYS}-day free trial`)));
  assert.ok(offers.every((offer) => offer.price !== '0.00' && offer.price !== '0'));
});

test('seo: JSON-LD never advertises the not-yet-sellable Mobile plan', () => {
  const serialized = serializeSeoJsonLd('/plans');
  // A bare '4.99' substring check would false-positive on $14.99 —
  // the pins are the standalone price forms Mobile would take.
  assert.ok(!serialized.includes('"price":"4.99"'), 'no $4.99 offer price until Mobile can be bought');
  assert.ok(!serialized.includes('$4.99'), 'no $4.99 price text until Mobile can be bought');
  const parsed = JSON.parse(serialized);
  const app = parsed['@graph'].find((node) => node['@type'] === 'SoftwareApplication');
  assert.ok(!app.offers.itemListElement.some((offer) => /mobile/i.test(offer.name)));
});

test('seo: JSON-LD feature list and organization come from the app modules', () => {
  const parsed = buildSeoJsonLd('/');
  const app = parsed['@graph'].find((node) => node['@type'] === 'SoftwareApplication');
  for (const line of PLANS.essentials.includes) {
    assert.ok(app.featureList.includes(line), `feature list carries the Essentials line: ${line}`);
  }
  // Business extras ride along; its "Everything in Essentials"
  // pointer line is not itself a feature.
  for (const line of PLANS.business.includes.slice(1)) {
    assert.ok(app.featureList.includes(line), `feature list carries the Business extra: ${line}`);
  }
  const org = parsed['@graph'].find((node) => node['@type'] === 'Organization');
  assert.equal(org.name, 'The Luminous Book Shop, LLC');
  assert.deepEqual(org.sameAs, SOCIAL_LINKS.map((link) => link.url), 'sameAs is the socialLinks module, verbatim');
});

test('seo: a prerendered document carries the prices from plans.js, canonical and schema', () => {
  const route = SEO_ROUTES.find((entry) => entry.path === '/plans');
  const bodyHtml = `<main>${PLANS.essentials.includes.map((line) => `<p>${line}</p>`).join('')}`
    + `<p>${formatPrice(PLANS.essentials.price)}</p><p>${formatPrice(PLANS.business.price)}</p></main>`;
  const html = buildPrerenderedHtml({ template: read('index.html'), route, bodyHtml });
  assert.ok(html.includes(formatPrice(PLANS.essentials.price)), 'Essentials price in the static output');
  assert.ok(html.includes(formatPrice(PLANS.business.price)), 'Business price in the static output');
  assert.ok(html.includes(`<link rel="canonical" href="${seoCanonicalUrl('/plans')}" />`));
  assert.ok(!html.includes('<div id="root"></div>'), 'the root is filled, not empty');
  const match = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  assert.ok(match, 'the JSON-LD script is in the head');
  const parsed = JSON.parse(match[1]);
  assert.equal(parsed['@graph'][0].offers.itemListElement[0].price, PLANS.essentials.price.toFixed(2));
});

test('seo: the stale pre-StockHaven scanner page is gone from public/', () => {
  assert.ok(!existsSync(path.join(root, 'public', 'index.html')), 'public/index.html (old Luminous Scan page) must not exist');
});

test('seo: built static pages hold the real content (run the build)', { skip: !existsSync(path.join(root, 'dist', 'plans.html')) && 'dist/plans.html not built' }, () => {
  const plans = read('dist/plans.html');
  assert.ok(plans.includes(formatPrice(PLANS.essentials.price)), 'dist Plans shows the Essentials price as text');
  assert.ok(plans.includes(formatPrice(PLANS.business.price)), 'dist Plans shows the Business price as text');
  for (const line of PLANS.essentials.includes.slice(0, 6)) {
    assert.ok(plans.includes(line), `dist Plans carries the feature line: ${line}`);
  }
  assert.match(plans, /<script type="application\/ld\+json">/);
  const welcome = read('dist/index.html');
  assert.ok(welcome.includes(formatPrice(PLANS.business.price)), 'dist root shows prices as text');
  const about = read('dist/about.html');
  // React's server renderer entity-escapes apostrophes (&#x27;) —
  // every reader, browser and crawler alike, decodes them back to
  // her exact words, so the comparison decodes before comparing.
  const aboutText = about.replaceAll('&#x27;', "'");
  assert.ok(aboutText.includes(ABOUT_FOUNDER.paragraphs[0]), 'dist About carries the founder story, verbatim');
});

test('server: /plans is served prerendered and an unknown route still falls back', async () => {
  const plansRes = await fetch(`${base}/plans`);
  assert.equal(plansRes.status, 200);
  const plansBody = await plansRes.text();
  assert.ok(plansBody.includes(formatPrice(PLANS.essentials.price)), 'served /plans has the price in raw HTML');
  assert.ok(plansBody.includes('application/ld+json'), 'served /plans carries the JSON-LD');
  assert.match(plansRes.headers.get('cache-control') || '', /no-cache/);

  const missRes = await fetch(`${base}/no-such-page-here`);
  assert.equal(missRes.status, 200, 'unknown routes keep the SPA fallback');
  const missBody = await missRes.text();
  assert.ok(missBody.includes('<div id="root">'), 'the fallback still serves the app document');
});
