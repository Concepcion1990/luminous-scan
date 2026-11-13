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
import { hexToHsl, brandThemeVars, brandThemeCss, applyBrandColor, clearBrandColor } from './brandTheme.js';

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
