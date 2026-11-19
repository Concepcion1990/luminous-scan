/**
 * T35 — The GS1 learn-more doors in Settings (the owner's
 * commission, Nov 18, 2026): under the GS1 company prefix
 * explanation, a link to the GS1 organisation for the reader's
 * OWN country, and — for every country other than the US — the
 * GS1 US link underneath it too (the person may have switched
 * their app language but actually live in the US). A plain
 * sentence beside the links says which one to use. Countries
 * with no GS1 member organisation fall back to the global GS1
 * site as their door. Links open in a new tab; the prefix
 * field's own behavior is untouched.
 *
 * Three new strings (settings.details.gs1LearnMore,
 * settings.details.gs1LearnMoreUs, settings.details.
 * gs1GlobalSite), genuinely translated in all 52 locales; the
 * products-find-edit lesson's GS1 step (step 10) teaches the
 * doors in all 52.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LOCALES, SUPPORTED_LOCALES } from '../../src/lib/i18n.js';
import {
  GS1_BY_COUNTRY,
  GS1_GLOBAL_URL,
  GS1_US_LINK,
  LOCALE_COUNTRY,
  gs1LinksForLocale,
} from '../../src/lib/gs1Links.js';

const NEW_KEYS = [
  'settings.details.gs1LearnMore',
  'settings.details.gs1LearnMoreUs',
  'settings.details.gs1GlobalSite',
];
const STEP_KEY = 'training.lessons.products-find-edit.step10';

test('every supported locale resolves to a country', () => {
  assert.equal(SUPPORTED_LOCALES.length, 52);
  for (const code of SUPPORTED_LOCALES) {
    assert.ok(LOCALE_COUNTRY[code], `${code}: no country resolution`);
  }
});

test('every locale gets an own-country door; only the US stands alone', () => {
  for (const code of SUPPORTED_LOCALES) {
    const links = gs1LinksForLocale(code);
    assert.match(links.own.url, /^https:\/\//, `${code}: own link is not https`);
    if (links.country === 'US') {
      assert.equal(links.own.url, GS1_US_LINK.url, `${code}: US reader's own door is GS1 US`);
      assert.equal(links.us, null, `${code}: US reader gets no duplicate US link`);
    } else {
      assert.deepEqual(links.us, GS1_US_LINK, `${code}: non-US reader also gets the GS1 US link`);
    }
    if (links.own.global) {
      assert.equal(links.own.url, GS1_GLOBAL_URL, `${code}: fallback door is the global GS1 site`);
      assert.equal(links.own.name, null, `${code}: fallback door takes its label from the locale`);
    } else {
      assert.ok(links.own.name?.startsWith('GS1'), `${code}: member door carries the organisation name`);
    }
  }
});

test('the countries she named land on their real GS1 homes', () => {
  assert.equal(gs1LinksForLocale('es-MX').own.url, 'https://www.gs1mexico.org/');
  assert.equal(gs1LinksForLocale('es-MX').own.name, 'GS1 Mexico');
  assert.equal(gs1LinksForLocale('es-ES').own.url, 'https://www.gs1es.org/');
  assert.equal(gs1LinksForLocale('en').own.url, 'https://www.gs1us.org/');
  assert.equal(gs1LinksForLocale('en-GB').own.url, 'https://www.gs1uk.org/');
  assert.equal(gs1LinksForLocale('fr-CA').own.url, 'https://www.gs1ca.org/');
  assert.equal(gs1LinksForLocale('zh-Hant').own.url, 'https://www.gs1tw.org/');
  assert.equal(gs1LinksForLocale('yue').own.url, 'https://www.gs1hk.org/');
  // Puerto Rico has no member organisation of its own — GS1 US serves it.
  assert.equal(gs1LinksForLocale('es-PR').country, 'US');
  assert.equal(gs1LinksForLocale('es-PR').us, null);
});

test('countries with no GS1 member organisation fall back to the global site', () => {
  for (const code of ['am', 'bn', 'prs']) {
    const links = gs1LinksForLocale(code);
    assert.equal(links.own.global, true, `${code}: expected the global fallback`);
    assert.equal(links.own.url, GS1_GLOBAL_URL);
    assert.deepEqual(links.us, GS1_US_LINK, `${code}: the US link still shows underneath`);
  }
});

test('every member-organisation URL is a distinct https address', () => {
  const urls = Object.values(GS1_BY_COUNTRY).map((m) => m.url);
  for (const url of urls) assert.match(url, /^https:\/\/www\.gs1/);
  assert.equal(new Set(urls).size, urls.length);
});

test('all 52 locales carry the three new strings, genuinely worded', () => {
  for (const [code, dict] of Object.entries(LOCALES)) {
    for (const key of NEW_KEYS) {
      assert.equal(typeof dict[key], 'string', `${code}: ${key} missing`);
      assert.ok(dict[key].trim().length > 0, `${code}: ${key} empty`);
    }
    assert.ok(dict['settings.details.gs1LearnMore'].includes('GS1 US'), `${code}: learn-more sentence names GS1 US`);
    assert.ok(dict['settings.details.gs1LearnMoreUs'].includes('GS1 US'), `${code}: US sentence names GS1 US`);
    assert.ok(dict['settings.details.gs1GlobalSite'].startsWith('GS1'), `${code}: global label names GS1`);
    // The lesson's GS1 step teaches the doors in every locale:
    // the appended sentence names GS1 US, which the step's
    // original text never did.
    assert.ok(dict[STEP_KEY].includes('GS1 US'), `${code}: step10 append missing`);
  }
});

test('the Settings card renders the doors under the prefix hint, new tab', () => {
  const src = fs.readFileSync(
    new URL('../../src/components/business/DetailsCard.jsx', import.meta.url),
    'utf8',
  );
  assert.ok(src.includes('gs1LinksForLocale'), 'card resolves the links from the live locale');
  assert.ok(src.includes("t('settings.details.gs1PrefixHint')"), 'hint still renders');
  assert.ok(
    src.indexOf('gs1LearnMore') > src.indexOf("t('settings.details.gs1PrefixHint')"),
    'the doors render under the explanation',
  );
  assert.ok(src.includes('settings.details.gs1LearnMoreUs'), 'US sentence wired');
  assert.ok(src.includes('settings.details.gs1GlobalSite'), 'global label wired');
  const anchors = src.match(/target="_blank"/g) || [];
  assert.ok(anchors.length >= 2, 'both doors open in a new tab');
});
