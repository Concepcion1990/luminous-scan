// OCR asset delivery (Nov 19, 2026): the tesseract.js payloads
// ship as base64 text chunks (the publish route is text-only)
// and server/ocrAssets.js must decode them back to the exact
// original bytes — verified against the manifest's sha256 — or
// honestly report them unavailable. A single wrong byte would
// hand every phone a broken OCR engine, so the round trip is
// pinned here, next to the barcodeSym server-module tests.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOcrAssetBuffer } from '../../server/ocrAssets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  fs.readFileSync(path.join(here, '../../server/ocrassets/manifest.json'), 'utf8'),
);

describe('OCR assets decode byte-identical to their sources', () => {
  it('the plain scripts verify and load', () => {
    for (const [name, entry] of Object.entries(manifest.plain)) {
      const buf = loadOcrAssetBuffer(name);
      assert.ok(Buffer.isBuffer(buf), `${name} should load`);
      assert.equal(buf.length, entry.bytes);
    }
    assert.deepEqual(Object.keys(manifest.plain).sort(), ['tesseract.min.js', 'worker.min.js']);
  });

  for (const [base, entry] of Object.entries(manifest.assets)) {
    it(`${entry.file} verifies and loads (${entry.bytes} bytes)`, () => {
      const buf = loadOcrAssetBuffer(entry.file);
      assert.ok(Buffer.isBuffer(buf), `${base} should decode`);
      assert.equal(buf.length, entry.bytes);
    });
  }

  it('the two LSTM cores and the language data are the whole set', () => {
    assert.deepEqual(
      Object.values(manifest.assets).map((a) => a.file).sort(),
      ['eng.traineddata.gz', 'tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
    );
  });

  it('unknown asset names are unavailable, never an error', () => {
    assert.equal(loadOcrAssetBuffer('tesseract-core.wasm.js'), null);
    assert.equal(loadOcrAssetBuffer('../server.js'), null);
    assert.equal(loadOcrAssetBuffer(''), null);
  });

  it('every chunk file stays inside the text-push part limit', () => {
    for (const entry of Object.values(manifest.assets)) {
      for (const chunk of entry.chunks) {
        const size = fs.statSync(path.join(here, '../../server/ocrassets', chunk)).size;
        assert.ok(size <= 1330000, `${chunk} is ${size} bytes`);
      }
    }
  });
});
