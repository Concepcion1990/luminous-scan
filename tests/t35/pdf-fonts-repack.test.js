/**
 * Leftovers sweep, item 4 REPACKAGE (Nov 15, 2026): the embedded
 * print fonts ship as base64 TEXT chunks (the publish route
 * carries UTF-8 text only), and font loading is fail-soft — a
 * missing or corrupt font degrades to the per-string English
 * fallback instead of failing a print request.
 *
 * Pins:
 *  - every font's decoded bytes are sha256-identical to the
 *    original TTF (the manifest was generated from the originals
 *    and verified against them at repackage time);
 *  - server/fonts/ carries text only, every chunk ≤ ~1.2 MiB;
 *  - with the fonts directory gone (child process), an Arabic
 *    print request still succeeds and labels fall back to English;
 *  - with a tampered manifest hash (child process), the affected
 *    font is unavailable and its labels fall back too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fontBase64, fontAvailable } from '../../server/printFonts.js';

const FONTS_DIR = fileURLToPath(new URL('../../server/fonts/', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(FONTS_DIR, 'manifest.json'), 'utf8'));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

test('repackage: decoded font bytes are sha256-identical to the original TTFs', () => {
  const keys = Object.keys(manifest.fonts);
  assert.equal(keys.length, 13, 'manifest covers all 13 print fonts');
  for (const key of keys) {
    const entry = manifest.fonts[key];
    const b64 = fontBase64(key);
    assert.ok(b64, `${key}: font loads`);
    const decoded = Buffer.from(b64, 'base64');
    assert.equal(decoded.length, entry.bytes, `${key}: byte length matches the original`);
    assert.equal(sha256(decoded), entry.sha256, `${key}: sha256 matches the original TTF`);
    assert.equal(fontAvailable(key), true, `${key}: available`);
    // The chunks on disk, joined + decoded independently, agree.
    const joined = entry.chunks
      .map((name) => fs.readFileSync(path.join(FONTS_DIR, name), 'utf8'))
      .join('')
      .replace(/\s+/g, '');
    assert.equal(sha256(Buffer.from(joined, 'base64')), entry.sha256, `${key}: chunk files decode to the original`);
  }
});

test('repackage: server/fonts carries text only, chunks within the part cap', () => {
  const names = fs.readdirSync(FONTS_DIR);
  assert.ok(!names.some((n) => n.endsWith('.ttf')), 'no binary TTFs remain in the tree');
  for (const name of names) {
    const buf = fs.readFileSync(path.join(FONTS_DIR, name));
    assert.ok(buf.length <= 1_300_000, `${name}: ${buf.length} bytes exceeds the snapshot part budget`);
    assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(buf).length > 0, true, `${name}: valid UTF-8 text`);
  }
});

// Runs a scenario in a fresh node process with SH_PRINT_FONTS_DIR
// pointed elsewhere: the loader's caches are per-process, so the
// degradation can only be proven honestly in a child.
function runChild(fontsDir) {
  const script = `
    import { fontAvailable, isPrintRenderable } from '${path.join(FONTS_DIR, '..', 'printFonts.js').replace(/\\/g, '/')}';
    import { printLabelsFor } from '${path.join(FONTS_DIR, '..', 'printLabels.js').replace(/\\/g, '/')}';
    import { buildLabelsPdf, buildPoPdf } from '${path.join(FONTS_DIR, '..', 'printPdf.js').replace(/\\/g, '/')}';
    const out = {};
    out.arabicAvailable = fontAvailable('arabic');
    out.arabicLabelRenderable = isPrintRenderable('ملصقات');
    out.arabicPackingSlip = printLabelsFor('ar').packingSlip;
    const items = [{ name: 'دفتر ملاحظات', price: 10, sku: 'NB-1', barcode: '123456789012' }];
    const labels = buildLabelsPdf(items, { businessName: 'متجر', language: 'ar' });
    out.labelsPdf = labels.subarray(0, 5).toString();
    const po = buildPoPdf(
      { number: 'PO-1', supplier_name: 'مورد', order_date: '2026-11-15', status: 'ordered', lines: [{ product_name: 'دفتر', qty_ordered: 2, unit_cost: 5 }], subtotal: 10, total: 10 },
      { name: 'متجر', language: 'ar', currency: 'USD' },
    );
    out.poPdf = po.subarray(0, 5).toString();
    console.log(JSON.stringify(out));
  `;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-fonts-child-'));
  const file = path.join(tmp, 'child.mjs');
  fs.writeFileSync(file, script);
  const stdout = execFileSync(process.execPath, [file], {
    env: { ...process.env, SH_PRINT_FONTS_DIR: fontsDir },
    encoding: 'utf8',
    timeout: 60000,
  });
  return JSON.parse(stdout.trim().split('\n').pop());
}

test('fail-soft: fonts directory missing -> print succeeds, labels fall back to English', () => {
  const out = runChild('/nonexistent/sh-fonts-dir');
  assert.equal(out.arabicAvailable, false);
  assert.equal(out.arabicLabelRenderable, false);
  assert.equal(out.arabicPackingSlip, 'Packing slip', 'Arabic label degrades to the English fallback');
  assert.equal(out.labelsPdf, '%PDF-', 'labels PDF still builds');
  assert.equal(out.poPdf, '%PDF-', 'PO PDF still builds');
});

test('fail-soft: tampered manifest hash -> that font is unavailable, labels fall back', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-fonts-tampered-'));
  const tampered = JSON.parse(JSON.stringify(manifest));
  tampered.fonts.arabic.sha256 = '0'.repeat(64);
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(tampered));
  for (const name of fs.readdirSync(FONTS_DIR).filter((n) => n.includes('.b64.'))) {
    fs.copyFileSync(path.join(FONTS_DIR, name), path.join(tmp, name));
  }
  const out = runChild(tmp);
  assert.equal(out.arabicAvailable, false, 'hash mismatch makes the font unavailable');
  assert.equal(out.arabicPackingSlip, 'Packing slip');
  assert.equal(out.labelsPdf, '%PDF-');
  assert.equal(out.poPdf, '%PDF-');
});
