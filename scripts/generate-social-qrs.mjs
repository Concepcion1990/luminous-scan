/**
 * Generate the About-page social QR codes as SVG text files.
 *
 * Why SVG text: the publish route carries UTF-8 text only, so the QR
 * artwork ships as vector paths, never as a binary image. Each SVG is
 * a white square with one path of unit rects — one rect per dark QR
 * module — in the app's ink (#151d20, the --foreground colour), with
 * the standard 4-module quiet zone inside the viewBox.
 *
 * Source of truth: src/lib/socialLinks.js. Run after any URL change:
 *   node scripts/generate-social-qrs.mjs
 * tests/t35/about-social-qr.test.js decodes every committed SVG with
 * a real QR reader and pins the decoded text to the URL, so a stale
 * or hand-edited SVG fails the suite.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QRCodeWriter, BarcodeFormat, EncodeHintType } from '@zxing/library';
import { SOCIAL_LINKS } from '../src/lib/socialLinks.js';

const INK = '#151d20';
const PAPER = '#ffffff';
const QUIET = 4; // modules of quiet zone on every side (QR standard)

const outDir = fileURLToPath(new URL('../src/assets/social/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const writer = new QRCodeWriter();
for (const link of SOCIAL_LINKS) {
  const hints = new Map();
  hints.set(EncodeHintType.MARGIN, 0); // the quiet zone is drawn here, once
  hints.set(EncodeHintType.ERROR_CORRECTION, 'M');
  hints.set(EncodeHintType.CHARACTER_SET, 'UTF-8');
  const matrix = writer.encode(link.url, BarcodeFormat.QR_CODE, 0, 0, hints);
  const modules = matrix.getWidth();
  const size = modules + QUIET * 2;
  let d = '';
  for (let y = 0; y < modules; y += 1) {
    for (let x = 0; x < modules; x += 1) {
      if (matrix.get(x, y)) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
    }
  }
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code for ${link.platform}: ${link.url}">`,
    `<rect width="${size}" height="${size}" fill="${PAPER}"/>`,
    `<path d="${d}" fill="${INK}"/>`,
    '</svg>',
    '',
  ].join('\n');
  const file = `${outDir}${link.id}-qr.svg`;
  writeFileSync(file, svg);
  console.log(`wrote ${file.replace(dirname(outDir), '.')} (${modules}x${modules} modules, ${svg.length} bytes)`);
}
