/**
 * T6 — brand theme (src/lib/brandTheme.js): the owed color-picker check.
 *
 * Before T6 the picker saved `brand_color` and nothing ever read it.
 * These tests prove the color actually becomes the theme: the hex
 * converts to HSL variables, and applying it writes a style tag with
 * both the light and the dark values — so dark mode keeps working.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hexToHsl,
  brandThemeVars,
  brandThemeCss,
  applyBrandColor,
  clearBrandColor,
  resolveBrandColor,
  DEFAULT_BRAND_COLOR,
  LEGACY_DEFAULT_BRAND_COLOR,
} from './brandTheme.js';

function fakeDocument() {
  const tags = [];
  const head = { appendChild: (tag) => tags.push(tag) };
  return {
    head,
    tags,
    querySelector: () => tags[0] ?? null,
    createElement: () => ({
      setAttribute: () => {},
      textContent: '',
      remove: function () {
        const at = tags.indexOf(this);
        if (at >= 0) tags.splice(at, 1);
      },
    }),
  };
}

test('hex converts to HSL (the forest default)', () => {
  assert.deepEqual(hexToHsl('#145042'), { h: 166, s: 60, l: 20 });
  assert.deepEqual(hexToHsl('#FFFFFF'), { h: 0, s: 0, l: 100 });
  assert.deepEqual(hexToHsl('#000000'), { h: 0, s: 0, l: 0 });
  assert.equal(hexToHsl('not-a-color'), null);
  assert.equal(hexToHsl('#12345'), null);
  assert.equal(hexToHsl(''), null);
});

test('the picker color becomes the primary + ring variables', () => {
  // Clay (#7d4b34): h=19, s=41 — the saved color lands in --primary, not a default.
  const vars = brandThemeVars('#7d4b34');
  assert.equal(vars.light['--primary'], '19 41% 35%');
  assert.equal(vars.light['--ring'], vars.light['--primary']);
  assert.ok(vars.light['--sidebar-background']);
  // Dark values lift the lightness so the same hue reads on dark.
  const lightL = Number(vars.light['--primary'].split(' ')[2].replace('%', ''));
  const darkL = Number(vars.dark['--primary'].split(' ')[2].replace('%', ''));
  assert.ok(darkL > lightL);
  assert.equal(brandThemeVars('nope'), null);
});

test('applying a color writes one style tag with light AND dark rules', () => {
  const doc = fakeDocument();
  assert.equal(applyBrandColor('#7d4b34', doc), true);
  assert.equal(doc.tags.length, 1);
  const css = doc.tags[0].textContent;
  assert.match(css, /:root\{--primary:/);
  assert.match(css, /\.dark\{--primary:/);
  // Applying a second color refreshes the same tag — never two tags.
  assert.equal(applyBrandColor('#145042', doc), true);
  assert.equal(doc.tags.length, 1);
  assert.match(doc.tags[0].textContent, /--primary:166 60% 20%/);
});

test('an invalid color clears the overrides back to the defaults', () => {
  const doc = fakeDocument();
  applyBrandColor('#7d4b34', doc);
  assert.equal(doc.tags.length, 1);
  assert.equal(applyBrandColor('not-a-color', doc), false);
  assert.equal(doc.tags.length, 0);
  assert.equal(clearBrandColor(doc), false);
  assert.equal(applyBrandColor('#145042', null), false);
});

test('the stylesheet text is empty for an invalid color', () => {
  assert.equal(brandThemeCss('nope'), '');
  assert.match(brandThemeCss('#145042'), /--sidebar-background:/);
});

/**
 * The default-color ruling (Nov 14, 2026): the old silent default was
 * a deep teal (#145042) that re-skinned the signed-in shell — bright
 * mint in dark mode. A deep-bronze replacement (#6d4c26) shipped the
 * same morning, but through the derivation it painted a solid brown
 * band and brown buttons, and the owner rejected it on sight: the
 * default is the ORIGINAL look from her Base44 app — warm cream,
 * charcoal ink, tan pills. That look already exists as the
 * stylesheet's approved theme in src/index.css, so the default color
 * is that theme's cream-tan #E3D5BF and it produces NO override at
 * all. It applies ONLY to workspaces that never chose a color: the
 * white-label rule is that a business's own branding always wins,
 * exactly as saved.
 */
test('the default brand color is the approved cream-tan, and it is not an override', () => {
  assert.equal(DEFAULT_BRAND_COLOR, '#e3d5bf');
  // No variables, no stylesheet: the app's approved theme rules.
  assert.equal(brandThemeVars(DEFAULT_BRAND_COLOR), null);
  assert.equal(brandThemeVars('#E3D5BF'), null);
  assert.equal(brandThemeCss(DEFAULT_BRAND_COLOR), '');
  // The pin tying the default to the stylesheet: the approved block
  // in src/index.css pins --primary to the #E3D5BF values, both modes.
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  assert.match(css, /--primary: 36\.67 39\.13% 81\.96%/);
  assert.match(css, /--sidebar-background: 36\.67 39\.13% 81\.96%/);
});

test('applying the resolved default clears any override — the cream theme rules', () => {
  const doc = fakeDocument();
  // A merchant color is in force...
  assert.equal(applyBrandColor('#7d4b34', doc), true);
  assert.equal(doc.tags.length, 1);
  // ...then the workspace resolves to the default (no branding of its
  // own — unset, or a row still holding the retired teal): the tag
  // goes away and the app's own cream theme takes over, both modes.
  assert.equal(applyBrandColor(resolveBrandColor(''), doc), false);
  assert.equal(doc.tags.length, 0);
  assert.equal(applyBrandColor(resolveBrandColor('#145042'), doc), false);
  assert.equal(doc.tags.length, 0);
});

test('resolveBrandColor: unset and the legacy teal default land on the cream-tan default', () => {
  assert.equal(LEGACY_DEFAULT_BRAND_COLOR, '#145042');
  assert.equal(resolveBrandColor(null), DEFAULT_BRAND_COLOR);
  assert.equal(resolveBrandColor(''), DEFAULT_BRAND_COLOR);
  assert.equal(resolveBrandColor(undefined), DEFAULT_BRAND_COLOR);
  assert.equal(resolveBrandColor('#145042'), DEFAULT_BRAND_COLOR);
  assert.equal(resolveBrandColor('#145042'.toUpperCase()), DEFAULT_BRAND_COLOR);
});

test('resolveBrandColor: a color the business chose passes through untouched', () => {
  // Including other greens — choosing green is a merchant's right;
  // only the one silent default hex is treated as "never chosen".
  assert.equal(resolveBrandColor('#1d3b2a'), '#1d3b2a');
  assert.equal(resolveBrandColor('#7D4B34'), '#7d4b34');
  assert.equal(resolveBrandColor('#22303a'), '#22303a');
  assert.equal(resolveBrandColor('#b03060'), '#b03060');
});
