import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Base44 security scan, Nov 6 2026: a stored product photo URL reached an
 * unvalidated link href, so a javascript: URL could execute in the app
 * origin for another workspace member who clicked "Full size". Only
 * http(s) URLs may be linked out, mirroring ListingRow.jsx.
 */
const page = readFileSync('src/components/products/PhotoGallery.jsx', 'utf8');

test('PhotoGallery validates the photo URL scheme before linking out', () => {
  assert.match(page, /\/\^https\?:\\\/\\\/\/i\.test\(current\)/);
});

test('PhotoGallery never renders a raw stored URL as a link href', () => {
  assert.doesNotMatch(page, /href=\{current\}/);
  assert.doesNotMatch(page, /href=\{url\}/);
});

test('PhotoGallery links out only when the URL is safe, otherwise renders a plain container', () => {
  assert.match(page, /const FullSize = safeUrl \? 'a' : 'div'/);
  assert.match(page, /<\/FullSize>/);
});
