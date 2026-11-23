/**
 * Release 346 — REGIONAL ENGLISH LEGAL PAGES (Nov 22, 2026).
 *
 * The owner ordered this after release 343: the four regional
 * Englishes (en-GB, en-CA, en-AU, en-IN) read the US-English legal
 * bodies. Each variant now carries its OWN edition of all three
 * legal pages (12 files in src/lib/policies/), derived from the
 * current English sources — Subscription at version 2026-11-22-v6
 * including the owner-approved §6 — with ONLY spelling and date
 * presentation adapted to each variant's own standard:
 *   - all four: canceled->cancelled, canceling->cancelling,
 *     honor->honour;
 *   - en-GB/en-AU/en-IN: the authorize family in -ise forms, dates
 *     as 'D Month YYYY';
 *   - en-CA: authorize family keeps -ize (Canadian Oxford), dates
 *     keep the Canadian prose style 'Month D, YYYY'.
 * No clause added, softened or dropped; the entity name stays
 * exact; version/date metadata mirrors the English source.
 *
 * Pins:
 *   (1) all 12 editions registered; hasPolicyTranslation true for
 *       exactly the four variants x three kinds, false for 'en';
 *   (2) getPolicyDocument serves each variant's own body with
 *       translated: true; base 'en' still serves the US document
 *       itself, translated: false;
 *   (3) the DIFF-AUDIT: applying the inverse of the sanctioned
 *       token set to every prose string of a variant reproduces
 *       the English source byte-for-byte — the editions differ
 *       ONLY in spelling/formatting tokens;
 *   (4) skeletons (section ids, counts, paragraph counts) and
 *       frozen furniture (id, version, status, owner, application)
 *       identical; entity name exact at every occurrence;
 *   (5) spot pins: en-GB Subscription §6 says 'cancelled' where
 *       the US §6 says 'canceled'; en-GB effectiveDate reads
 *       '9 November 2026'; en-CA keeps 'November 9, 2026' and the
 *       -ize forms; every variant's Subscription version is
 *       '2026-11-22-v6'.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  POLICY_KINDS,
  getPolicyDocument,
  hasPolicyTranslation,
} from '../../src/lib/policyTranslations.js';
import { STOCKHAVEN_TERMS_OF_SERVICE } from '../../src/lib/stockhavenTermsOfService.js';
import { STOCKHAVEN_SUBSCRIPTION_POLICY } from '../../src/lib/stockhavenSubscriptionPolicy.js';
import { STOCKHAVEN_PRIVACY_POLICY } from '../../src/lib/stockhavenPrivacyPolicy.js';

const ENGLISH = {
  terms: STOCKHAVEN_TERMS_OF_SERVICE,
  subscription: STOCKHAVEN_SUBSCRIPTION_POLICY,
  privacy: STOCKHAVEN_PRIVACY_POLICY,
};
const VARIANTS = ['en-GB', 'en-CA', 'en-AU', 'en-IN'];
const CONFIG = {
  'en-GB': { ise: true, dates: true },
  'en-CA': { ise: false, dates: false },
  'en-AU': { ise: true, dates: true },
  'en-IN': { ise: true, dates: true },
};

const INV_COMMON = [
  ['Cancelled', 'Canceled'], ['cancelled', 'canceled'],
  ['Cancelling', 'Canceling'], ['cancelling', 'canceling'],
  ['Honour', 'Honor'], ['honour', 'honor'],
];
const INV_ISE = [
  ['Authorisation', 'Authorization'], ['authorisation', 'authorization'],
  ['Unauthorised', 'Unauthorized'], ['unauthorised', 'unauthorized'],
  ['Authorising', 'Authorizing'], ['authorising', 'authorizing'],
  ['Authorised', 'Authorized'], ['authorised', 'authorized'],
  ['Authorise', 'Authorize'], ['authorise', 'authorize'],
];
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const INV_DATE_RE = new RegExp(`\\b(\\d{1,2}) (${MONTHS}),? (\\d{4})\\b`, 'g');

function invert(text, cfg) {
  let out = text;
  const pairs = cfg.ise ? [...INV_COMMON, ...INV_ISE] : INV_COMMON;
  for (const [from, to] of pairs) out = out.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  if (cfg.dates) out = out.replace(INV_DATE_RE, '$2 $1, $3');
  return out;
}

const FURNITURE = ['id', 'version', 'status', 'owner', 'application'];
function proseStrings(doc) {
  const out = [];
  for (const [k, val] of Object.entries(doc)) {
    if (k === 'sections') {
      for (const s of val) { out.push(s.title); out.push(...s.paragraphs); }
    } else if (typeof val === 'string' && !FURNITURE.includes(k)) {
      out.push(val);
    }
  }
  return out;
}

test('all 12 regional editions are registered; base en is not', () => {
  for (const kind of POLICY_KINDS) {
    for (const code of VARIANTS) {
      assert.equal(hasPolicyTranslation(kind, code), true, `${kind}/${code} not registered`);
      const { document, translated } = getPolicyDocument(kind, code);
      assert.equal(translated, true, `${kind}/${code} should serve its own edition`);
      assert.notEqual(document, ENGLISH[kind], `${kind}/${code} should not be the US document object`);
    }
    assert.equal(hasPolicyTranslation(kind, 'en'), false, `${kind}/en must stay unregistered`);
    const base = getPolicyDocument(kind, 'en');
    assert.equal(base.translated, false);
    assert.equal(base.document, ENGLISH[kind], `${kind}/en should be the US document itself`);
  }
});

test('diff-audit: each edition differs from its source ONLY in sanctioned tokens', () => {
  for (const kind of POLICY_KINDS) {
    const source = ENGLISH[kind];
    for (const code of VARIANTS) {
      const cfg = CONFIG[code];
      const { document } = getPolicyDocument(kind, code);
      // Skeleton identical.
      assert.equal(document.sections.length, source.sections.length, `${kind}/${code} section count`);
      document.sections.forEach((s, i) => {
        assert.equal(s.id, source.sections[i].id, `${kind}/${code} section ${i} id`);
        assert.equal(s.paragraphs.length, source.sections[i].paragraphs.length, `${kind}/${code} section ${s.id} paragraph count`);
      });
      // Frozen furniture identical outright.
      for (const k of FURNITURE) assert.equal(document[k], source[k], `${kind}/${code} furniture ${k}`);
      // Prose: inverse-adapted variant == source, string by string.
      const vs = proseStrings(document); const ss = proseStrings(source);
      assert.equal(vs.length, ss.length, `${kind}/${code} prose string count`);
      vs.forEach((s, i) => assert.equal(invert(s, cfg), ss[i], `${kind}/${code} prose string ${i} differs beyond sanctioned tokens`));
      // Entity name exact at every occurrence.
      const inVariant = (JSON.stringify(document).match(/The Luminous Book Shop, LLC/g) || []).length;
      const inSource = (JSON.stringify(source).match(/The Luminous Book Shop, LLC/g) || []).length;
      assert.equal(inVariant, inSource, `${kind}/${code} entity occurrences`);
      assert.ok(inVariant > 0, `${kind}/${code} entity name missing`);
    }
  }
});

test('spot pins: British body in en-GB, Canadian restraint in en-CA, metadata mirrored', () => {
  const gb = getPolicyDocument('subscription', 'en-GB').document;
  const us = ENGLISH.subscription;
  const gbFailed = gb.sections.find((s) => s.id === 'failed-payments');
  const usFailed = us.sections.find((s) => s.id === 'failed-payments');
  assert.ok(gbFailed.paragraphs.join(' ').includes('cancelled'), 'en-GB §6 should say cancelled');
  assert.ok(!gbFailed.paragraphs.join(' ').includes(' canceled'), 'en-GB §6 should not say canceled');
  assert.ok(usFailed.paragraphs.join(' ').includes('canceled'), 'US §6 keeps canceled');
  assert.equal(gb.effectiveDate, '9 November 2026');
  assert.equal(gb.lastReviewed, '22 November 2026');
  assert.equal(us.effectiveDate, 'November 9, 2026');

  const ca = getPolicyDocument('subscription', 'en-CA').document;
  assert.equal(ca.effectiveDate, 'November 9, 2026', 'en-CA keeps the Canadian prose date style');
  assert.ok(ca.introduction.includes('authorizing'), 'en-CA keeps -ize (Canadian Oxford)');
  assert.ok(ca.sections.find((s) => s.id === 'failed-payments').paragraphs.join(' ').includes('cancelled'),
    'en-CA §6 doubles the l like the other variants');

  for (const code of VARIANTS) {
    for (const kind of POLICY_KINDS) {
      const { document } = getPolicyDocument(kind, code);
      assert.equal(document.version, ENGLISH[kind].version, `${kind}/${code} version mirrors source`);
      assert.equal(document.owner, 'The Luminous Book Shop, LLC', `${kind}/${code} entity exact`);
    }
    assert.equal(getPolicyDocument('subscription', code).document.version, '2026-11-22-v6',
      `${code} Subscription stays at the owner-approved v6`);
  }
});
