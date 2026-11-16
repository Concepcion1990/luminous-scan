/**
 * T35 — Public header Sign in door (the owner's ruling, Nov 16, 2026).
 *
 * The Welcome front door and the Compare Plans page each carry a clear
 * "Sign in" control at the TOP of the page, in the header beside the
 * language picker — a returning customer must not have to hunt for the
 * small link at the foot of the page. The door is a router link to
 * /login, labelled with the existing welcome.signIn key (already
 * translated in all 52 locales — zero new translation debt), styled as
 * an obvious pill (inverse of the header bar), and hidden once the
 * visitor is signed in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { en } from '../../src/lib/locales/en.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readSrc = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

function headerOf(rel) {
  const src = readSrc(rel);
  const start = src.indexOf('<header');
  const end = src.indexOf('</header>');
  assert.ok(start !== -1 && end > start, `${rel} has a header block`);
  return src.slice(start, end);
}

for (const [page, rel] of [
  ['Welcome', 'src/pages/Welcome.jsx'],
  ['Plans', 'src/pages/Plans.jsx'],
]) {
  test(`${page}: header carries a clear Sign in door to /login for signed-out visitors`, () => {
    const header = headerOf(rel);
    // Router link to the login page, labelled by the shared sign-in key.
    assert.match(header, /<Link\s+to="\/login"/, `${page} header links to /login`);
    assert.ok(
      header.includes("{t('welcome.signIn')}"),
      `${page} header labels the door with the existing welcome.signIn key`,
    );
    // An obvious door, not a sliver: a filled pill, inverse of the bar.
    assert.ok(
      header.includes('rounded-full bg-primary-foreground'),
      `${page} header sign-in is a filled pill`,
    );
    // Hidden once signed in (a signed-in customer is offered Log out,
    // never a redundant Sign in).
    assert.ok(
      header.includes('{!isAuthenticated && ('),
      `${page} header sign-in hides when authenticated`,
    );
  });
}

test('the sign-in label key already exists in English as "Sign in"', () => {
  assert.equal(en['welcome.signIn'], 'Sign in');
});
