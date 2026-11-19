// Mobile nav fix (Nov 18, 2026): the bottom tab bar vanished from
// the owner's phone on every main page. Root cause: the lesson
// visuals' embed flag lives in sessionStorage, which a tab SHARES
// with its same-origin frames — a framed lesson picture planted
// the flag in the owner's own tab store, and her top-level app
// then read itself as a picture and hid its bar for the life of
// the tab. Pins: embed is a property of the FRAME (a top-level
// document is never trimmed, whatever the store says; a framed
// document still is, including across in-frame navigation), and
// the shell keeps the bar + the shortened, self-scrolling
// All screens menu that ends above it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isEmbedVisual, visualUrl } from '../../src/lib/embedMode.js';

function stubWindow({ framed, search = '', planted = false }) {
  const store = new Map(planted ? [['sh.embedVisual', '1']] : []);
  const top = {};
  const self = framed ? {} : top;
  globalThis.window = {
    self,
    top,
    location: { search },
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  return store;
}

test('a top-level app is never an embed, even with the flag planted', () => {
  stubWindow({ framed: false, planted: true });
  assert.equal(isEmbedVisual(), false);
});

test('a top-level app opened on a visual URL is still the real app', () => {
  stubWindow({ framed: false, search: '?embed=visual' });
  assert.equal(isEmbedVisual(), false);
});

test('a framed page on a visual URL is an embed and plants the flag', () => {
  const store = stubWindow({ framed: true, search: '?embed=visual' });
  assert.equal(isEmbedVisual(), true);
  assert.equal(store.get('sh.embedVisual'), '1');
});

test('a framed page keeps the trim across in-frame navigation (flag, no param)', () => {
  stubWindow({ framed: true, planted: true });
  assert.equal(isEmbedVisual(), true);
});

test('a framed page without the param or the flag is not an embed', () => {
  stubWindow({ framed: true });
  assert.equal(isEmbedVisual(), false);
});

test('visualUrl still builds the framed lesson URL', () => {
  assert.equal(visualUrl('/settings'), '/settings?embed=visual');
  assert.equal(visualUrl('/orders?x=1'), '/orders?x=1&embed=visual');
});

test('embed detection carries the top-level guard in source', () => {
  const embed = readFileSync('src/lib/embedMode.js', 'utf8');
  assert.match(embed, /window\.self === window\.top/);
});

test('the shell renders the five-tab bar and the capped, self-scrolling menu', () => {
  const layout = readFileSync('src/components/Layout.jsx', 'utf8');
  assert.match(layout, /stockhaven-mobile-tabbar/);
  for (const path of ['/', '/scan', '/products', '/orders', '/settings']) {
    assert.ok(layout.includes(`'${path}'`), `tab path ${path} present`);
  }
  // The header is capped at the viewport minus the tab bar, and
  // the All screens menu is the flexible scrolling child, so its
  // last row can always scroll fully clear of the bar.
  assert.match(layout, /max-h-\[calc\(100dvh_-_4rem_-_env\(safe-area-inset-bottom\)\)\]/);
  assert.match(layout, /id="stockhaven-mobile-modules"/);
  assert.match(layout, /min-h-0 flex-1 overflow-y-auto/);
});
