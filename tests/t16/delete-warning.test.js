/**
 * T16 — Delete warning (owner's decision, Nov 12, 2026).
 *
 * The delete-account section already stated the rule three times in
 * formal wording; the owner asked for her PLAIN sentence on top of
 * it — "you need to cancel before you delete, make sure you cancel
 * before you delete" — because she designs for skimmers (she is one)
 * and warnings must survive a skim. The warning therefore renders
 * PROMINENTLY in two places: at the very top of the Settings delete
 * section, above the formal intro, and inside the delete
 * confirmation dialog, above the type-the-word box.
 *
 * Headline (her plain sentence): "Cancel your subscription BEFORE
 * you delete." Body: her own designed warning, verbatim from
 * Nov 7, 2026. Wording + placement only — the delete flow, the
 * per-locale confirmation word, and the request payload are
 * untouched (t12's segment still guards those). The new strings
 * shipped in English in every locale (translation-debt
 * convention); translation tranches retire the debt locale by
 * locale — TRANCHE_1_LOCALES below tracks the locales whose pass
 * has landed, and these tests pin both states.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, SUPPORTED_LOCALES, t, setLocale } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8');

const HEADLINE = 'Cancel your subscription BEFORE you delete.';
const BODY = "You're deleting your account — that doesn't mean you're canceling your subscription. Cancel your subscription first, then delete your account whenever you're ready.";
const HEADLINE_KEY = 'settings.delete.cancelFirstHeadline';
const BODY_KEY = 'settings.delete.cancelFirstBody';

// Locales whose translation pass has landed (tranche 1, Nov 13, 2026).
// Locales whose translation pass has landed (tranche 1, Nov 13,
// 2026; tranche 2 added the six Spanish variants the same day).
const TRANCHE_1_LOCALES = [
  'am', 'ar', 'bn', 'bho',
  'es-MX', 'es-ES', 'es-US', 'es-CU', 'es-PR', 'es-VE',
];

test('the warning keys carry the owner\u2019s exact English wording', () => {
  assert.equal(en[HEADLINE_KEY], HEADLINE);
  assert.equal(en[BODY_KEY], BODY);
});

test('keyset parity holds across all 52 locale files at the delete-warning total', () => {
  const enKeys = Object.keys(en).sort();
  // 3595 after trial reminders; the delete warning added 2 keys;
  // rewards later added 67 more (46 UI + 21 training) for 3664;
  // POS later added 85 more (54 UI + 31 training) for 3749; the POS gate added 5 more, for 3754; plans parity added 14 more, for 3768; in-app problem reporting added 36 more (21 UI + 15 training), for 3804; the front-door fixes added 7 more (2 subscribe chooser + 5 reset code entry), for 3811.
  assert.equal(enKeys.length, 3811);
  assert.equal(SUPPORTED_LOCALES.length, 52);
  for (const code of SUPPORTED_LOCALES) {
    const keys = Object.keys(LOCALES[code]).sort();
    assert.deepEqual(keys, enKeys, `${code} keyset differs from en`);
    assert.ok(keys.includes(HEADLINE_KEY), `${code} missing ${HEADLINE_KEY}`);
    assert.ok(keys.includes(BODY_KEY), `${code} missing ${BODY_KEY}`);
  }
});

test('the warning is verbatim English where no translation pass has landed; translated in tranche 1 locales', () => {
  for (const code of SUPPORTED_LOCALES) {
    if (TRANCHE_1_LOCALES.includes(code)) continue;
    assert.equal(LOCALES[code][HEADLINE_KEY], HEADLINE, `${code} headline differs`);
    assert.equal(LOCALES[code][BODY_KEY], BODY, `${code} body differs`);
  }
  // Tranche 1 locales carry real translations of both warning
  // strings — non-empty and not the English text.
  for (const code of TRANCHE_1_LOCALES) {
    assert.ok(LOCALES[code][HEADLINE_KEY].length > 0, `${code} headline empty`);
    assert.ok(LOCALES[code][BODY_KEY].length > 0, `${code} body empty`);
    assert.notEqual(LOCALES[code][HEADLINE_KEY], HEADLINE, `${code} headline is still English after its translation pass`);
    assert.notEqual(LOCALES[code][BODY_KEY], BODY, `${code} body is still English after its translation pass`);
  }
  try {
    setLocale('en');
    assert.equal(t(HEADLINE_KEY), HEADLINE);
    assert.equal(t(BODY_KEY), BODY);
    // Interim state: locales without a translation pass render the
    // same English text — never a missing key.
    setLocale('de');
    assert.equal(t(HEADLINE_KEY), HEADLINE);
    assert.equal(t(BODY_KEY), BODY);
    // Completed-tranche locales render their own warning through t().
    setLocale('am');
    assert.equal(t(HEADLINE_KEY), LOCALES.am[HEADLINE_KEY]);
    assert.equal(t(BODY_KEY), LOCALES.am[BODY_KEY]);
    setLocale('es-MX');
    assert.equal(t(HEADLINE_KEY), LOCALES['es-MX'][HEADLINE_KEY]);
    assert.equal(t(BODY_KEY), LOCALES['es-MX'][BODY_KEY]);
  } finally {
    setLocale('en');
  }
});

test('Settings renders the warning at the top of the delete section, above the formal intro', () => {
  const src = readSrc('src/pages/Settings.jsx');
  // The shared warning component renders both keys.
  assert.ok(src.includes(`t('${HEADLINE_KEY}')`));
  assert.ok(src.includes(`t('${BODY_KEY}')`));
  const usages = src.split('<CancelBeforeDeleteWarning />').length - 1;
  assert.equal(usages, 2, 'the warning renders in exactly the two prominent places');
  const firstUse = src.indexOf('<CancelBeforeDeleteWarning />');
  const cardTitle = src.indexOf("t('settings.delete.title')");
  const intro = src.indexOf("t('settings.delete.intro')");
  assert.ok(cardTitle !== -1 && intro !== -1);
  assert.ok(firstUse > cardTitle, 'first warning sits inside the delete card');
  assert.ok(firstUse < intro, 'first warning sits ABOVE the formal intro text — first thing a skimmer sees');
});

test('Settings renders the warning inside the confirmation dialog, above the type-the-word box', () => {
  const src = readSrc('src/pages/Settings.jsx');
  const secondUse = src.lastIndexOf('<CancelBeforeDeleteWarning />');
  const dialogOpen = src.indexOf('<AlertDialogContent');
  const typeBox = src.indexOf("t('settings.delete.enterDelete'");
  const dialogDescription = src.indexOf("t('settings.delete.dialogDescription'");
  assert.ok(dialogOpen !== -1 && typeBox !== -1 && dialogDescription !== -1);
  assert.ok(secondUse > dialogOpen, 'second warning sits inside the confirmation dialog');
  assert.ok(secondUse > dialogDescription, 'second warning sits below the dialog description');
  assert.ok(secondUse < typeBox, 'second warning sits ABOVE the type-the-word confirmation');
});
