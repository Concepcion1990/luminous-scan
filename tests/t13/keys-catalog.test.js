/**
 * T13 — recovery-kit surface invariants: the new i18n keys exist in
 * every locale (3575 at the recovery kit; send-PO later brought the
 * total to 3595, the delete warning to 3597 and rewards to 3664), and the training
 * catalogs (client + server) carry the kit's lessons in agreement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, SUPPORTED_LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';

test('keyset parity holds across all 52 locale files at the recovery-kit total', () => {
  const enKeys = Object.keys(en).sort();
  // 3575 at the recovery kit; send-PO added 15 keys (5 UI + 10
  // training) for 3595; the delete warning added 2 more for 3597;
  // rewards added 67 more (46 UI + 21 training) for 3664;
  // POS added 85 more (54 UI + 31 training) for 3749; the POS gate added 5 more, for 3754; plans parity added 14 more, for 3768; in-app problem reporting added 36 more (21 UI + 15 training), for 3804; the front-door fixes added 7 more (2 subscribe chooser + 5 reset code entry), for 3811; the cross-store transfer door added 19 more (14 UI + 5 training), for 3830; clearance + rollback pricing added 27 more (17 UI/plans + 10 training), for 3857; shipping labels added 18 more (8 UI/plans + 10 training), for 3875.
  assert.equal(enKeys.length, 3875);
  assert.equal(SUPPORTED_LOCALES.length, 52);
  for (const code of SUPPORTED_LOCALES) {
    const keys = Object.keys(LOCALES[code]).sort();
    assert.deepEqual(keys, enKeys, `${code} keyset differs from en`);
    assert.ok(keys.includes('recovery.title'), `${code} missing recovery.title`);
    assert.ok(keys.includes('settings.security.title'), `${code} missing settings.security.title`);
    assert.ok(keys.includes('login.cantAccessEmail'), `${code} missing login.cantAccessEmail`);
    assert.ok(
      keys.includes('training.lessons.spare-keys-setup.title'),
      `${code} missing the spare-keys training lesson`,
    );
    assert.ok(
      keys.includes('training.lessons.owner-staff-email-fix.title'),
      `${code} missing the owner staff-email-fix training lesson`,
    );
  }
});

test('training catalogs carry the recovery-kit lessons, client and server in agreement', () => {
  const expected = {
    'spare-keys-setup': 'staff',
    'lost-email-recovery': 'staff',
    'owner-staff-email-fix': 'owner',
  };
  for (const [id, track] of Object.entries(expected)) {
    const client = CLIENT_LESSONS.find((lesson) => lesson.id === id);
    const server = SERVER_LESSONS.find((lesson) => lesson.id === id);
    assert.ok(client, `client catalog missing ${id}`);
    assert.ok(server, `server catalog missing ${id}`);
    assert.equal(client.track, track);
    assert.equal(server.track, track);
    assert.equal(client.steps, 4);
  }
  assert.deepEqual(
    CLIENT_LESSONS.map((lesson) => lesson.id),
    SERVER_LESSONS.map((lesson) => lesson.id),
    'client and server catalogs list the same lessons in the same order',
  );
});
