import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUTH_PAGE_PATHS,
  isAuthPagePath,
  loginBounceTarget,
} from '../../src/lib/authReturnTo.js';

// Regression tests for the login redirect loop Concepcion hit on her
// phone on 2026-11-12: every public page strobed blank and ended in
// HTTP 431 for signed-out visitors.
//
// Root cause: three pieces compounded. App.jsx bounced signed-out
// visitors to login DURING RENDER for any path outside a small public
// allowlist — and /login, /register and "/" were not on it.
// AuthContext.navigateToLogin handed redirectToLogin the FULL
// window.location.href, query string and all, and redirectToLogin
// encoded that whole URL into ?returnTo=. On /login the gate fired
// again, wrapping the previous URL inside a new returnTo each hop, so
// the URL grew without bound until the server refused it (431).
//
// The fix: the bounce lives in a useEffect and fires only for
// genuinely protected paths; the auth pages and "/" never bounce;
// "/" lands a signed-out visitor once on /welcome; and the carried
// returnTo is a clean relative path produced by loginBounceTarget,
// which redirectToLogin enforces again as defense in depth.
//
// loginBounceTarget is pure in (value, origin), so the behavior is
// driven directly below; the wiring is asserted on the sources, in
// the style of src/pages/SubscribeWorkspaceFlow.test.js.

const ORIGIN = 'https://luminousstockhaven.com';

// One full bounce, exactly as client.js builds it.
function bounceUrl(currentUrl) {
  const target = loginBounceTarget(currentUrl, ORIGIN);
  return target === '/'
    ? `${ORIGIN}/login`
    : `${ORIGIN}/login?returnTo=${encodeURIComponent(target)}`;
}

test('bounce target: a protected path becomes a clean relative path', () => {
  assert.equal(loginBounceTarget(`${ORIGIN}/scan`, ORIGIN), '/scan');
  assert.equal(loginBounceTarget('/scan', ORIGIN), '/scan');
  // A legitimate query string is part of the place being resumed.
  assert.equal(loginBounceTarget('/products?sort=asc', ORIGIN), '/products?sort=asc');
  // The Subscribe resume path keeps its plan parameter.
  assert.equal(loginBounceTarget('/subscribe?plan=business', ORIGIN), '/subscribe?plan=business');
  // Nothing to resume means "/".
  assert.equal(loginBounceTarget('/', ORIGIN), '/');
  assert.equal(loginBounceTarget('', ORIGIN), '/');
  assert.equal(loginBounceTarget(null, ORIGIN), '/');
  assert.equal(loginBounceTarget(undefined, ORIGIN), '/');
});

test('bounce target: auth pages never become the target', () => {
  for (const path of AUTH_PAGE_PATHS) {
    assert.equal(isAuthPagePath(path), true, `${path} is an auth page`);
    assert.equal(loginBounceTarget(path, ORIGIN), '/', `${path} must not be a bounce target`);
    assert.equal(loginBounceTarget(`${ORIGIN}${path}?returnTo=%2Fscan`, ORIGIN), '/');
  }
  assert.equal(isAuthPagePath('/scan'), false);
  assert.equal(isAuthPagePath('/welcome'), false);
});

test('bounce target: a nested returnTo falls back to / instead of wrapping', () => {
  // The crafted self-wrap from the field report.
  assert.equal(loginBounceTarget('/login?returnTo=%2Flogin', ORIGIN), '/');
  // A protected URL that somehow already carries a returnTo.
  assert.equal(loginBounceTarget('/scan?returnTo=%2Fproducts', ORIGIN), '/');
  // The loop's own mid-flight URL shape: an absolute href whose query
  // is one giant encoded returnTo.
  const wrapped = `${ORIGIN}/login?returnTo=${encodeURIComponent(`${ORIGIN}/login?returnTo=${encodeURIComponent(`${ORIGIN}/`)}`)}`;
  assert.equal(loginBounceTarget(wrapped, ORIGIN), '/');
});

test('bounce target: cross-origin and protocol-relative values fall back to /', () => {
  assert.equal(loginBounceTarget('https://evil.example/scan', ORIGIN), '/');
  assert.equal(loginBounceTarget('//evil.example/scan', ORIGIN), '/');
  assert.equal(loginBounceTarget('/\\evil.example/scan', ORIGIN), '/');
});

test('the bounce reaches a fixpoint: no URL growth, terminal state is plain /login', () => {
  // Signed-out at a protected path: exactly one hop, singly encoded.
  const first = bounceUrl(`${ORIGIN}/scan`);
  assert.equal(first, `${ORIGIN}/login?returnTo=%2Fscan`);
  // Feeding the produced /login URL back through the bounce (what the
  // old gate did on arrival) must NOT wrap it again: the auth page is
  // exempt and its returnTo is never re-carried.
  const second = bounceUrl(first);
  assert.equal(second, `${ORIGIN}/login`);
  // And from there it is stable forever — apply it repeatedly and the
  // URL neither changes nor grows.
  let url = second;
  for (let i = 0; i < 5; i += 1) {
    const next = bounceUrl(url);
    assert.equal(next, `${ORIGIN}/login`);
    assert.ok(next.length <= url.length, 'URL must never grow across a bounce');
    url = next;
  }
});

test('AuthContext no longer hands redirectToLogin the full href', () => {
  const ctx = readFileSync('src/lib/AuthContext.jsx', 'utf8');
  assert.doesNotMatch(ctx, /redirectToLogin\(window\.location\.href\)/);
  assert.match(ctx, /redirectToLogin\(window\.location\.pathname \+ window\.location\.search\)/);
});

test('client redirectToLogin sanitizes whatever it is handed', () => {
  const client = readFileSync('src/api/client.js', 'utf8');
  assert.match(client, /loginBounceTarget\(returnTo, window\.location\.origin\)/);
  // The raw pass-through that encoded any value verbatim is gone.
  assert.doesNotMatch(client, /`\/login\$\{returnTo \? `\?returnTo=\$\{encodeURIComponent\(returnTo\)\}` : ''\}`/);
});

test('App bounces from an effect, for protected paths only, and never during render', () => {
  const app = readFileSync('src/App.jsx', 'utf8');
  // Exactly one bounce call site, and it sits inside the useEffect.
  const calls = app.match(/navigateToLogin\(\)/g) || [];
  assert.equal(calls.length, 1);
  assert.ok(app.indexOf('navigateToLogin()') > app.indexOf('useEffect(() => {'));
  assert.match(app, /useEffect\(\(\) => \{\s*if \(authError\?\.type === 'auth_required' && !openToEveryone && !authPage && pathname !== '\/'\) \{\s*navigateToLogin\(\);/);
  // The old render-time bounce (call, then return null) is gone.
  assert.doesNotMatch(app, /navigateToLogin\(\);\s*return null/);
  assert.doesNotMatch(app, /authError\.type === 'auth_required' && !openToEveryone\) \{\s*\/\/ Redirect to login automatically/);
  // The auth pages are exempted through the shared helper, not a
  // second hand-rolled list.
  assert.match(app, /import \{ isAuthPagePath \} from '\.\/lib\/authReturnTo'/);
  assert.match(app, /const authPage = isAuthPagePath\(pathname\);/);
});

test('App lands a signed-out visitor at / on /welcome exactly once', () => {
  const app = readFileSync('src/App.jsx', 'utf8');
  assert.match(app, /if \(pathname === '\/' && !isAuthenticated\) \{\s*return <Navigate to="\/welcome" replace \/>;\s*\}/);
  // The signed-in root is untouched: still the Dashboard behind
  // ProtectedRoute + SubscriptionAccessRoute + Layout.
  assert.match(app, /<Route path="\/" element=\{<Dashboard \/>\} \/>/);
});

test('safeReturnTo still guards the way back in', () => {
  // The fix did not weaken the return-path validation the auth pages
  // resume through: same-origin only, no protocol-relative smuggling.
  const lib = readFileSync('src/lib/authReturnTo.js', 'utf8');
  assert.match(lib, /export function safeReturnTo\(\)/);
  assert.match(lib, /if \(url\.origin !== window\.location\.origin\) return "\/";/);
  assert.match(lib, /path\.startsWith\("\/\/"\)/);
  // And the Subscribe resume links still carry their returnTo.
  const subscribe = readFileSync('src/pages/Subscribe.jsx', 'utf8');
  assert.match(subscribe, /\/register\?returnTo=/);
  assert.match(subscribe, /\/login\?returnTo=/);
});
