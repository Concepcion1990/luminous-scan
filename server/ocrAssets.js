/**
 * OCR assets for the ISBN digits reader (owner ruling, Nov 19,
 * 2026): the product form's ISBN button reads the PRINTED digits
 * of an ISBN with tesseract.js in the browser. The engine's
 * API script, worker script, two LSTM core builds and the
 * English digit language data are served from the app's own
 * origin under
 * /ocr-assets/ — no CDN, and nothing is fetched until a person
 * taps the button.
 *
 * Delivery form (the server/fonts pattern): the binary payloads
 * ship as base64 text chunks in server/ocrassets/ beside a
 * manifest.json recording each payload's byte length and sha256,
 * because the publish route carries UTF-8 text only. Loading
 * joins the chunks and verifies the decoded bytes against the
 * manifest. FAIL-SOFT, like the print fonts: a missing or
 * corrupt payload is simply unavailable — its route answers 404
 * and the ISBN reader degrades to its plain try-again-or-type
 * message. Asset loading never throws into the app.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ocrassets');

// The names the ISBN reader asks for, by served file name. The
// API script and the worker script are plain JavaScript text and
// ship as themselves; corePath is the /ocr-assets directory
// itself — the worker appends the core file name for the
// visitor's browser (SIMD when supported, plain LSTM otherwise;
// the app always runs the LSTM-only engine, so those are the
// two cores kept).
const SERVED = new Map([
  ['tesseract.min.js', { kind: 'plain', type: 'text/javascript; charset=utf-8' }],
  ['worker.min.js', { kind: 'plain', type: 'text/javascript; charset=utf-8' }],
  ['tesseract-core-simd-lstm.wasm.js', { kind: 'chunked', base: 'core-simd-lstm', type: 'text/javascript; charset=utf-8' }],
  ['tesseract-core-lstm.wasm.js', { kind: 'chunked', base: 'core-lstm', type: 'text/javascript; charset=utf-8' }],
  ['eng.traineddata.gz', { kind: 'chunked', base: 'eng-traineddata', type: 'application/gzip' }],
]);

let manifestCache = null;
function manifest() {
  if (manifestCache) return manifestCache;
  try {
    manifestCache = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'manifest.json'), 'utf8'));
  } catch {
    manifestCache = { assets: {} };
  }
  return manifestCache;
}

const bufferCache = new Map();

/**
 * The decoded bytes of one served asset, verified against the
 * manifest (byte length + sha256), or null when the asset is
 * missing or fails verification. Exported for tests.
 */
export function loadOcrAssetBuffer(servedName) {
  const spec = SERVED.get(servedName);
  if (!spec) return null;
  if (bufferCache.has(servedName)) return bufferCache.get(servedName);
  let buf = null;
  try {
    if (spec.kind === 'plain') {
      const raw = fs.readFileSync(path.join(ASSETS_DIR, servedName));
      const want = manifest().plain?.[servedName];
      if (want && raw.length === want.bytes
        && crypto.createHash('sha256').update(raw).digest('hex') === want.sha256) {
        buf = raw;
      }
    } else {
      const entry = manifest().assets?.[spec.base];
      if (entry && entry.file === servedName && Array.isArray(entry.chunks)) {
        const joined = entry.chunks
          .map((name) => fs.readFileSync(path.join(ASSETS_DIR, name), 'utf8'))
          .join('')
          .replace(/\s+/g, '');
        const decoded = Buffer.from(joined, 'base64');
        if (decoded.length === entry.bytes
          && crypto.createHash('sha256').update(decoded).digest('hex') === entry.sha256) {
          buf = decoded;
        }
      }
    }
  } catch {
    buf = null;
  }
  bufferCache.set(servedName, buf);
  return buf;
}

/**
 * Express handler for GET /ocr-assets/<name>. Mounted before the
 * static dist serving so the SPA fallback never sees these.
 * The assets are version-locked library files (they change only
 * when the shipped tesseract.js version changes), so a day of
 * HTTP caching keeps repeat ISBN reads fast without stranding a
 * phone on a stale engine across deploys.
 */
export function ocrAssetsHandler(req, res) {
  const name = decodeURIComponent(String(req.params?.name || ''));
  const spec = SERVED.get(name);
  if (!spec) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const buf = loadOcrAssetBuffer(name);
  if (!buf) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.setHeader('Content-Type', spec.type);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Length', buf.length);
  res.end(buf);
}
