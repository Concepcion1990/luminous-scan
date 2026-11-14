/**
 * T6 — the worldwide currency list (owner's ruling, Nov 14, 2026).
 *
 * Settings offered eight currencies (USD CAD GBP EUR AUD NZD MXN
 * JPY) to an app built for everyone, worldwide, in 52 languages.
 * The list is now every active ISO 4217 code. Two copies exist —
 * CURRENCIES in src/lib/business.js (the picker) and
 * SUPPORTED_CURRENCIES in server/authRoutes.js (the save validator,
 * same mirroring pattern as SUPPORTED_LANGUAGES) — and this test
 * pins them identical, complete, and formattable, and pins billing
 * isolation: the list is DISPLAY-only and no billing file reads it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function extractCodes(path, marker) {
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} not found in ${path}`);
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  const body = source.slice(open, close);
  return [...body.matchAll(/'([A-Z]{3})'/g)].map((m) => m[1]);
}

const clientCodes = extractCodes(new URL('../../src/lib/business.js', import.meta.url), 'export const CURRENCIES');
const serverCodes = extractCodes(new URL('../../server/authRoutes.js', import.meta.url), 'const SUPPORTED_CURRENCIES');

test('the picker list and the server validator are one identical list', () => {
  assert.deepEqual(serverCodes, clientCodes);
});

test('the list is the full worldwide set, well-formed, no duplicates', () => {
  assert.ok(clientCodes.length >= 150, `expected 150+ currencies, got ${clientCodes.length}`);
  assert.equal(new Set(clientCodes).size, clientCodes.length, 'duplicate currency codes');
  for (const code of clientCodes) assert.match(code, /^[A-Z]{3}$/);
  // The original eight survive, still first (existing users' order).
  assert.deepEqual(clientCodes.slice(0, 8), ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD', 'MXN', 'JPY']);
  // Codes retired by their issuers are NOT offered as if current.
  for (const dead of ['HRK', 'SLL', 'ZWL']) assert.ok(!clientCodes.includes(dead), `${dead} is superseded`);
});

test('the home currencies of the 52 locales are all present', () => {
  // One or more home currencies per supported language's region(s):
  // ETB (am), EGP/SAR/AED (ar), INR (bho/gu/hi/kn/mr/pa/te), BDT (bn),
  // EUR (de/es-ES/fr/it), USD/GBP/AUD/CAD (en variants), MXN/CUP/VES
  // (es variants), IRR (fa), AFN (prs), NGN (ha/pcm/yo), IDR (id/jv),
  // JPY (ja), KRW (ko), MYR (ms), BRL (pt-BR), RUB (ru), KES/TZS (sw),
  // TJS (tg), THB (th), PHP (tl), TRY (tr), UAH (uk), PKR (ur/pa),
  // VND (vi), CNY/HKD (zh/yue/wuu).
  const home = [
    'AED', 'AFN', 'AUD', 'BDT', 'BRL', 'CAD', 'CNY', 'CUP', 'EGP', 'ETB',
    'EUR', 'GBP', 'HKD', 'IDR', 'INR', 'IRR', 'JPY', 'KES', 'KRW', 'MXN',
    'MYR', 'NGN', 'PHP', 'PKR', 'RUB', 'SAR', 'THB', 'TJS', 'TRY', 'TZS',
    'UAH', 'USD', 'VES', 'VND',
  ];
  for (const code of home) assert.ok(clientCodes.includes(code), `missing home currency ${code}`);
});

test('every listed currency actually formats through Intl.NumberFormat', () => {
  // formatMoney (src/lib/inventory.js) and the server PDF/email money
  // helpers all delegate to Intl with the saved code — a code Intl
  // rejects would silently fall back to USD, so every code must work.
  for (const code of clientCodes) {
    const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(1234.5);
    assert.ok(formatted.length > 0, `${code} formatted empty`);
  }
  const digits = (code) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
  // Zero-decimal currencies format with no fraction digits...
  assert.equal(digits('JPY'), 0);
  assert.equal(digits('KRW'), 0);
  // ...three-decimal currencies with three...
  assert.equal(digits('KWD'), 3);
  assert.equal(digits('BHD'), 3);
  // ...and the familiar two-decimal world with two.
  assert.equal(digits('USD'), 2);
  assert.equal(digits('EUR'), 2);
});

test('display only: no billing file reads the supported-currency list or the workspace currency', () => {
  for (const path of ['../../server/billingRoutes.js', '../../server/billing.js', '../../server/stripeEvidence.js']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(!source.includes('SUPPORTED_CURRENCIES'), `${path} must not read the display-currency list`);
    assert.ok(!source.includes('business.currency'), `${path} must not read the workspace display currency`);
    assert.ok(!source.includes('business?.currency'), `${path} must not read the workspace display currency`);
  }
});
