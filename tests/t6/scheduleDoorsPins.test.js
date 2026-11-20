/**
 * Schedule-doors build pins (Nov 20, 2026).
 *
 * The behavior proofs live in the browser harness
 * (probe-schedule.mjs); these pins hold the wiring only the
 * source can show: the Schedule card always names its person
 * (picker for 2+, the name stated plainly for exactly 1), the
 * editor's clear-day button says "Clear" while the read-only
 * day state stays "Off", the message composer shows its
 * 2,000-character limit honestly (hard stop + counter) with
 * the server cut kept as backstop, and the Team activity rows
 * are doors — no "Mark read" button anywhere — with each
 * notification event mapped to its real destination.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { en } from '../../src/lib/locales/en.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('the schedule card names its person: picker for many, the name for one', () => {
  const page = read('src/pages/Workforce.jsx');
  assert.match(page, /candidates\.length > 1 && \(/);
  assert.match(page, /candidates\.length === 1 && \(/);
  assert.match(page, /candidates\[0\]\.full_name/);
});

test('the editor clears a day with "Clear"; the read-only state stays "Off"', () => {
  const page = read('src/pages/Workforce.jsx');
  assert.equal(page.split("t('workforce.schedule.clear')").length - 1, 1);
  assert.equal(page.split("t('workforce.schedule.off')").length - 1, 1);
  assert.equal(en['workforce.schedule.clear'], 'Clear');
  assert.equal(en['workforce.schedule.off'], 'Off');
});

test('the composer stops at 2,000 characters and shows the count as it nears', () => {
  const page = read('src/pages/Workforce.jsx');
  assert.match(page, /const MESSAGE_MAX_CHARS = 2000;/);
  assert.match(page, /maxLength=\{MESSAGE_MAX_CHARS\}/);
  assert.match(page, /t\('workforce\.messages\.charCount', \{ count: draft\.length, max: MESSAGE_MAX_CHARS \}\)/);
  assert.match(page, /t\('workforce\.messages\.charLimit'\)/);
  // The server's cut stays as the backstop.
  const routes = read('server/workforceRoutes.js');
  assert.match(routes, /body\.slice\(0, 2000\)/);
});

test('no Mark read button: activity rows are doors to their thing', () => {
  const page = read('src/pages/Workforce.jsx');
  assert.ok(!page.includes('workforce.inbox.markRead'), 'the Mark read button is gone');
  assert.ok(!('workforce.inbox.markRead' in en), 'the dead key left the catalog');
  assert.match(page, /const openNotification = async \(item\) => \{/);
  // Going there is what marks the notice read.
  assert.match(page, /await markNotificationRead\(businessId, item\.id\)/);
  // Every event the server can record has a mapped destination.
  for (const dest of [
    "case 'message':",
    "case 'schedule_set':",
    "case 'time_off_requested':",
    "case 'time_off_decided':",
    "case 'task_assigned':",
    "case 'task_done':",
    "case 'stub_pushed':",
    "case 'clock_in':",
    "case 'break_out':",
    "case 'break_in':",
    "case 'clock_out':",
    "onGoTab('schedule')",
    "onGoTab('timeoff')",
    "onGoTab('tasks')",
    "onGoTab('clock')",
    "navigate('/payroll')",
  ]) {
    assert.ok(page.includes(dest), `destination wiring missing: ${dest}`);
  }
  // A message notice opens the conversation itself — which is
  // also the only place a read receipt can fire from.
  assert.match(page, /const thread = threads\.find\(\(th\) => th\.id === item\.entry_id\);/);
});

test('the inbox lesson no longer teaches tap-to-mark-read', () => {
  const step2 = en['training.lessons.inbox-notifications.step2'];
  assert.ok(!/mark it read/i.test(step2), 'the old wording is gone');
  assert.match(step2, /go to what it is about/);
});
