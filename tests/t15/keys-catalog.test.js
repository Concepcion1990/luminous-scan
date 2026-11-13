/**
 * T15 — trial-reminder surface invariants: the keyset total moved to
 * 3595 in every locale (3597 after the delete warning; 3664 after rewards;
 * 3749 after POS, 3754 after the POS gate, 3768 after plans parity, 3804 after in-app problem reporting, 3811 after the front-door fixes), her three
 * notice strings stand verbatim in English, and the training
 * catalogs carry the owner trial-reminders lesson in agreement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, SUPPORTED_LOCALES } from '../../src/lib/i18n.js';
import { en } from '../../src/lib/locales/en.js';
import { TRAINING_LESSONS as CLIENT_LESSONS } from '../../src/lib/trainingCatalog.js';
import { TRAINING_LESSONS as SERVER_LESSONS } from '../../server/trainingCatalog.js';

test('keyset parity holds across all 52 locale files at the trial-reminders total', () => {
  const enKeys = Object.keys(en).sort();
  assert.equal(enKeys.length, 3811);
  assert.equal(SUPPORTED_LOCALES.length, 52);
  for (const code of SUPPORTED_LOCALES) {
    const keys = Object.keys(LOCALES[code]).sort();
    assert.deepEqual(keys, enKeys, `${code} keyset differs from en`);
    assert.ok(
      keys.includes('training.lessons.owner-trial-reminders.title'),
      `${code} missing the owner trial-reminders training lesson`,
    );
  }
});

test("the three in-app notices stand in her exact words in English", () => {
  assert.equal(en['plans.trialNoticeFiveDay'], 'You have 5 more days left on your trial.');
  assert.equal(en['plans.trialNoticeThreeDay'], 'You have 3 more days left on your trial.');
  assert.equal(en['plans.trialNoticeOneDay'], '24 hours until your trial ends.');
});

test('training catalogs carry the trial-reminders lesson, client and server in agreement', () => {
  const client = CLIENT_LESSONS.find((lesson) => lesson.id === 'owner-trial-reminders');
  const server = SERVER_LESSONS.find((lesson) => lesson.id === 'owner-trial-reminders');
  assert.ok(client, 'client catalog missing owner-trial-reminders');
  assert.ok(server, 'server catalog missing owner-trial-reminders');
  assert.equal(client.track, 'owner');
  assert.equal(server.track, 'owner');
  assert.equal(client.module, 'billing');
  assert.equal(client.steps, 4);
  assert.equal(CLIENT_LESSONS.length, 73); // 64 through rewards; POS added 6 (5 owner + 1 staff); problem reporting added 3 (one per role)
  assert.deepEqual(
    CLIENT_LESSONS.map((lesson) => lesson.id),
    SERVER_LESSONS.map((lesson) => lesson.id),
    'client and server catalogs list the same lessons in the same order',
  );
});
