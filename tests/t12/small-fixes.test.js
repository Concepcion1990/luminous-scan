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
];

test('keyset parity holds across all 52 locale files with the two new keys counted', () => {
  const enKeys = Object.keys(en).sort();
  // 3510 at the small-fixes batch; the recovery kit added 65 keys
  // (50 UI + 15 training) for 3575; send-PO added 15 more (5 UI +
  // 10 training) for 3595; the delete warning added 2 more for 3597;
  // rewards added 67 more (46 UI + 21 training) for 3664;
  // POS added 85 more (54 UI + 31 training) for 3749; the POS gate added 5 more, for 3754; plans parity added 14 more, for 3768; in-app problem reporting added 36 more (21 UI + 15 training), for 3804; the front-door fixes added 7 more (2 subscribe chooser + 5 reset code entry), for 3811.
  assert.equal(enKeys.length, 3811);
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
