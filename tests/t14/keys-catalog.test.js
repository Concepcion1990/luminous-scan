/**
 * T14 — send-PO surface invariants: the new i18n keys exist in every
 * locale (3595 at send-PO; 3597 after the delete warning; 3664 after rewards;
 * 3749 after POS, 3754 after the POS gate, 3768 after plans parity, 3804 after in-app problem reporting, 3811 after the front-door fixes, 3830 after the transfer door, 3857 after clearance + rollback pricing, 3875 after shipping labels, 3954 after the POS provider expansion + deletion-request batch), and the
 * training catalogs (client + server) carry the feature's lessons in
 * agreement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, SUPPORTED_LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';

test('keyset parity holds across all 52 locale files at the send-PO total', () => {
  const enKeys = Object.keys(en).sort();
  assert.equal(enKeys.length, 3954);
  assert.equal(SUPPORTED_LOCALES.length, 52);
  for (const code of SUPPORTED_LOCALES) {
    const keys = Object.keys(LOCALES[code]).sort();
    assert.deepEqual(keys, enKeys, `${code} keyset differs from en`);
    assert.ok(keys.includes('purchasing.sendOrder'), `${code} missing purchasing.sendOrder`);
    assert.ok(keys.includes('purchasing.sendAgain'), `${code} missing purchasing.sendAgain`);
    assert.ok(keys.includes('purchasing.sentTo'), `${code} missing purchasing.sentTo`);
    assert.ok(
      keys.includes('training.lessons.mgr-send-supplier-order.title'),
      `${code} missing the manager send-order training lesson`,
    );
    assert.ok(
      keys.includes('training.lessons.owner-send-supplier-order.title'),
      `${code} missing the owner send-order training lesson`,
    );
  }
});

test('training catalogs carry the send-PO lessons, client and server in agreement', () => {
  const expected = {
    'mgr-send-supplier-order': 'manager',
    'owner-send-supplier-order': 'owner',
  };
  for (const [id, track] of Object.entries(expected)) {
    const client = CLIENT_LESSONS.find((lesson) => lesson.id === id);
    const server = SERVER_LESSONS.find((lesson) => lesson.id === id);
    assert.ok(client, `client catalog missing ${id}`);
    assert.ok(server, `server catalog missing ${id}`);
    assert.equal(client.track, track);
    assert.equal(server.track, track);
    assert.equal(client.module, 'purchasing');
    assert.equal(client.steps, 4);
  }
  assert.deepEqual(
    CLIENT_LESSONS.map((lesson) => lesson.id),
    SERVER_LESSONS.map((lesson) => lesson.id),
    'client and server catalogs list the same lessons in the same order',
  );
});
