/**
 * T12 — Small fixes batch (owner's decisions, Nov 12, 2026).
 *
 * Part 1: the same-email signpost. Subscribe and Register carry
 * `auth.sameEmailNotice` (shared SameEmailNotice component) so a
 * visitor who already has the phone app subscribes with the SAME
 * email — a different email starts a totally new, empty storefront.
 * The text shipped in English in every locale (translation-debt
 * convention); translation tranches retire the debt locale by
 * locale — TRANCHE_1_LOCALES below tracks the locales whose pass
 * has landed, and these tests pin both states.
 *
 * Part 2: the translated Delete Account confirmation word. The
 * confirmation is per-locale via `settings.deleteConfirmWord`:
 * English accepts DELETE, every other language accepts ONLY its own
 * word (es-MX: ELIMINAR, fr-FR: SUPPRIMER), matched trimmed and
 * case-insensitively with the locale's own case rules. The prompt
 * strings keep their existing translations and interpolate the word
 * through the {word} placeholder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOCALES,
  SUPPORTED_LOCALES,
  t,
  setLocale,
  deleteConfirmWord,
  matchesDeleteConfirm,
} from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8');

const NOTICE_TEXT = 'Already have our app from Google Play or the App Store? Use the same email here — the one you sign into the app with — so your shop and your inventory come with you. A different email starts a totally new, empty storefront.';

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

test('keyset parity holds across all 52 locale files with the two new keys counted', () => {
  const enKeys = Object.keys(en).sort();
  // 3510 at the small-fixes batch; the recovery kit added 65 keys
  // (50 UI + 15 training) for 3575; send-PO added 15 more (5 UI +
  // 10 training) for 3595; the delete warning added 2 more for 3597;
  // rewards added 67 more (46 UI + 21 training) for 3664;
  // POS added 85 more (54 UI + 31 training) for 3749; the POS gate added 5 more, for 3754; plans parity added 14 more, for 3768; in-app problem reporting added 36 more (21 UI + 15 training), for 3804; the front-door fixes added 7 more (2 subscribe chooser + 5 reset code entry), for 3811; the cross-store transfer door added 19 more (14 UI + 5 training), for 3830; clearance + rollback pricing added 27 more (17 UI/plans + 10 training), for 3857; shipping labels added 18 more (8 UI/plans + 10 training), for 3875; the POS provider expansion + deletion-request batch added 79 more (44 UI + 35 training), for 3954; the account-security batch (change password + owner-sent staff reset) added 14 more, for 3968; the white-label reset-clarification step added 1 more, for 3981; the locations/orders train added 13 more (2 location keys, 7 ship-to keys, 4 lifecycle/address-book keys), for 3994. The edit-quantity batch (Nov 14, 2026) added 2 more (the Edit form's quantity hint + the products-find-edit step 7 it teaches), for 3996. The photo-chooser batch (Nov 14, 2026) added 2 more (Take a photo / Choose from gallery), for 3998. The in-form scan batch (Nov 14, 2026) added 2 more (Scan code + the code-belongs-to-another-product notice), for 4000. The category-combobox batch (Nov 14, 2026) added 4 more (Add new category/subcategory + the typed-but-unmatched validation messages), for 4004. The product-delete batch (Nov 14, 2026) added 3 more (the menu's Delete label + the two plain-words confirmations), for 4007. The category-edit-door batch (Nov 14, 2026) added 2 more (Set category / Change category for the Inventory-by-category edit door), for 4009. The count-sheet scanner batch (Nov 14, 2026) added 1 more (the scanned product is not on this sheet notice), for 4010. The archived-freeze batch (Nov 14, 2026) added 2 more (the frozen-stock message + the products-find-edit step 8 it teaches), for 4012. The import cap-awareness batch (Nov 14, 2026) added 3 more (dry-run room line, would-not-fit count, not-imported note), for 4015. The receive-step batch (Nov 14, 2026) added 1 more (import-basics step 2, the Stock arrives at step), for 4016. The staged-import draft batch (Nov 14, 2026) added 1 more (the too-large-to-keep notice), for 4017. The training-invisibility batch (Nov 14, 2026) added 3 more (the owner-import lesson: title + 2 steps, its steps reusing the locale's own translated import text), for 4020. The carrier-label + document-style batch (Nov 14, 2026) added 46 more (18 carrier-label + 24 document-style UI keys, 1 plans line, 3 training steps), for 4099. The code-generator batch (Nov 15, 2026) added 13 more (11 productForm generate keys, 1 plans line, 1 training step), for 4112. The GS1-mode batch (Nov 15, 2026) added 10 more (6 productForm GS1 keys, 2 Settings prefix keys, 1 plans line, 1 training step), for 4122. The About bookshop-link addition (Nov 15, 2026) added 1 more (the About page’s bookstore lead-in), for 4123. The lesson-visual fix batch (Nov 15, 2026) added 2 more (the wide view’s See it full screen / Back to the lesson labels), for 4125. The carrier-door fix (Nov 15, 2026) added 1 more (the Upload button’s pick-an-order-first guidance), for 4126. The bulk-delete batch (Nov 15, 2026) added 12 more (11 bulk-delete UI keys + the products-find-edit step 11 it teaches), for 4138. The plan-lists batch (Nov 15, 2026) added 3 more (the bulk edit/delete plans line + the Mobile label-printing and Mobile training lines), for 4141. The full-app translation sweep batch (Nov 15, 2026) added 64 more (the About page, the notice block, legal-page chrome, the 404 page and the sweep stragglers, all ×52), for 4205. The leftovers sweep (Nov 15, 2026) added 419 more (the apiErrors.* API-error banner strings, x52), for 4624. The scan-to-tally batch (Nov 16, 2026) added 5 more (the scanTally.* strings shared by the count sheet, Scan Receive and the Add stock sheet), for 4629. The tracking-scan batch (Nov 18, 2026) added 1 more (orders.scanTracking — the scan button beside Tracking reference), for 4630. The order-form label-upload batch (Nov 18, 2026) added 3 more (orders.shippingLabel, orders.uploadLabel, orders.labelStagedNote — the form's own door onto the Print Center's label record), for 4633. The GS1 learn-more batch (Nov 18, 2026) added 3 more (settings.details.gs1LearnMore, settings.details.gs1LearnMoreUs, settings.details.gs1GlobalSite — the doors to your own country's GS1 and GS1 US under the prefix field), for 4636.
  assert.equal(enKeys.length, 5116); // The tax-automatic batch (Nov 22, 2026) added 10 more (the tax mode switch + its two options and hint, the three order-form automatic-tax hints, the plans line, and the new steps of the two tax lessons), for 5116. The invite hardening batch (Nov 22, 2026) added 5 more (the spent-invite-link refusal, the signed-in connected panel and its door, and the fifth steps of the two invite lessons), for 5106. The signup domain blocklist batch (Nov 22, 2026) added 4 more (the neutral signup refusal + the three operator domain-list wordings), for 5101. The failed-payment road batch (Nov 21, 2026) added 2 more (the past-due fix-by line + the owner-billing lesson's fifth step), for 5097. The staff-settings batch (Nov 19, 2026) added 57 more (personal Settings + enrollment grants + shift windows + welcome + install door + neutral stop + universal sign-out link + owner note), for 4693. The plan-presentation extension (Nov 19, 2026) added 7 more (the plansLib.includes lines for this batch, on Plans + Welcome + the in-app plan page alike), for 4700. //The money-surfaces audit additions (Nov 19, 2026) added 3 more (the Subscribe member card + the plan-neutral limit refusal), for 4703. The owner confidentiality lesson (Nov 19, 2026) added 5 more (title + 4 steps, owner track only), for 4708. The contact-details ruling (Nov 19, 2026) added 6 more (the address & phone tick + hint + the read-only business card), for 4714. The enrollment pay/contact batch (Nov 19, 2026) added 2 more (the member's home address + phone labels in the staff dialog), for 4716. The returns-approval gate (Nov 19, 2026) added 6 more (the returns.complete enrollment tick + its area heading + hint, the two waiting-for-approval notes and the API refusal wording), for 4740. The no-dangling-doors batch (Nov 19, 2026) added 3 more (the products.create enrollment tick + its area heading + hint), for 4743. The field-scanners batch (Nov 19, 2026) added 5 more (the ISBN digits reader: its title, hint, Read number button, reading line and plain refusal), for 4748. The add-location tick batch (Nov 19, 2026) added 4 more (the locations.create enrollment tick + its area heading + hint, and the add-a-location refusal wording), for 4752. The business-policies batch (Nov 19, 2026) added 34 more (the owner's own store policies + terms in Settings, the platform-policies card, the welcome showing, the plans line, the three policy API wordings, the owner store-policies lesson and the welcome-basics step, plus the two policy 404 wordings), for 4786. The staff-roster tick batch (Nov 19, 2026) added 3 more (the staff.roster enrollment tick + its area heading + hint), for 4789. The schedule-doors batch (Nov 20, 2026) added 3 more (the schedule card Clear button + the message composer character counter and limit note) and removed 1 (the inbox markRead label — the button is gone), for 4791. The low-stock ticks batch (Nov 20, 2026) added 6 more (the two Business low-stock enrollment ticks — alerts.view and products.reorder — with their area heading and hint, and the reorder-change and alerts-view refusal wordings), for 4797. The training builds batch (Nov 20, 2026) added 98 more (the per-lesson quizzes and comments, the owner's policy quizzes with their Settings editor and staff ticks, five new lessons, the welcome sign-out step, and the confidentiality map steps), for 4895. The training builds batch (Nov 20, 2026) added 23 more (the API error wordings for the owner's policy quizzes, the lesson-quiz gate, lesson comments and team records), for 4918. The profile photos batch (Nov 21, 2026) added 43 more (the profile photo card and the owner's approval card, the owner's display name, the plans line, five API error wordings, and the two profile-photo lessons), for 4961. The direct-deposit batch (Nov 21, 2026) added 31 more (the signature step + sealed form, both correction doors, the member's details-on-file card, the pay-stub print door, three API error wordings, and the owner lesson's fifth step), for 4992. The rider batch (Nov 21, 2026) added 6 more (the owner’s own details-on-file card with its edit door, the viewer’s own Payroll view, and two API error wordings), for 4998. The founding-tester comp batch (Nov 21, 2026) added 9 more (the founding-tester plan status + no-charge note, the Subscribe card, the Upgrade intro + note, and the four operator-list API wordings), for 5007. The clock build (Nov 21, 2026) added 44 more (the staff.clock tick + area + hint, the call-in gate and window, the missed clock-out flag, the Staff call-ins card and fix-times dialog, seven API error wordings, and the call-ins and clock corrections lesson), for 5051. The staff documents build (Nov 21, 2026) added 44 more (the staff.documents tick + area + hint, the red warning, the documents card and dialog, the plans line, five API error wordings, and the owner + manager staff-documents lessons), for 5095.
  assert.equal(SUPPORTED_LOCALES.length, 52);
  for (const code of SUPPORTED_LOCALES) {
    const keys = Object.keys(LOCALES[code]).sort();
    assert.deepEqual(keys, enKeys, `${code} keyset differs from en`);
    assert.ok(keys.includes('auth.sameEmailNotice'), `${code} missing auth.sameEmailNotice`);
    assert.ok(keys.includes('settings.deleteConfirmWord'), `${code} missing settings.deleteConfirmWord`);
  }
});

test('the same-email notice is the owner\u2019s exact text in English, interim English where no translation pass has landed', () => {
  assert.equal(en['auth.sameEmailNotice'], NOTICE_TEXT);
  for (const code of SUPPORTED_LOCALES) {
    if (TRANCHE_1_LOCALES.includes(code)) continue;
    assert.equal(LOCALES[code]['auth.sameEmailNotice'], NOTICE_TEXT, `${code} notice differs (English interim until its translation pass)`);
  }
  // Tranche 1 locales carry a real translation of the notice — a
  // non-empty string that is not the English text.
  for (const code of TRANCHE_1_LOCALES) {
    const value = LOCALES[code]['auth.sameEmailNotice'];
    assert.equal(typeof value, 'string', `${code} notice missing`);
    assert.ok(value.length > 0, `${code} notice empty`);
    assert.notEqual(value, NOTICE_TEXT, `${code} notice is still English after its translation pass`);
  }
});

test('Subscribe and Register both render the shared SameEmailNotice', () => {
  assert.ok(readSrc('src/components/SameEmailNotice.jsx').includes("t('auth.sameEmailNotice')"));
  assert.ok(readSrc('src/pages/Subscribe.jsx').includes('<SameEmailNotice'));
  assert.ok(readSrc('src/pages/Register.jsx').includes('<SameEmailNotice'));
});

test('every locale carries a real, non-empty confirmation word; English and its variants keep DELETE', () => {
  for (const code of SUPPORTED_LOCALES) {
    const word = LOCALES[code]['settings.deleteConfirmWord'];
    assert.equal(typeof word, 'string', code);
    assert.ok(word.trim().length > 0, code);
  }
  for (const code of ['en', 'en-GB', 'en-CA', 'en-AU', 'en-IN']) {
    assert.equal(LOCALES[code]['settings.deleteConfirmWord'], 'DELETE', code);
  }
  // Spot-check the one-word translations the owner will eyeball.
  assert.equal(LOCALES['es-MX']['settings.deleteConfirmWord'], 'ELIMINAR');
  assert.equal(LOCALES['fr-FR']['settings.deleteConfirmWord'], 'SUPPRIMER');
  assert.equal(LOCALES['de']['settings.deleteConfirmWord'], 'LÖSCHEN');
  assert.equal(LOCALES['ar']['settings.deleteConfirmWord'], 'حذف');
  assert.equal(LOCALES['ja']['settings.deleteConfirmWord'], '削除');
  assert.equal(LOCALES['pt-BR']['settings.deleteConfirmWord'], 'EXCLUIR');
  assert.equal(LOCALES['pt-PT']['settings.deleteConfirmWord'], 'ELIMINAR');
  assert.equal(LOCALES['tr']['settings.deleteConfirmWord'], 'SİL');
  assert.equal(LOCALES['ru']['settings.deleteConfirmWord'], 'УДАЛИТЬ');
});

test('matching: English accepts DELETE (any case, padded); other locales accept only their own word', () => {
  // English.
  assert.equal(deleteConfirmWord('en'), 'DELETE');
  assert.equal(matchesDeleteConfirm('DELETE', 'en'), true);
  assert.equal(matchesDeleteConfirm('delete', 'en'), true);
  assert.equal(matchesDeleteConfirm('  Delete  ', 'en'), true);
  assert.equal(matchesDeleteConfirm('DELET', 'en'), false);
  // Spanish (Mexico): ELIMINAR passes, the literal DELETE does not.
  assert.equal(deleteConfirmWord('es-MX'), 'ELIMINAR');
  assert.equal(matchesDeleteConfirm('ELIMINAR', 'es-MX'), true);
  assert.equal(matchesDeleteConfirm('eliminar', 'es-MX'), true);
  assert.equal(matchesDeleteConfirm('DELETE', 'es-MX'), false);
  assert.equal(matchesDeleteConfirm('delete', 'es-MX'), false);
  // French: SUPPRIMER passes, DELETE does not.
  assert.equal(deleteConfirmWord('fr-FR'), 'SUPPRIMER');
  assert.equal(matchesDeleteConfirm('SUPPRIMER', 'fr-FR'), true);
  assert.equal(matchesDeleteConfirm('supprimer', 'fr-FR'), true);
  assert.equal(matchesDeleteConfirm('DELETE', 'fr-FR'), false);
  // German + Turkish case folding follows the locale's own rules.
  assert.equal(matchesDeleteConfirm('löschen', 'de'), true);
  assert.equal(matchesDeleteConfirm('DELETE', 'de'), false);
  assert.equal(matchesDeleteConfirm('sil', 'tr'), true);
  assert.equal(matchesDeleteConfirm('SİL', 'tr'), true);
  // Empty / non-string input never confirms.
  assert.equal(matchesDeleteConfirm('', 'en'), false);
  assert.equal(matchesDeleteConfirm('   ', 'en'), false);
  assert.equal(matchesDeleteConfirm(null, 'en'), false);
  assert.equal(matchesDeleteConfirm(undefined, 'en'), false);
});

test('no locale prompt string keeps a literal DELETE; every one carries the {word} placeholder', () => {
  for (const code of SUPPORTED_LOCALES) {
    for (const key of ['settings.delete.enterDelete', 'settings.delete.dialogDescription']) {
      const value = LOCALES[code][key];
      assert.ok(value.includes('{word}'), `${code} ${key} missing {word}`);
      assert.ok(!/\bDELETE\b/.test(value), `${code} ${key} still contains literal DELETE`);
    }
  }
});

test('the prompts render the word of the active language', () => {
  try {
    setLocale('en');
    assert.equal(t('settings.delete.enterDelete', { word: deleteConfirmWord() }), 'Enter DELETE to confirm');
    setLocale('es-MX');
    assert.equal(t('settings.delete.enterDelete', { word: deleteConfirmWord() }), 'Escriba ELIMINAR para confirmar');
    const desc = t('settings.delete.dialogDescription', { word: deleteConfirmWord() });
    assert.ok(desc.includes('ELIMINAR'));
    assert.ok(!/\bDELETE\b/.test(desc));
    setLocale('fr-FR');
    assert.equal(t('settings.delete.enterDelete', { word: deleteConfirmWord() }), 'Saisissez SUPPRIMER pour confirmer');
  } finally {
    setLocale('en');
  }
});

test('Settings.jsx gates on the locale word, not the hard-coded literal', () => {
  const src = readSrc('src/pages/Settings.jsx');
  assert.ok(src.includes('matchesDeleteConfirm(deletionConfirmation)'));
  assert.ok(!src.includes("deletionConfirmation !== 'DELETE'"));
  assert.ok(src.includes("t('settings.delete.enterDelete', { word: confirmWord })"));
  assert.ok(src.includes("t('settings.delete.dialogDescription', { word: confirmWord })"));
});

test('bulk delete: red danger zone at the dialog bottom, boss-gated, two-step confirm (Nov 15, 2026)', () => {
  const dialog = readSrc('src/components/products/BulkEditDialog.jsx');
  // The danger zone renders after the footer — the very bottom of
  // the dialog, as the owner placed it.
  const footerAt = dialog.indexOf('</DialogFooter>');
  const dangerAt = dialog.indexOf("t('products.bulkDeleteTitle')");
  assert.ok(footerAt > -1 && dangerAt > footerAt, 'danger zone sits below the footer');
  assert.ok(dialog.includes('canDelete && products.length > 0'), 'boss gate + non-empty selection');
  assert.ok(dialog.includes('variant="destructive"'), 'the delete doors are red');
  assert.ok(dialog.includes("t('products.bulkDeleteButton'"), 'the button names the live selection');
  assert.ok(dialog.includes("t('products.bulkDeleteConfirmBody'"), 'the confirmation speaks before anything goes');
  assert.ok(dialog.includes('base44.entities.Product.delete(product.id)'), 'deletes run through the single-delete endpoint');
  const page = readSrc('src/pages/Products.jsx');
  assert.ok(page.includes('canDelete={isBoss(user, record)}'), 'the page passes the boss gate, same as the row Delete');
  assert.ok(page.includes("t('products.bulkDeleteFailed'"), 'partial failures are named in the result, never an all-clear');
});
