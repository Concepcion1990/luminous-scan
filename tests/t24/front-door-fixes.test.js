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
  // The founder text renders from the locale keys (Nov 15, 2026 —
  // her ruling: the story translates into all 52); the English key
  // values are byte-identical to its protected module, which
  // src/lib/aboutFounder.test.js pins.
  assert.ok(about.includes('FOUNDER_PARAGRAPH_KEYS.map'));
  assert.ok(about.includes("t('about.founderHeading')"));
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
  // Release 344 (Nov 22, 2026): Register's invite panels (the
  // spent-link panel's sign-in door) add ONE more text-link —
  // an auth-page prose link on the bronze token, exactly what
  // this rule governs. Pin 7 → 8.
  assert.equal(readSrc('src/pages/Register.jsx').split('text-link').length - 1, 8);
  assert.equal(readSrc('src/pages/ForgotPassword.jsx').split('text-link').length - 1, 1);
  // TermsOfService: originally exactly the two INLINE policy links
  // changed and the bottom related-pages nav kept text-primary
  // (deliberately narrow, Nov 13). The owner widened the rule on
  // Nov 14, 2026 — in-app links render green through --primary on the
  // signed-in surfaces, and she ordered every prose link onto the
  // bronze link token — so the nav links moved too: all six prose
  // links are text-link now, and no text-primary prose link remains.
  const terms = readSrc('src/pages/TermsOfService.jsx');
  assert.equal(terms.split('font-medium text-link underline underline-offset-4').length - 1, 6);
  assert.equal(terms.split('font-medium text-primary underline underline-offset-4').length - 1, 0);
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
  // 10 at the fix-batch; the account-security batch (Nov 14, 2026)
  // added changePassword + sendStaffPasswordReset, for 12.
  assert.equal(libPaths.length, 12, 'recovery.js should make exactly 12 apiRequest calls');
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
  assert.equal(enKeys.length, 6716); // The eBay storefront batch (release 362, Nov 23, 2026) added 46 more (the Storefront connections door and its wordings, the eBay plan line carried on both plans, the connect-your-eBay lesson, and the five storefront API wordings), for 5780. The invoice-file batch (Nov 23, 2026) added 11 more (the supplier invoice paper copy: its attach door and hint, the attached label, the view and remove doors, the over-25-MB refusal, and the five API wordings for the file door and the restaurant plan gate), for 5734. The restaurant operations batch (Nov 23, 2026) added 390 more (the twelve restaurant operations doors and their dialogs, the supplier-invoice three-way match and vendor price alerts, the waste log, expiry and allergen wordings, temperature logs, the 86 board, staff meals, batch runs, the two restaurant plan lines, the four restaurant-operations lessons and the three new API wordings), for 5723. The cross-store messages batch (Nov 23, 2026) added 25 more (the account-wide messaging door: its nav label, its plan line, the door's own wordings, the two API refusal wordings, and the three cross-store lessons), for 5333. The restaurant corner batch (Nov 23, 2026) added 172 more (the corner's two pages and their dialogs, the order guide, the dish card, the three restaurant enrollment ticks, the five restaurant lessons and the nine recipe/par API wordings), for 5308. The time trails batch (Nov 23, 2026) added 6 more (the trail heading, Created, Saved, Logged, Sent for review, and the former-team-member fallback), for 5136. The document frames batch (Nov 23, 2026) added 4 more (the printed-at stamp + the Studio's picture width/length labels and size hint), for 5130. The returns build batch (Nov 22, 2026) added 9 more (the tax on a return + its four source notes, and scan-to-pick on the Returned items — its button, window title, hint and added note), for 5126. The list-prices batch (Nov 22, 2026) added 1 more (the plans line for each product's price beside its count), for 5117. The tax-automatic batch (Nov 22, 2026) added 10 more (the tax mode switch + its two options and hint, the three order-form automatic-tax hints, the plans line, and the new steps of the two tax lessons), for 5117. The invite hardening batch (Nov 22, 2026) added 5 more (the spent-invite-link refusal, the signed-in connected panel and its door, and the fifth steps of the two invite lessons), for 5106. The signup domain blocklist batch (Nov 22, 2026) added 4 more (the neutral signup refusal + the three operator domain-list wordings), for 5101. The failed-payment road batch (Nov 21, 2026) added 2 more (the past-due fix-by line + the owner-billing lesson's fifth step), for 5097. The order-form label-upload batch (Nov 18, 2026) added 3 more (orders.shippingLabel, orders.uploadLabel, orders.labelStagedNote), for 4633. The GS1 learn-more batch (Nov 18, 2026) added 3 more (settings.details.gs1LearnMore, settings.details.gs1LearnMoreUs, settings.details.gs1GlobalSite), for 4636. // +1 tracking scan (Nov 18, 2026). +5 scan-to-tally (Nov 16, 2026). // 3954 at the POS + deletion batch; +14 account-security (change password + staff reset); +1 white-label reset step; +13 locations/orders train; +2 edit-quantity; +2 photo chooser; +2 in-form scan; +4 category combobox; +3 product delete; +2 category edit door; +1 count-sheet scanner; +2 archived freeze; +3 import cap-awareness; +1 receive step; +1 draft notice; +3 owner-import lesson; +46 carrier labels + document style; +13 code generator; +10 GS1 mode +1 About bookshop lead-in (Nov 15, 2026). The lesson-visual fix batch (Nov 15, 2026) added 2 more (the wide view’s See it full screen / Back to the lesson labels), for 4125. The carrier-door fix (Nov 15, 2026) added 1 more (the Upload button’s pick-an-order-first guidance), for 4126. The bulk-delete batch (Nov 15, 2026) added 12 more (11 bulk-delete UI keys + the products-find-edit step 11 it teaches), for 4138. The plan-lists batch (Nov 15, 2026) added 3 more (the bulk edit/delete plans line + the Mobile label-printing and Mobile training lines), for 4141. The full-app translation sweep batch (Nov 15, 2026) added 64 more (the About page, the notice block, legal-page chrome, the 404 page and the sweep stragglers, all ×52), for 4205. The leftovers sweep (Nov 15, 2026) added 419 more (the apiErrors.* API-error banner strings, x52), for 4624. The staff-settings batch (Nov 19, 2026) added 57 more (personal Settings + enrollment grants + shift windows + welcome + install door + neutral stop + universal sign-out link + owner note), for 4693. The plan-presentation extension (Nov 19, 2026) added 7 more (the plansLib.includes lines for this batch, on Plans + Welcome + the in-app plan page alike), for 4700. The money-surfaces audit additions (Nov 19, 2026) added 3 more (the Subscribe member card + the plan-neutral limit refusal), for 4703. The owner confidentiality lesson (Nov 19, 2026) added 5 more (title + 4 steps, owner track only), for 4708. The contact-details ruling (Nov 19, 2026) added 6 more (the address & phone tick + hint + the read-only business card), for 4714. The enrollment pay/contact batch (Nov 19, 2026) added 2 more (the member's home address + phone labels in the staff dialog), for 4716. The returns-approval gate (Nov 19, 2026) added 6 more (the returns.complete enrollment tick + its area heading + hint, the two waiting-for-approval notes and the API refusal wording), for 4740. The no-dangling-doors batch (Nov 19, 2026) added 3 more (the products.create enrollment tick + its area heading + hint), for 4743. The field-scanners batch (Nov 19, 2026) added 5 more (the ISBN digits reader: its title, hint, Read number button, reading line and plain refusal), for 4748. The add-location tick batch (Nov 19, 2026) added 4 more (the locations.create enrollment tick + its area heading + hint, and the add-a-location refusal wording), for 4752. The business-policies batch (Nov 19, 2026) added 34 more (the owner's own store policies + terms in Settings, the platform-policies card, the welcome showing, the plans line, the three policy API wordings, the owner store-policies lesson and the welcome-basics step, plus the two policy 404 wordings), for 4786. The staff-roster tick batch (Nov 19, 2026) added 3 more (the staff.roster enrollment tick + its area heading + hint), for 4789. The schedule-doors batch (Nov 20, 2026) added 3 more (the schedule card Clear button + the message composer character counter and limit note) and removed 1 (the inbox markRead label — the button is gone), for 4791. The low-stock ticks batch (Nov 20, 2026) added 6 more (the two Business low-stock enrollment ticks — alerts.view and products.reorder — with their area heading and hint, and the reorder-change and alerts-view refusal wordings), for 4797. The training builds batch (Nov 20, 2026) added 98 more (the per-lesson quizzes and comments, the owner's policy quizzes with their Settings editor and staff ticks, five new lessons, the welcome sign-out step, and the confidentiality map steps), for 4895. The training builds batch (Nov 20, 2026) added 23 more (the API error wordings for the owner's policy quizzes, the lesson-quiz gate, lesson comments and team records), for 4918. The profile photos batch (Nov 21, 2026) added 43 more (the profile photo card and the owner's approval card, the owner's display name, the plans line, five API error wordings, and the two profile-photo lessons), for 4961. The direct-deposit batch (Nov 21, 2026) added 31 more (the signature step + sealed form, both correction doors, the member's details-on-file card, the pay-stub print door, three API error wordings, and the owner lesson's fifth step), for 4992. The rider batch (Nov 21, 2026) added 6 more (the owner’s own details-on-file card with its edit door, the viewer’s own Payroll view, and two API error wordings), for 4998. The founding-tester comp batch (Nov 21, 2026) added 9 more (the founding-tester plan status + no-charge note, the Subscribe card, the Upgrade intro + note, and the four operator-list API wordings), for 5007. The clock build (Nov 21, 2026) added 44 more (the staff.clock tick + area + hint, the call-in gate and window, the missed clock-out flag, the Staff call-ins card and fix-times dialog, seven API error wordings, and the call-ins and clock corrections lesson), for 5051. The staff documents build (Nov 21, 2026) added 44 more (the staff.documents tick + area + hint, the red warning, the documents card and dialog, the plans line, five API error wordings, and the owner + manager staff-documents lessons), for 5095. The import robustness batch (release 365, Nov 23, 2026) added 8 more (the photo import field and its problems heading, the quantity-marriage guard, the no-location units warning, the 25 MB import refusal, the selling-price label, and the import lesson's two new steps), for 5788. The photo door fix (release 366, Nov 24, 2026) added 8 more (the photos-on-their-way import line, the Products photo progress line and its still-on-their-way count, the Bring in missing photos door and its two answers, the on-product photo problem note, and the import lesson’s fifth step), for 5796. The print family batch (Nov 24, 2026) added 5 more (the blank-forms door and its hint, the blank-form hand-fill subtitle, and the product-name and time column heads), for 5801. The product form batch (Nov 24, 2026) added 6 more (the product Format field: its form label, the Paperback and Hardcover options, the details-row label, and the create + update import field labels), for 5807. The owner's pick-list correction later the same day added 1 more (the Format pick-list's "Add a format…" door), for 5808. The photo capture batch (Nov 24, 2026) added 4 more (the product photo camera door: its Take the photo shutter, the Retake and Use this photo doors, and the camera-could-not-be-used line), for 5812. The clock tick split + documents self-door batch (Nov 24, 2026) added 8 more (the two clock tick labels, the two split clock-admin refusal wordings, and the four staff-documents self-door keys) and removed 2 (the old combined tick label and its refusal), for 5818. The restaurant IA batch (release 377, Nov 25, 2026) added 27 more (the six shelf names + the Locations shelf name, the Today page's title, subtitle and four attention lines, the shelves heading, the shelf back link, the Locations page's three lines, the Recipes door line, and the six shelf plan lines that regroup the corner's features on Plans + Welcome + the comparison table), for 5845. The paper-trail batch (release 378, Nov 25, 2026) added 63 more (the manager log book page and its training lesson, the supplier credit memo section and dialog with the invoice standing lines, the count-sanity warning, the two shelf cross-link lines, the log book plan line, and the three credit-memo API wordings), for 5908. The smalls bundle (Nov 25, 2026) added 5 more (the inherited-plan note, the date-format picker’s Automatic option + its hint, and the credit-memo paper’s title + record note), for 5913. The prints build (Nov 25, 2026) added 18 more (the record papers' five titles, the policies file note, the week/period/hours/lesson/score labels, the record-prints plan line, and the staff-record-prints lesson's title + five steps), for 5931.
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
