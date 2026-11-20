// Field scanners (owner ruling, Nov 19, 2026): the product
// form's SKU and ISBN fields carry their own scanner buttons.
// The SKU button opens the same in-form barcode scanner as the
// UPC/barcode/QR fields; the ISBN button opens the digits
// reader, which fills the field ONLY with an ISBN whose check
// digit passed. These pins hold the wiring in place; the OCR
// behaviour itself is proven in the browser harness.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '../..', rel), 'utf8');

const form = read('src/components/products/ProductFormDialog.jsx');
const reader = read('src/components/scan/IsbnReader.jsx');
const ocr = read('src/lib/isbnOcr.js');

describe('product form field scanners', () => {
  it('the SKU field has a scan button on the shared in-form scanner', () => {
    assert.match(form, /openCodeScanner\('sku'\)/);
    assert.match(form, /codeTaken\?\.field === 'sku'/);
  });

  it('the ISBN field has a button that opens the digits reader overlay', () => {
    assert.match(form, /setIsbnReaderOpen\(true\)/);
    assert.match(form, /<IsbnReader onFill=\{handleIsbnFill\} \/>/);
    assert.match(form, /productForm\.readIsbnTitle/);
  });

  it('a digits-reader fill lands through the shared code-field funnel', () => {
    assert.match(form, /fillCodeField\('isbn', isbn\)/);
  });

  it('the reader fills only through the checksum gate', () => {
    assert.match(reader, /extractIsbn/);
    assert.match(reader, /found\.valid/);
    assert.match(reader, /readIsbnFromImage/);
    // The refusal is shown in the overlay and the field is
    // never touched on a failed read.
    assert.match(reader, /productForm\.readIsbnFailed/);
    assert.match(reader, /setFailed\(true\)/);
  });

  it('the reader also accepts a barcode that yields a valid ISBN', () => {
    assert.match(reader, /createCodeReader/);
  });

  it('the OCR engine is lazy and fenced to digits + X on one line', () => {
    assert.match(ocr, /script\.src = '\/ocr-assets\/tesseract\.min\.js'/);
    assert.match(ocr, /tessedit_char_whitelist: '0123456789X'/);
    assert.match(ocr, /PSM\.SINGLE_LINE/);
    assert.match(ocr, /workerPath: '\/ocr-assets\/worker\.min\.js'/);
    assert.match(ocr, /corePath: '\/ocr-assets'/);
    assert.match(ocr, /langPath: '\/ocr-assets'/);
    // The engine's answer still passes through the checksum.
    assert.match(ocr, /extractIsbn\(data\?\.text \|\| ''\)/);
  });

  it('nothing in the build references a subscriptions page', () => {
    for (const src of [form, reader, ocr]) {
      assert.ok(!/ubscription/i.test(src));
    }
  });
});
