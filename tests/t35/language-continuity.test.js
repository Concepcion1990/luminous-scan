/**
 * Language continuity + error language (owner catches, Nov 18, 2026).
 *
 * Her hand found the split three ways in one evening: pick Spanish
 * at the door and the app opened in English while the All screens
 * menu stayed Spanish; switch back to English in Settings and the
 * menu stayed stuck on Spanish; and a wrong password answered
 * "Invalid email or password." in English on a Spanish login page.
 * Root causes pinned here:
 *
 *   - The nav menu's translations were a Layout useMemo keyed on a
 *     Layout-local locale state ('en' at birth, moved only when the
 *     business's stored language changed VALUE), while every page
 *     renders from the one active locale. The menu must subscribe
 *     to the same source (useLocale) — no local locale state.
 *   - Layout applied `profile?.language || 'en'` the moment it
 *     mounted, so a still-loading profile read as English and
 *     stomped the visitor's door pick. Nothing applies while the
 *     workspace loads; once known, a marked door pick
 *     (stockhaven.localePick) WINS and is written into the business
 *     record for its owner.
 *   - Login ran its own raw fetch and threw the server's English
 *     message verbatim. It now resolves through apiErrors like
 *     every other call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => readFileSync(path.join(here, '..', '..', 'src', rel), 'utf8');

// A localStorage the i18n module can see (node has none). Installed
// BEFORE the module is imported, like a browser profile would be.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const i18n = await import('../../src/lib/i18n.js');
const { esMX } = await import('../../src/lib/locales/es-MX.js');

test('door pick: mark, read and clear round-trip; unknown codes never land', () => {
  i18n.clearLocalePick();
  assert.equal(i18n.readLocalePick(), null);
  i18n.markLocalePick('es-MX');
  assert.equal(i18n.readLocalePick(), 'es-MX');
  i18n.markLocalePick('xx-unknown');
  assert.equal(i18n.readLocalePick(), 'es-MX', 'an unknown code must not replace a good pick');
  i18n.clearLocalePick();
  assert.equal(i18n.readLocalePick(), null);
  store.set(i18n.LOCALE_PICK_STORAGE_KEY, 'xx-unknown');
  assert.equal(i18n.readLocalePick(), null, 'a stale stored code reads as no pick');
  store.delete(i18n.LOCALE_PICK_STORAGE_KEY);
});

test('the pick marker is a separate key from the locale mirror', () => {
  assert.notEqual(i18n.LOCALE_PICK_STORAGE_KEY, i18n.LOCALE_STORAGE_KEY);
  i18n.setLocale('es-MX');
  assert.equal(store.get(i18n.LOCALE_STORAGE_KEY), 'es-MX', 'setLocale still mirrors the active locale');
  assert.equal(i18n.readLocalePick(), null, 'applying a language never forges a door pick');
  i18n.setLocale('en');
});

test('login failure speaks the reader language (invalid credentials, es-MX)', async () => {
  const { loginWithMfa } = await import('../../src/lib/authMfa.js');
  const realFetch = globalThis.fetch;
  i18n.setLocale('es-MX');
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: 'invalid_credentials', message: 'Invalid email or password.' }),
  });
  try {
    await assert.rejects(
      loginWithMfa('owner@example.com', 'wrong'),
      (err) => err.message === esMX['apiErrors.invalidCredentials'] && err.status === 401,
    );
  } finally {
    globalThis.fetch = realFetch;
    i18n.setLocale('en');
  }
});

test('login failure speaks the reader language (rate limit, es-MX)', async () => {
  const { loginWithMfa } = await import('../../src/lib/authMfa.js');
  const realFetch = globalThis.fetch;
  i18n.setLocale('es-MX');
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: 'rate_limited', message: 'Too many attempts — please wait and try again.' }),
  });
  try {
    await assert.rejects(
      loginWithMfa('owner@example.com', 'wrong'),
      (err) => err.message === esMX['apiErrors.rateLimited'],
    );
  } finally {
    globalThis.fetch = realFetch;
    i18n.setLocale('en');
  }
});

test('Layout: the nav renders from the one active locale — no local locale state', () => {
  const src = readSrc('components/Layout.jsx');
  assert.doesNotMatch(src, /setLocaleState/, 'the frozen-memo locale state must not come back');
  assert.match(src, /const locale = useLocale\(\);/);
  assert.match(src, /\[locale\]/, 'the nav memo keys on the subscribed locale');
});

test('Layout: reconciliation — loading applies nothing, a door pick wins and is saved for the owner', () => {
  const src = readSrc('components/Layout.jsx');
  assert.match(src, /if \(!user \|\| !profile \|\| !activeId\) return;/, 'a loading workspace must not stomp the active language');
  assert.match(src, /readLocalePick\(\)/);
  assert.match(src, /profile\.owner_id === user\.id/, 'only the owner writes the business record');
  assert.match(src, /body: \{ language: pick \}/, 'the pick is saved as the business language');
  assert.match(src, /clearLocalePick\(\)/, 'a reconciled pick is spent');
});

test('Layout: the account is the locale authority — a business switch never moves the language (Nov 24, 2026)', () => {
  // The carry fix: language lives on the ACCOUNT (users.language,
  // migration 052). The reconciliation sources the session locale
  // from the signed-in user, writes a door pick back to
  // /api/auth/me (the person's own record — any signed-in user,
  // not only a business owner), and seeds an unseeded account
  // once from the business the person is standing in. The entered
  // business's stored language must never be applied: that was
  // the Nov 23 flip (Spanish in Business 3, English in 1 and 2).
  const src = readSrc('components/Layout.jsx');
  assert.match(src, /const accountCode = LOCALES\[user\.language\] \? user\.language : null;/, 'the locale is sourced from the account record');
  assert.match(src, /apiRequest\('\/api\/auth\/me', \{\s+method: 'PATCH',\s+body: \{ language: pick \}/, 'a door pick writes back to the account, not only to the active business');
  assert.match(src, /apiRequest\('\/api\/auth\/me', \{\s+method: 'PATCH',\s+body: \{ language: seed \}/, 'an unseeded account is seeded onto the account record');
  assert.match(src, /const seed = LOCALES\[profile\.language\] \? profile\.language : getLocale\(\);/, 'the seed comes from the business the person is standing in');
  assert.doesNotMatch(src, /setLocale\(businessCode\)/, 'the entered business language must never stomp the session locale');
  assert.doesNotMatch(src, /const businessCode = LOCALES\[profile\.language\]/, 'the business record is no longer read as a locale authority');
});

test('Settings: the language write targets the account; currency still targets the business', () => {
  const page = readSrc('pages/Settings.jsx');
  const apply = page.slice(page.indexOf('const applyPreference'), page.indexOf('const save ='));
  assert.match(apply, /apiRequest\('\/api\/auth\/me', \{\s+method: 'PATCH',\s+body: \{ language: value \}/, 'language persists to the account record');
  assert.match(apply, /body: \{ \[key\]: value \}/, 'the business record still receives its single-field writes (currency, and the language mirror)');
});

test('the public picker marks its choice as a door pick', () => {
  const src = readSrc('components/LanguagePicker.jsx');
  assert.match(src, /markLocalePick\(code\)/);
});

test('authMfa resolves login errors through the API-error registry', () => {
  const src = readSrc('lib/authMfa.js');
  assert.match(src, /apiErrorMessage\(data, response\.status\)/);
  assert.doesNotMatch(src, /data\.message \|\| data\.error/, 'the raw English message must not be thrown verbatim');
});

test('the language lesson no longer claims the choice stays on this device', () => {
  for (const [code, strings] of Object.entries(i18n.LOCALES)) {
    const step3 = strings['training.lessons.your-language.step3'];
    assert.equal(typeof step3, 'string', `${code} still carries the step`);
    assert.ok(step3.length > 0, `${code} step3 is not blank`);
  }
  assert.doesNotMatch(i18n.LOCALES.en['training.lessons.your-language.step3'], /stays on this device/);
  assert.doesNotMatch(i18n.LOCALES['es-MX']['training.lessons.your-language.step3'], /se queda en este dispositivo/);
  assert.match(i18n.LOCALES.en['training.lessons.your-language.step3'], /sign-in screen/);
});

test('the Settings language box reads the live locale, never the form copy (owner catch #2)', () => {
  const card = readSrc('components/business/DetailsCard.jsx');
  assert.match(card, /const locale = useLocale\(\);/, 'the card subscribes to the one live locale');
  assert.match(
    card,
    /<Select value=\{locale\} onValueChange=\{pickPreference\('language'\)\}>/,
    'the language box displays the live locale',
  );
  assert.doesNotMatch(card, /value=\{values\.language\}/, 'the stale form copy must not drive the box');
  assert.match(
    card,
    /<Select value=\{values\.currency\} onValueChange=\{pickPreference\('currency'\)\}>/,
    'currency keeps its own behavior, untouched',
  );
});

test('Settings: the form language mirror follows the live locale; a failed save restores the live one', () => {
  const page = readSrc('pages/Settings.jsx');
  assert.match(page, /current\.language !== liveLocale/, 'the mirror resyncs when the language changes elsewhere');
  assert.match(
    page,
    /const previous = key === 'language' \? getLocale\(\) : values\[key\];/,
    'applyPreference replaces (and restores) the live locale, not the form copy',
  );
});
