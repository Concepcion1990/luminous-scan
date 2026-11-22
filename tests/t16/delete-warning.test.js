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
  'fr-FR', 'fr-CA', 'pt-BR', 'pt-PT', 'zh-Hans', 'zh-Hant', 'yue', 'wuu',
  'de', 'it', 'ja',
  'ko', 'ru', 'uk',
  'fa', 'prs', 'ur',
  'hi', 'tg', 'tr',
  'gu', 'kn', 'mr',
  'ta', 'te', 'pa-Guru',
  'pa-Arab', 'id', 'ms',
  'th', 'vi', 'tl',
  'ha', 'sw', 'yo',
  'jv',
  'pcm',
];

test('the warning keys carry the owner\u2019s exact English wording', () => {
  assert.equal(en[HEADLINE_KEY], HEADLINE);
  assert.equal(en[BODY_KEY], BODY);
});

test('keyset parity holds across all 52 locale files at the delete-warning total', () => {
  const enKeys = Object.keys(en).sort();
  // 3595 after trial reminders; the delete warning added 2 keys;
  // rewards later added 67 more (46 UI + 21 training) for 3664;
  // POS later added 85 more (54 UI + 31 training) for 3749; the POS gate added 5 more, for 3754; plans parity added 14 more, for 3768; in-app problem reporting added 36 more (21 UI + 15 training), for 3804; the front-door fixes added 7 more (2 subscribe chooser + 5 reset code entry), for 3811; the cross-store transfer door added 19 more (14 UI + 5 training), for 3830; clearance + rollback pricing added 27 more (17 UI/plans + 10 training), for 3857; shipping labels added 18 more (8 UI/plans + 10 training), for 3875; the POS provider expansion + deletion-request batch added 79 more (44 UI + 35 training), for 3954; the account-security batch (change password + owner-sent staff reset) added 14 more, for 3968; the white-label reset-clarification step added 1 more, for 3981; the locations/orders train added 13 more (2 location keys, 7 ship-to keys, 4 lifecycle/address-book keys), for 3994.
  assert.equal(enKeys.length, 5051); // The order-form label-upload batch (Nov 18, 2026) added 3 more (orders.shippingLabel, orders.uploadLabel, orders.labelStagedNote), for 4633. The GS1 learn-more batch (Nov 18, 2026) added 3 more (settings.details.gs1LearnMore, settings.details.gs1LearnMoreUs, settings.details.gs1GlobalSite), for 4636. // +2 category edit door, +1 count-sheet scanner, +2 archived freeze, +3 import cap-awareness, +1 receive step, +1 draft notice, +3 owner-import lesson, +46 carrier labels + document style (Nov 14, 2026) +13 code generator, +10 GS1 mode (Nov 15, 2026). +1 About bookshop lead-in (Nov 15, 2026). The lesson-visual fix batch (Nov 15, 2026) added 2 more (the wide view’s See it full screen / Back to the lesson labels), for 4125. The carrier-door fix (Nov 15, 2026) added 1 more (the Upload button’s pick-an-order-first guidance), for 4126. The bulk-delete batch (Nov 15, 2026) added 12 more (11 bulk-delete UI keys + the products-find-edit step 11 it teaches), for 4138. The plan-lists batch (Nov 15, 2026) added 3 more (the bulk edit/delete plans line + the Mobile label-printing and Mobile training lines), for 4141. The full-app translation sweep batch (Nov 15, 2026) added 64 more (the About page, the notice block, legal-page chrome, the 404 page and the sweep stragglers, all ×52), for 4205. The leftovers sweep (Nov 15, 2026) added 419 more (the apiErrors.* API-error banner strings, x52), for 4624. The scan-to-tally batch (Nov 16, 2026) added 5 more (the scanTally.* strings), for 4629. The tracking-scan batch (Nov 18, 2026) added 1 more (orders.scanTracking), for 4630. The staff-settings batch (Nov 19, 2026) added 57 more (personal Settings + enrollment grants + shift windows + welcome + install door + neutral stop + universal sign-out link + owner note), for 4693. The plan-presentation extension (Nov 19, 2026) added 7 more (the plansLib.includes lines for this batch, on Plans + Welcome + the in-app plan page alike), for 4700. The money-surfaces audit additions (Nov 19, 2026) added 3 more (the Subscribe member card + the plan-neutral limit refusal), for 4703. The owner confidentiality lesson (Nov 19, 2026) added 5 more (title + 4 steps, owner track only), for 4708. The contact-details ruling (Nov 19, 2026) added 6 more (the address & phone tick + hint + the read-only business card), for 4714. The enrollment pay/contact batch (Nov 19, 2026) added 2 more (the member's home address + phone labels in the staff dialog), for 4716. The returns-approval gate (Nov 19, 2026) added 6 more (the returns.complete enrollment tick + its area heading + hint, the two waiting-for-approval notes and the API refusal wording), for 4740. The no-dangling-doors batch (Nov 19, 2026) added 3 more (the products.create enrollment tick + its area heading + hint), for 4743. The field-scanners batch (Nov 19, 2026) added 5 more (the ISBN digits reader: its title, hint, Read number button, reading line and plain refusal), for 4748. The add-location tick batch (Nov 19, 2026) added 4 more (the locations.create enrollment tick + its area heading + hint, and the add-a-location refusal wording), for 4752. The business-policies batch (Nov 19, 2026) added 34 more (the owner's own store policies + terms in Settings, the platform-policies card, the welcome showing, the plans line, the three policy API wordings, the owner store-policies lesson and the welcome-basics step, plus the two policy 404 wordings), for 4786. The staff-roster tick batch (Nov 19, 2026) added 3 more (the staff.roster enrollment tick + its area heading + hint), for 4789. The schedule-doors batch (Nov 20, 2026) added 3 more (the schedule card Clear button + the message composer character counter and limit note) and removed 1 (the inbox markRead label — the button is gone), for 4791. The low-stock ticks batch (Nov 20, 2026) added 6 more (the two Business low-stock enrollment ticks — alerts.view and products.reorder — with their area heading and hint, and the reorder-change and alerts-view refusal wordings), for 4797. The training builds batch (Nov 20, 2026) added 98 more (the per-lesson quizzes and comments, the owner's policy quizzes with their Settings editor and staff ticks, five new lessons, the welcome sign-out step, and the confidentiality map steps), for 4895. The training builds batch (Nov 20, 2026) added 23 more (the API error wordings for the owner's policy quizzes, the lesson-quiz gate, lesson comments and team records), for 4918. The profile photos batch (Nov 21, 2026) added 43 more (the profile photo card and the owner's approval card, the owner's display name, the plans line, five API error wordings, and the two profile-photo lessons), for 4961. The direct-deposit batch (Nov 21, 2026) added 31 more (the signature step + sealed form, both correction doors, the member's details-on-file card, the pay-stub print door, three API error wordings, and the owner lesson's fifth step), for 4992. The rider batch (Nov 21, 2026) added 6 more (the owner’s own details-on-file card with its edit door, the viewer’s own Payroll view, and two API error wordings), for 4998. The founding-tester comp batch (Nov 21, 2026) added 9 more (the founding-tester plan status + no-charge note, the Subscribe card, the Upgrade intro + note, and the four operator-list API wordings), for 5007. The clock build (Nov 21, 2026) added 44 more (the staff.clock tick + area + hint, the call-in gate and window, the missed clock-out flag, the Staff call-ins card and fix-times dialog, seven API error wordings, and the call-ins and clock corrections lesson), for 5051.
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
    setLocale('en-GB');
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
