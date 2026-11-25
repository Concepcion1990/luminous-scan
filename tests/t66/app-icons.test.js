/**
 * The app-icon batch (Nov 24, 2026) — a fresh install wears the
 * globe (diagnosis ~/workspace/diagnosis-app-icon/report.md).
 *
 * THE DEFECT: the web app manifest offered the icon ONLY as SVG
 * files, and there was no raster icon anywhere in the app — no
 * PNG icon, no favicon.ico, no apple-touch-icon. Windows
 * shortcut/taskbar icons are raster surfaces and Chromium's
 * Windows install pipeline does not build them from SVG manifest
 * icons; with nothing usable, Chrome generated its fallback
 * letter tile — a white "L" on a dark square — at install time.
 *
 * THE FIX: the manifest and index.html now offer a raster family
 * (PNG 192 + 512, a maskable 512 as its OWN entry, an
 * apple-touch-icon, a real favicon.ico), and the files themselves
 * are emitted at build time by scripts/app-icons.mjs from the PNG
 * masters inside the public SVG wrappers — the masters' own bytes
 * for 192/512, honest resizes for the rest. The artwork is never
 * redrawn; only the formats were missing.
 *
 * WHAT IS PROVEN WHERE: the wiring is pinned here by source (the
 * manifest entries, the head links, the build plugin), and the
 * emitted files are proven BY EXECUTION — the generator runs into
 * a scratch dir and every file is read back: PNG signatures and
 * IHDR dimensions, the masters byte-for-byte, the maskable's
 * cream padding band, the ICO directory and its payload headers.
 * Nothing here trusts a build log. Whether a given OS swaps an
 * ALREADY-installed shortcut's icon is a platform fact, not
 * provable headlessly: existing installs pick the globe up on
 * uninstall/reinstall, and that by-hand walk joins the owner's
 * combined hand-test pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateAppIcons,
  extractMasterPng,
  decodePng,
  pngInfo,
  icoInfo,
} from '../../scripts/app-icons.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');
const manifest = JSON.parse(read('public/manifest.webmanifest'));
const html = read('index.html');
const viteConfig = read('vite.config.js');

const emitted = (() => {
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'app-icons-'));
  const names = generateAppIcons({ publicDir: path.join(repoRoot, 'public'), outDir });
  return { outDir, names };
})();
const emittedBytes = (name) => readFileSync(path.join(emitted.outDir, name));

test('manifest: PNG icons are offered at 192 and 512', () => {
  const png = manifest.icons.filter((i) => i.type === 'image/png' && !i.purpose);
  assert.deepEqual(
    png.map((i) => [i.src, i.sizes]).sort(),
    [
      ['/icon-192.png', '192x192'],
      ['/icon-512.png', '512x512'],
    ],
  );
});

test('manifest: the maskable icon is its own entry, never combined with any', () => {
  const maskable = manifest.icons.filter((i) => i.purpose === 'maskable');
  assert.equal(maskable.length, 1);
  assert.equal(maskable[0].src, '/icon-maskable-512.png');
  assert.equal(maskable[0].sizes, '512x512');
  assert.equal(maskable[0].type, 'image/png');
  // No entry mixes purposes ('maskable any' would be a spec violation).
  for (const icon of manifest.icons) {
    if (icon.purpose) assert.equal(icon.purpose, 'maskable');
  }
});

test('manifest: the SVG entries stay as an extra offering, not the only one', () => {
  const svg = manifest.icons.filter((i) => i.type === 'image/svg+xml');
  assert.deepEqual(svg.map((i) => i.src).sort(), ['/icon-192.svg', '/icon-512.svg']);
});

test('head: apple-touch-icon, PNG icons and a real favicon are linked', () => {
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png" \/>/);
  assert.match(html, /<link rel="icon" type="image\/png" sizes="192x192" href="\/icon-192\.png" \/>/);
  assert.match(html, /<link rel="icon" type="image\/png" sizes="512x512" href="\/icon-512\.png" \/>/);
  assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="any" \/>/);
});

test('build: vite emits the raster family from the masters at build time', () => {
  assert.match(viteConfig, /emitAppIcons/);
  assert.match(viteConfig, /generateAppIcons/);
  assert.match(viteConfig, /from '\.\/scripts\/app-icons\.mjs'/);
});

test('emission: the whole family is written', () => {
  assert.deepEqual(
    [...emitted.names].sort(),
    ['apple-touch-icon.png', 'favicon.ico', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
  );
  for (const name of emitted.names) assert.ok(existsSync(path.join(emitted.outDir, name)), name);
});

test('emission: icon-192.png and icon-512.png are the masters byte-for-byte', () => {
  const master192 = extractMasterPng(read('public/icon-192.svg'));
  const master512 = extractMasterPng(read('public/icon-512.svg'));
  assert.ok(emittedBytes('icon-192.png').equals(master192), 'the 192 artwork is unchanged');
  assert.ok(emittedBytes('icon-512.png').equals(master512), 'the 512 artwork is unchanged');
});

test('emission: every PNG carries a real header at its declared size', () => {
  const expected = {
    'icon-192.png': 192,
    'icon-512.png': 512,
    'icon-maskable-512.png': 512,
    'apple-touch-icon.png': 180,
  };
  for (const [name, size] of Object.entries(expected)) {
    const info = pngInfo(emittedBytes(name));
    assert.equal(info.width, size, `${name} width`);
    assert.equal(info.height, size, `${name} height`);
    assert.equal(info.bitDepth, 8, `${name} bit depth`);
    assert.equal(info.colorType, 2, `${name} is RGB`);
    // And it fully decodes — a header alone is not a picture.
    const decoded = decodePng(emittedBytes(name));
    assert.equal(decoded.width, size, `${name} decodes`);
    assert.equal(decoded.pixels.length, size * size * 3, `${name} pixel count`);
  }
});

test('emission: the maskable pads the globe inside the safe zone on the master cream', () => {
  const master = decodePng(extractMasterPng(read('public/icon-512.svg')));
  const maskable = decodePng(emittedBytes('icon-maskable-512.png'));
  const px = (img, x, y) => {
    const i = (y * img.width + x) * 3;
    return [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]];
  };
  // The padding band (inside the outer 10%) is the master's own
  // corner cream, untouched — a shape mask cropping there loses
  // nothing but background.
  assert.deepEqual(px(maskable, 5, 5), px(master, 5, 5));
  assert.deepEqual(px(maskable, 256, 10), px(master, 5, 5));
  assert.deepEqual(px(maskable, 10, 256), px(master, 5, 5));
  // The center of the maskable is the center of the master —
  // the globe itself, carried through the resize.
  assert.deepEqual(px(maskable, 256, 256), px(master, 256, 256));
});

test('emission: favicon.ico is a real ICO whose payloads are PNGs at 16/32/48', () => {
  const ico = emittedBytes('favicon.ico');
  const entries = icoInfo(ico);
  assert.deepEqual(entries.map((e) => e.width), [16, 32, 48]);
  for (const entry of entries) {
    assert.equal(entry.height, entry.width);
    const info = pngInfo(ico.subarray(entry.offset, entry.offset + entry.bytesInRes));
    assert.equal(info.width, entry.width, `ICO ${entry.width} payload is a ${entry.width}px PNG`);
    assert.equal(info.height, entry.height);
  }
});
