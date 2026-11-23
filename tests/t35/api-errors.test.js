/**
 * Leftovers sweep, item 1 — API error copy (Nov 15, 2026): every
 * server error message resolves to an apiErrors.* key, every key
 * exists in all 52 locales, and the client resolver renders the
 * reader's language with the English message as the final fallback
 * — never a raw code, never a blank.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  API_ERROR_MESSAGE_KEYS, API_ERROR_PATTERNS, API_ERROR_CODE_KEYS, apiErrorMessage,
} from '../../src/lib/apiErrors.js';

const LOCALE_DIR = new URL('../../src/lib/locales/', import.meta.url);
const LOCALES = readdirSync(LOCALE_DIR).filter((f) => f.endsWith('.js')).map((f) => f.replace('.js', ''));

async function loadLocale(code) {
  const mod = await import(new URL(code + '.js', LOCALE_DIR));
  return mod.default || mod[Object.keys(mod)[0]];
}

test('item 1: every apiErrors key exists in all 52 locales', async () => {
  assert.equal(LOCALES.length, 52);
  const registryKeys = [
    ...Object.values(API_ERROR_MESSAGE_KEYS),
    ...API_ERROR_PATTERNS.map((p) => p.key),
    ...Object.values(API_ERROR_CODE_KEYS),
  ];
  // 419 through release 287; the staff batch (Nov 19, 2026) added
  // 6: the shift-window refusal code, the grace/denied full-reason
  // strings, the neutral stop, the welcome-script length error,
  // and the plan-neutral limit refusal. The voice-notes build
  // (Nov 19, 2026) added 3: the voice-note-not-found refusal and
  // the two recording refusals (too long / could not be prepared).
  // The returns-approval gate (Nov 19, 2026) added 1: the
  // returns-complete refusal. The add-location tick (Nov 19,
  // 2026) added 1: the add-a-location refusal. The business
  // policies build (Nov 19, 2026) added 5: the owner-only
  // refusal, the file refusal, the typed-text cap, and the two
  // policy 404 wordings. The low-stock ticks (Nov 20, 2026)
  // added 2: the reorder-change refusal and the alerts-view
  // refusal. The training builds (Nov 20, 2026) added 25: the
  // two code keys (the First-training task refusal and the
  // lesson-quiz gate) and 23 message keys — the owner's-quiz
  // refusals and validations, the lesson-quiz wordings, the
  // comment and team-record refusals.
  assert.equal(new Set(registryKeys).size, 493); // 493 with the invite hardening batch (Nov 22, 2026), which added 1 (the kind spent-invite-link refusal); 462 through the training builds batch (Nov 20, 2026); the profile photos batch (Nov 21, 2026) added 5 (the photo 404, the two owner-only refusals, the nothing-waiting refusal, and the owner-name length wording), for 467; the direct-deposit batch (Nov 21, 2026) added 3 (the sign-your-form wording, the signature-style wording, and the not-sent-yet wording), for 470; the rider batch (Nov 21, 2026) added 2 (the owner-only details refusal and the home-address length wording), for 472. The founding-tester comp batch (Nov 21, 2026) added 4 (the operator list wordings: already listed, list full, not listed, and the cap whole-number wording), for 476. The clock build (Nov 21, 2026) added 7 (the call-in gate refusal, the two clock-admin refusals, the three correction wordings, and the time-entry 404 wording), for 483. The staff documents build (Nov 21, 2026) added 5 (the documents door refusal, the manager-file owner-only wording, the remove owner-only wording, the file refusal, and the document 404 wording), for 488. The signup domain blocklist build (Nov 22, 2026) added 4 (the neutral signup refusal and the three operator domain-list wordings), for 492.
  for (const code of LOCALES) {
    const dict = await loadLocale(code);
    for (const key of registryKeys) {
      assert.ok(typeof dict[key] === 'string' && dict[key].length > 0, `${code} missing ${key}`);
    }
  }
});

test('item 1: the registry covers every message literal the server can send', () => {
  // Re-derive the inventory from the server source the same way the
  // registry was built: err(...) calls, plan-limit helpers, the
  // business-patch validator and the password/custom-role helpers.
  const serverDir = new URL('../../server/', import.meta.url);
  const messages = new Set();
  const errRe = /\berr\(\s*\d+\s*,\s*'([a-z0-9_]+)'\s*,\s*(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*')\s*\)/g;
  for (const file of readdirSync(serverDir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(new URL(file, serverDir), 'utf8');
    for (const m of src.matchAll(errRe)) {
      // The registry keys are the RUNTIME strings, so decode the
      // escapes the source spells out (\u2019 and friends).
      const raw = m[2].slice(1, -1)
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
      if (raw.includes('${')) {
        const probe = raw.replace(/\$\{[^}]+\}/g, 'ZZZ');
        assert.ok(
          API_ERROR_PATTERNS.some((p) => p.pattern.test(probe)),
          `${file}: dynamic message unmapped: ${raw}`,
        );
      } else {
        assert.ok(API_ERROR_MESSAGE_KEYS[raw], `${file}: message unmapped: ${raw}`);
      }
      messages.add(raw);
    }
  }
  // The err() family alone carries ~285 distinct literals; the
  // registry's remaining entries come from the plan-limit helpers
  // and validators, which resolve through the same map.
  assert.ok(messages.size > 250, `scan found only ${messages.size} messages`);
});

test('item 1: the two auth signal responses carry client doors in every language', async () => {
  // authRoutes answers register/resend for an existing account with
  // a { error: <code>, message } body whose message is a SIGNAL, not
  // display copy: Register.jsx and VerifyEmail.jsx branch on the
  // stable code and show their own keys, which predate this sweep
  // and exist in all 52 locales.
  const registerSrc = readFileSync(new URL('../../src/pages/Register.jsx', import.meta.url), 'utf8');
  const verifySrc = readFileSync(new URL('../../src/pages/VerifyEmail.jsx', import.meta.url), 'utf8');
  assert.ok(registerSrc.includes("err?.data?.error === \"already_registered\""), 'Register branches on the code');
  assert.ok(verifySrc.includes("errorCode === 'already_verified'"), 'VerifyEmail branches on the code');
  for (const code of LOCALES) {
    const dict = await loadLocale(code);
    assert.ok(dict['register.alreadyExists'], `${code} register.alreadyExists`);
    assert.ok(dict['verifyEmail.alreadyVerified'], `${code} verifyEmail.alreadyVerified`);
  }
});

test('item 1: resolver renders the reader language, falls back to English, never a code or blank', async () => {
  const es = await loadLocale('es-MX');
  const { setLocale } = await import('../../src/lib/i18n.js');
  setLocale('es-MX');
  // The 401 carries a code and no message at all — the code map is
  // what renders it (before this sweep the banner showed the code).
  assert.equal(
    apiErrorMessage({ error: 'not_signed_in' }, 401),
    es['apiErrors.code.notSignedIn'],
  );
  const exactMessage = Object.keys(API_ERROR_MESSAGE_KEYS).find((m) => es[API_ERROR_MESSAGE_KEYS[m]] !== m);
  assert.ok(exactMessage, 'an exact message with a distinct Spanish rendering exists');
  assert.equal(
    apiErrorMessage({ error: 'some_code', message: exactMessage }, 400),
    es[API_ERROR_MESSAGE_KEYS[exactMessage]],
  );
  assert.equal(
    apiErrorMessage({ error: 'insufficient_stock', message: 'Only 5 on hand at Store.' }, 400),
    es['apiErrors.insufficientStock.countHandLocation'].replace('{count}', '5').replace('{location}', 'Store'),
  );
  assert.equal(
    apiErrorMessage({ error: 'brand_new_code', message: 'Something unmapped happened.' }, 400),
    'Something unmapped happened.',
  );
  // No message and no known code: the generic line, itself
  // localized — never the raw code, never a blank.
  assert.equal(apiErrorMessage({}, 500), es['apiLib.requestFailed'].replace('{status}', '500'));
  assert.equal(apiErrorMessage({ error: 'mystery_code' }, 400), es['apiLib.requestFailed'].replace('{status}', '400'));
  setLocale('en');
  assert.equal(apiErrorMessage({}, 500), 'Request failed (500)');
});

