/**
 * T35 — the About page's social section (owner's request, Nov 16, 2026).
 *
 * Her four business social links render on the About page, each with
 * a QR code beside it. The QR artwork ships as SVG text (the publish
 * route carries no binary files), generated from src/lib/socialLinks.js
 * by scripts/generate-social-qrs.mjs. This test is the proof the codes
 * are real: it reads each committed SVG back off disk, rasterises the
 * module rects it finds there, and decodes the picture with the same
 * ZXing reader the app's scanner uses — the decoded text must equal
 * the intended URL exactly, character for character.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  QRCodeReader,
  BinaryBitmap,
  HybridBinarizer,
  RGBLuminanceSource,
} from '@zxing/library';
import { SOCIAL_LINKS } from '../../src/lib/socialLinks.js';

const read = (file) => readFileSync(file, 'utf8');

const EXPECTED = [
  ['instagram', 'Instagram', '@the_luminous_book_shop', 'https://www.instagram.com/the_luminous_book_shop'],
  ['facebook', 'Facebook', 'The Luminous Book Shop', 'https://www.facebook.com/share/1C1DuJkVst/'],
  ['threads', 'Threads', '@the_luminous_book_shop', 'https://www.threads.com/@the_luminous_book_shop'],
  ['tiktok', 'TikTok', '@the.luminous.book', 'https://www.tiktok.com/@the.luminous.book'],
];

test('the social link list is exactly her four pages, in her links', () => {
  assert.equal(SOCIAL_LINKS.length, 4);
  assert.deepEqual(
    SOCIAL_LINKS.map((l) => [l.id, l.platform, l.handle, l.url]),
    EXPECTED,
  );
  assert.ok(Object.isFrozen(SOCIAL_LINKS), 'the list is frozen against drift');
});

/** Rasterise a committed QR SVG (unit rects in one path) and decode it. */
function decodeSvgQr(svgText) {
  const sizeMatch = svgText.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(sizeMatch, 'SVG carries a square viewBox');
  const size = Number(sizeMatch[1]);
  assert.equal(Number(sizeMatch[2]), size, 'viewBox is square');
  const dark = new Set();
  for (const m of svgText.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    dark.add(`${Number(m[1])},${Number(m[2])}`);
  }
  assert.ok(dark.size > 100, 'SVG carries a real QR module pattern');
  const scale = 10;
  const width = size * scale;
  const rgb = new Int32Array(width * width).fill(0xffffff);
  for (const key of dark) {
    const [x, y] = key.split(',').map(Number);
    for (let dy = 0; dy < scale; dy += 1) {
      for (let dx = 0; dx < scale; dx += 1) {
        rgb[(y * scale + dy) * width + x * scale + dx] = 0x000000;
      }
    }
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(rgb, width, width)));
  return new QRCodeReader().decode(bitmap).getText();
}

for (const [id, , , url] of EXPECTED) {
  test(`the ${id} QR code decodes to exactly its link`, () => {
    const svg = read(`src/assets/social/${id}-qr.svg`);
    assert.equal(decodeSvgQr(svg), url);
  });
}

test('the About page renders the social section from the shared list', () => {
  const page = read('src/pages/About.jsx');
  assert.match(page, /import \{ SOCIAL_LINKS \} from '@\/lib\/socialLinks'/);
  assert.match(page, /SOCIAL_LINKS\.map\(\(link\) =>/);
  for (const id of ['instagram', 'facebook', 'threads', 'tiktok']) {
    assert.match(page, new RegExp(`@/assets/social/${id}-qr\\.svg`), `About imports the ${id} QR`);
  }
  assert.match(page, /href=\{link\.url\}/);
  assert.match(page, /target="_blank"/);
  assert.match(page, /rel="noopener noreferrer"/);
  // Placement: after the bookstore tie-in, ahead of the not-for-sale
  // notice — the same order the founder-story tests pin around it.
  const leadInAt = page.indexOf("t('about.bookshopLeadIn')");
  const socialAt = page.indexOf('SOCIAL_LINKS.map');
  const noticeAt = page.indexOf('<TrademarkNotice />');
  assert.ok(leadInAt > -1 && socialAt > leadInAt, 'social section comes after the bookstore line');
  assert.ok(noticeAt > socialAt, 'social section comes before the trademark notice');
});
