/**
 * T24 — Front-door fix batch (the owner's Nov 13, 2026 pre-test audit).
 *
 * Five small fixes, each pinned here:
 *  1. The About page carries the LanguagePicker like every other
 *     public page (same header placement, tone="onPrimary").
 *  2. A bare /subscribe (no ?plan= at all) shows the plain plan
 *     chooser — the "that plan link isn't valid" notice now appears
 *     ONLY when a plan parameter was supplied and is not recognized.
 *  3. Plain text links on Login / Register / ForgotPassword and the
 *     inline policy links in TermsOfService use the readable bronze
 *     `text-link` token (--link) instead of text-primary — in the
 *     active warm theme --primary is the pale cream-tan #E3D5BF,
 *     unreadable as text on white. Buttons and the theme itself are
 *     untouched (--primary keeps its exact value).
 *  4. The reset page takes the 6-digit code its email promises: the
 *     no-token state offers a code-entry form, a well-formed code
 *     becomes the resetToken the existing endpoint already accepts,
 *     a malformed code is refused on the spot, and the token (link)
 *     flow is unchanged. A "use a code instead" path covers a
 *     mangled link.
 *  5. src/lib/recovery.js called apiRequest WITHOUT the /api prefix
 *     every other caller uses (apiRequest prepends nothing and the
 *     server mounts every router under /api), so the whole recovery
 *     kit's calls missed the API. All paths now carry /api and are
 *     cross-checked against the server's real route table — the
 *     check that would have caught it. The same defect in
 *     AccountRecovery.jsx ("/auth/me") is fixed and pinned too.
 *
 * Seven new i18n keys (2 subscribe chooser + 5 reset code entry)
 * bring every locale to 3811 keys; am/ar/bn/bho carry real
 * translations, the rest carry English as tranche debt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const NEW_KEYS = [
  'subscribe.chooseTitle',
  'subscribe.chooseBody',
  'reset.codePrompt',
  'reset.codeLabel',
  'reset.codeContinue',
  'reset.codeInvalid',
  'reset.useCodeInstead',
];

// ---- Fix 1: About language picker ------------------------------------

test('about: the About page carries the language picker like the other public pages', () => {
  const about = readSrc('src/pages/About.jsx');
  assert.ok(about.includes("import LanguagePicker from '@/components/LanguagePicker'"));
  assert.ok(about.includes('<LanguagePicker tone="onPrimary" />'));
  // The founder text still renders verbatim from its protected module.
  assert.ok(about.includes('ABOUT_FOUNDER'));
  assert.ok(about.includes('about.paragraphs.map'));
  // Every other public page already had it — pin the full set so a
  // future page cannot quietly lose (or never gain) the picker.
  for (const page of ['Welcome', 'Plans', 'Subscribe', 'TermsOfService', 'SubscriptionPolicy', 'PrivacyPolicy']) {
    assert.ok(
      readSrc(`src/pages/${page}.jsx`).includes('<LanguagePicker tone="onPrimary" />'),
      `${page} lost its header language picker`,
    );
  }
  // The auth pages get theirs from the shared AuthLayout.
  assert.ok(readSrc('src/components/AuthLayout.jsx').includes('<LanguagePicker />'));
});

// ---- Fix 2: bare /subscribe ------------------------------------------

test('subscribe: the invalid-link notice only fires when a plan parameter was supplied', () => {
  const src = readSrc('src/pages/Subscribe.jsx');
  // The distinction itself: get('plan') is null ONLY for a bare visit.
  assert.ok(src.includes('const planParamSupplied = selected !== null;'));
  // Heading and body switch on it — invalid wording for a supplied-but-
  // unknown plan, the plain chooser wording for a bare visit.
  assert.ok(src.includes("planParamSupplied ? t('subscribe.invalidTitle') : t('subscribe.chooseTitle')"));
  assert.ok(src.includes("planParamSupplied ? t('subscribe.invalidBody') : t('subscribe.chooseBody')"));
  // Recognized plans behave exactly as before.
  assert.ok(src.includes("selected === 'business' ? 'business'"));
  assert.ok(src.includes("selected === 'essentials' ? 'essentials' : null"));
  assert.equal(en['subscribe.chooseTitle'], 'Choose a plan');
  assert.equal(
    en['subscribe.chooseBody'],
    'Choose the plan that fits your business below to continue — nothing has been subscribed.',
  );
});

// ---- Fix 3: readable link bronze --------------------------------------

test('link color: a dedicated bronze token exists and --primary is untouched', () => {
  const css = readSrc('src/index.css');
  // Deep bronze for light mode, light warm tan for dark mode — both in
  // the warm hue family of the cream-tan primary they replace for links.
  assert.ok(css.includes('--link: 32 48% 29%;'));
  assert.ok(css.includes('--link: 37 45% 70%;'));
  // The theme itself did not move: the pale cream-tan primary (buttons,
  // headers, brand surfaces) keeps its exact approved value.
  assert.ok(css.includes('--primary: 36.67 39.13% 81.96%;'));
  assert.ok(readSrc('tailwind.config.js').includes("link: 'hsl(var(--link))'"));
});

test('link color: the scoped auth and policy links use text-link, nothing else moved', () => {
  for (const page of ['Login', 'Register', 'ForgotPassword']) {
    const src = readSrc(`src/pages/${page}.jsx`);
    assert.ok(!src.includes('text-primary'), `${page} still has a pale text-primary link`);
    assert.ok(src.includes('text-link'), `${page} does not use the readable link color`);
  }
  assert.equal(readSrc('src/pages/Login.jsx').split('text-link').length - 1, 5);
  assert.equal(readSrc('src/pages/Register.jsx').split('text-link').length - 1, 7);
  assert.equal(readSrc('src/pages/ForgotPassword.jsx').split('text-link').length - 1, 1);
  // TermsOfService: exactly the two INLINE policy links changed; the
  // bottom related-pages nav keeps text-primary (deliberately narrow).
  const terms = readSrc('src/pages/TermsOfService.jsx');
  assert.equal(terms.split('font-medium text-link underline underline-offset-4').length - 1, 2);
  assert.equal(terms.split('font-medium text-primary underline underline-offset-4').length - 1, 4);
});

// ---- Fix 4: reset page code entry -------------------------------------

test('reset: the no-token state offers the code entry the email promises', () => {
  const src = readSrc('src/pages/ResetPassword.jsx');
  assert.ok(src.includes("t('reset.codePrompt')"));
  assert.ok(src.includes("t('reset.codeLabel')"));
  assert.ok(src.includes("t('reset.codeContinue')"));
  assert.ok(src.includes('id="reset-code"'));
  assert.ok(src.includes('inputMode="numeric"'));
  assert.ok(src.includes('autoComplete="one-time-code"'));
  // The entry form renders in BOTH the no-token state and the
  // arrived-with-a-token-but-asked-for-code state.
  assert.equal(src.split('{codeEntryForm}').length - 1, 2);
});

test('reset: a well-formed code becomes the reset token; a malformed one is refused in place', () => {
  const src = readSrc('src/pages/ResetPassword.jsx');
  // Shape check on the trimmed entry, with the plain error line.
  assert.ok(src.includes('const candidate = code.trim();'));
  assert.ok(src.includes('/^\\d{6}$/.test(candidate)'));
  assert.ok(src.includes("setCodeError(t('reset.codeInvalid'))"));
  // A passing code is stored and wins over any URL token.
  assert.ok(src.includes('setEnteredCode(candidate)'));
  assert.ok(src.includes('const resetToken = enteredCode ?? urlToken;'));
  // …and is submitted as resetToken to the endpoint that already
  // accepts the code — no server change was needed.
  assert.ok(src.includes('base44.auth.resetPassword({ resetToken, newPassword })'));
});

test('reset: the token (link) flow is unchanged, with a use-a-code-instead path', () => {
  const src = readSrc('src/pages/ResetPassword.jsx');
  assert.ok(src.includes('searchParams.get("token")'));
  assert.ok(src.includes('window.location.href = "/login?reset=success"'));
  assert.ok(src.includes('minLength={8}'));
  assert.ok(src.includes("t('reset.useCodeInstead')"));
  assert.ok(src.includes('setCodeEntryOpen(true)'));
  // The escape hatch to request a fresh email still stands.
  assert.ok(src.includes("t('reset.requestNewLink')"));
});

// ---- Fix 5: recovery API paths ----------------------------------------

/** Every apiRequest first-argument literal in a source file. */
function apiRequestPaths(src) {
  const out = [];
  const re = /apiRequest\(\s*([`'"])((?:(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[2]);
  return out;
}

const normalizePath = (p) => p.replace(/\$\{[^}]+\}/g, '{}').replace(/:[A-Za-z]+/g, '{}');

/** The server's real route table for the routers these clients call. */
function serverRouteSet() {
  const routes = new Set();
  // server/app.js mounts every router under /api — pin that first.
  const app = readSrc('server/app.js');
  assert.ok(app.includes("app.use('/api', createRecoveryRouter({ getPool }))"));
  assert.ok(app.includes("app.use('/api', createAuthRouter({ getPool }))"));
  for (const file of ['server/recoveryRoutes.js', 'server/authRoutes.js']) {
    const src = readSrc(file);
    const re = /router\.(?:get|post|patch|put|delete)\('([^']+)'/g;
    let m;
    while ((m = re.exec(src)) !== null) routes.add(normalizePath(`/api${m[1]}`));
  }
  return routes;
}

test('recovery: every client recovery path carries /api and names a real server route', () => {
  const routes = serverRouteSet();
  const libPaths = apiRequestPaths(readSrc('src/lib/recovery.js'));
  assert.equal(libPaths.length, 10, 'recovery.js should make exactly 10 apiRequest calls');
  for (const p of libPaths) {
    assert.ok(p.startsWith('/api/'), `recovery.js path misses the API prefix: ${p}`);
    assert.ok(routes.has(normalizePath(p)), `recovery.js path has no matching server route: ${p}`);
  }
  // The recovery page's own session probe had the same defect.
  const pagePaths = apiRequestPaths(readSrc('src/pages/AccountRecovery.jsx'));
  assert.deepEqual(pagePaths, ['/api/auth/me']);
  assert.ok(routes.has('/api/auth/me'));
});

// ---- i18n: the seven new keys -----------------------------------------

test('locale parity: all 52 locales carry the 7 new keys; tranche-1 locales are translated', () => {
  assert.equal(NEW_KEYS.length, 7);
  const enKeys = Object.keys(en).sort();
  assert.equal(enKeys.length, 3954);
  for (const key of NEW_KEYS) assert.ok(key in en, `en missing ${key}`);
  assert.equal(Object.keys(LOCALES).length, 52);
  for (const code of Object.keys(LOCALES)) {
    const table = LOCALES[code];
    assert.deepEqual(Object.keys(table).sort(), enKeys, `${code} key set differs from en`);
    for (const key of NEW_KEYS) assert.ok(key in table, `${code} missing ${key}`);
  }
  for (const code of ['am', 'ar', 'bn', 'bho']) {
    const table = LOCALES[code];
    for (const key of NEW_KEYS) {
      assert.notEqual(table[key], en[key], `${code} still carries English for ${key}`);
    }
  }
});
