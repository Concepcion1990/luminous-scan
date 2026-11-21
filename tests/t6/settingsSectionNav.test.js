/**
 * T6 — Settings section ribbon pins (Nov 20, 2026):
 *  - On mobile widths the Settings page carries a ribbon of
 *    chips across the top — the owner's pick was "Ribbon of
 *    chips across the top" — one chip per section card ON THE
 *    VIEWER'S OWN PAGE (no doors to nowhere): the owner's
 *    ribbon lists the owner's sections, a member's ribbon
 *    lists exactly the sections their personal Settings
 *    renders, owner-granted sections included.
 *  - Chip labels reuse the sections' own heading strings, so
 *    the build adds ZERO new locale keys; every label key it
 *    names must already exist in the English source.
 *  - Tapping a chip smooth-scrolls the section into view with
 *    an offset that clears the sticky app header and the
 *    ribbon itself. The ribbon is lg:hidden — the boundary
 *    the app's mobile chrome uses — so wider layouts are
 *    untouched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nav = readFileSync(
  new URL('../../src/components/business/SettingsSectionNav.jsx', import.meta.url),
  'utf8',
);
const boss = readFileSync(
  new URL('../../src/pages/Settings.jsx', import.meta.url),
  'utf8',
);
const personal = readFileSync(
  new URL('../../src/components/business/PersonalSettings.jsx', import.meta.url),
  'utf8',
);
const policiesCard = readFileSync(
  new URL('../../src/components/business/BusinessPoliciesCard.jsx', import.meta.url),
  'utf8',
);
const en = readFileSync(
  new URL('../../src/lib/locales/en.js', import.meta.url),
  'utf8',
);

const sectionIdsIn = (source) => {
  const start = source.indexOf('const sections = [');
  assert.ok(start >= 0, 'a sections array exists');
  const end = source.indexOf('];', start);
  return [...source.slice(start, end).matchAll(/id: '(settings-sec-[a-z0-9-]+)'/g)].map((m) => m[1]);
};

test('ribbon: a sticky, mobile-only nav of chips labelled by the sections’ own keys', () => {
  assert.ok(nav.includes('lg:hidden'), 'the ribbon exists only below the lg boundary');
  assert.ok(nav.includes('sticky'), 'the ribbon pins across the top of the page');
  assert.ok(nav.includes('overflow-x-auto'), 'the ribbon scrolls sideways');
  assert.ok(nav.includes('{t(labelKey)}'), 'chip labels render through t(labelKey)');
  assert.ok(nav.includes("t('settings.title')"), 'the nav is labelled with the page’s own title string');
});

test('ribbon: a chip tap smooth-scrolls its section, clearing the sticky header and the ribbon', () => {
  assert.ok(nav.includes('document.getElementById(id)'), 'the tap resolves the section by its anchor id');
  assert.ok(nav.includes("behavior: 'smooth'"), 'the scroll is smooth');
  assert.ok(nav.includes('getBoundingClientRect().height'), 'the offset measures the live header and ribbon heights');
  assert.ok(nav.includes('window.scrollTo'), 'the window is the scroller');
});

test('boss ribbon: exactly the owner’s sections, in render order', () => {
  assert.deepEqual(sectionIdsIn(boss), [
    'settings-sec-businesses',
    'settings-sec-profile',
    'settings-sec-identity',
    'settings-sec-details',
    'settings-sec-policies',
    'settings-sec-plan',
    'settings-sec-security',
    'settings-sec-support',
    'settings-sec-install',
    'settings-sec-readiness',
    'settings-sec-dry-run',
    'settings-sec-subscription',
    'settings-sec-appearance',
    'settings-sec-delete',
    'settings-sec-software',
  ]);
  assert.ok(boss.includes('<SettingsSectionNav sections={sections} />'), 'the boss page renders the ribbon');
  // Every chip has its anchor on the page, and nothing else is anchored.
  for (const id of sectionIdsIn(boss)) {
    assert.ok(boss.includes(`<div id="${id}">`), `boss anchor ${id} exists`);
  }
  assert.equal(boss.split('id="settings-sec-').length - 1, 15, 'no stray section anchors'); // 14 through the settings ribbon batch (Nov 20, 2026); the profile photos batch (Nov 21, 2026) added the profile section, for 15.
});

test('boss ribbon: the publisher diagnostics ride the same condition that renders them', () => {
  const start = boss.indexOf('const sections = [');
  const end = boss.indexOf('];', start);
  const array = boss.slice(start, end);
  assert.ok(array.includes('...(canShowPrivateBillingDiagnostics'), 'diagnostic chips are conditional');
  assert.ok(array.indexOf('canShowPrivateBillingDiagnostics') < array.indexOf('settings-sec-readiness'));
});

test('member ribbon: exactly the personal sections, grants and policies gated like the cards', () => {
  assert.deepEqual(sectionIdsIn(personal), [
    'settings-sec-profile',
    'settings-sec-security',
    'settings-sec-appearance',
    'settings-sec-business',
    'settings-sec-policies',
    'settings-sec-granted-details',
    'settings-sec-granted-tax',
    'settings-sec-granted-gs1',
    'settings-sec-support',
    'settings-sec-platform-policies',
    'settings-sec-install',
    'settings-sec-software',
  ]);
  assert.ok(personal.includes('<SettingsSectionNav sections={sections} />'), 'the member page renders the ribbon');
  for (const id of sectionIdsIn(personal)) {
    assert.ok(personal.includes(`id="${id}"`), `member anchor ${id} exists`);
  }
  assert.equal(personal.split('id="settings-sec-').length - 1, 12, 'no stray section anchors'); // 11 through the settings ribbon batch (Nov 20, 2026); the profile photos batch (Nov 21, 2026) added the profile section, for 12.
  // The granted chips are spread in under the same grants that render the cards.
  assert.ok(personal.includes("...(canTaxRate"), 'the tax chip follows the tax grant');
  assert.ok(personal.includes("...(canGs1"), 'the GS1 chip follows the GS1 grant');
  assert.ok(personal.includes('...(canName || canDetails || canContact'), 'the details chip follows the details grants');
  // The policies chip follows the policies card's own visibility report.
  assert.ok(personal.includes('...(policiesVisible'), 'the policies chip follows the card’s visibility');
  assert.ok(personal.includes('onVisibilityChange={setPoliciesVisible}'), 'the card reports its visibility');
});

test('policies card: reports the same emptiness that removes it', () => {
  assert.ok(policiesCard.includes('onVisibilityChange'), 'the card accepts the visibility callback');
  assert.ok(
    policiesCard.includes("docs.policies.kind === 'empty' && docs.terms.kind === 'empty'"),
    'the hidden state is the both-documents-empty condition',
  );
  assert.ok(policiesCard.includes('onVisibilityChange?.(!hidden)'), 'visibility is reported, not assumed');
});

test('zero new keys: every label the ribbon names already exists in the English source', () => {
  const labelKeys = new Set();
  for (const source of [boss, personal]) {
    const start = source.indexOf('const sections = [');
    const end = source.indexOf('];', start);
    for (const m of source.slice(start, end).matchAll(/labelKey: '([a-zA-Z0-9.]+)'/g)) labelKeys.add(m[1]);
  }
  labelKeys.add('settings.title');
  assert.ok(labelKeys.size >= 18, 'the ribbons name their labels');
  for (const key of labelKeys) {
    assert.ok(
      en.includes(`'${key}':`) || en.includes(`"${key}":`),
      `label key ${key} already exists in the English source`,
    );
  }
});
