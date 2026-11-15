/**
 * T6 — Phone-width overflow pins (Nov 14, 2026, owner catch: the
 * Scan page rendered wider than her phone — header clipped, white
 * strip at the right). Found by RENDERING at a hard 390px window
 * and bisecting the DOM (hide subtrees, watch scrollWidth):
 *
 *  1. Scan result state (document 539px at a 390px viewport): the
 *     result header row — product name block + two shrink-0 buttons
 *     ("Print shelf tag", "Scan next") — inside a 2-column grid
 *     whose items had no min-w-0, so the row's min-content widened
 *     the whole page. Fix: both grid cards carry min-w-0, the
 *     header row wraps (buttons drop to their own line on narrow
 *     screens), the name block clips (overflow-hidden), and the
 *     SKU·UPC line truncates.
 *  2. Print page (document 779px): the two-column grid had NO base
 *     column template, so below the lg breakpoint its single
 *     implicit column sized itself to the widest content's
 *     min-content — a nowrap truncated product name in the product
 *     picker (~750px for a long name) — and the whole page widened
 *     with it. Fix: the base template is grid-cols-[minmax(0,1fr)]
 *     (proven in the render harness: scrollWidth 779 → 390 and the
 *     name ellipsizes at its row width), and the picker's name
 *     wrapper is `min-w-0 flex-1 overflow-hidden` so the row's own
 *     internals clip correctly too.
 *
 * Rendered audit at hard 360px and 390px windows after the fix:
 * every main route measures scrollWidth == innerWidth, including
 * the Scan result state and the Print page (method: headless
 * chrome, no device-metrics override — the override itself masked
 * these overflows by expanding the layout viewport).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const scan = readFileSync(new URL('../../src/pages/Scan.jsx', import.meta.url), 'utf8');
const picker = readFileSync(
  new URL('../../src/components/print/ProductPicker.jsx', import.meta.url),
  'utf8',
);
const printCenter = readFileSync(new URL('../../src/pages/PrintCenter.jsx', import.meta.url), 'utf8');

test('scan: both cards in the two-column grid can shrink (min-w-0)', () => {
  assert.ok(
    scan.includes('min-w-0 space-y-4 rounded-xl border border-border bg-card'),
    'the scanner card carries min-w-0',
  );
  assert.ok(
    scan.includes('min-w-0 rounded-xl border border-border bg-card'),
    'the result card carries min-w-0',
  );
});

test('scan: the result header wraps instead of forcing width', () => {
  assert.ok(
    scan.includes('flex flex-wrap items-start justify-between gap-3'),
    'the header row wraps on narrow screens',
  );
  assert.ok(
    scan.includes('min-w-0 flex-1 overflow-hidden'),
    'the name block clips so the truncated name ellipsizes',
  );
  assert.ok(
    scan.includes('numeric mt-1 truncate text-xs text-muted-foreground'),
    'the SKU · UPC line truncates instead of widening the block',
  );
});

test('print picker: the name wrapper clips (flex-1 + overflow-hidden)', () => {
  assert.ok(
    picker.includes('min-w-0 flex-1 overflow-hidden'),
    'the picker name span clips its truncated text',
  );
});

test('print page: the base grid column is capped at the container width', () => {
  assert.ok(
    printCenter.includes('grid-cols-[minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)]'),
    'below lg the single column can never size to content min-content',
  );
});
