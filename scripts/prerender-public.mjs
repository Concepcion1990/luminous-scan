/**
 * Prerender the public pages into dist/ (Nov 19, 2026).
 *
 * Runs as the last step of `npm run build`, after the client
 * build (dist/index.html is the shell template) and the SSR
 * build (dist-server/entry-server.js renders the real pages).
 * For each route in src/lib/seo.js's SEO_ROUTES it writes the
 * assembled document — shell head + canonical + JSON-LD +
 * server-rendered body — to dist/<route>.html, where
 * express.static serves it ahead of the SPA fallback.
 *
 * Two environment notes:
 *  - A few client modules touch `window` at import time
 *    (src/lib/utils.js reads window.self), so the globals are
 *    stubbed BEFORE the SSR bundle is imported. Nothing renders
 *    through them; renderToString runs no effects.
 *  - Imported client modules can hold the event loop open
 *    (timers registered at import), so a successful run exits
 *    explicitly instead of waiting for a drain that never comes.
 *
 * Finally the service worker is re-stamped: vite.config.js
 * stamps dist/sw.js from the SHELL's hash during the client
 * build, but the root document changes here — restamping from
 * the prerendered index.html keeps the worker's version honest,
 * so a returning phone installs the new shell on its next visit.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');

globalThis.self = globalThis;
globalThis.window = { self: globalThis, top: globalThis };

try {
  const { renderRoute } = await import('../dist-server/entry-server.js');
  const { SEO_ROUTES, buildPrerenderedHtml } = await import('../src/lib/seo.js');

  const template = await readFile(path.join(distDir, 'index.html'), 'utf8');
  for (const route of SEO_ROUTES) {
    const html = buildPrerenderedHtml({ template, route, bodyHtml: renderRoute(route.path) });
    await writeFile(path.join(distDir, route.outputFile), html);
    console.log(`[prerender] ${route.path} -> dist/${route.outputFile} (${html.length} bytes)`);
  }

  const swPath = path.join(distDir, 'sw.js');
  const sw = await readFile(swPath, 'utf8');
  const stamped = sw.match(/luminous-stockhaven-shell-[a-f0-9]{12}/);
  if (stamped) {
    const indexHtml = await readFile(path.join(distDir, 'index.html'), 'utf8');
    const version = createHash('sha256').update(indexHtml).digest('hex').slice(0, 12);
    await writeFile(swPath, sw.replace(stamped[0], `luminous-stockhaven-shell-${version}`));
    console.log(`[prerender] sw.js re-stamped to ${version}`);
  }
  process.exit(0);
} catch (error) {
  console.error('[prerender] FAILED:', error);
  process.exit(1);
}
