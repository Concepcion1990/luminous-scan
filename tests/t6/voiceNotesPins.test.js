/**
 * Voice-notes build pins (Nov 19, 2026).
 *
 * The behavior proofs live in tests/t3/voiceNotes.test.js; these
 * pins hold the wiring that only the source can show: the mic
 * beside the message box with listen/toss/send before anything
 * is sent, the Sent/Received label on the conversation list, the
 * Read mark on the sender's own messages, the server-side receipt
 * shaping (the owner's read state is removed before a staff
 * member's view is built — never merely hidden in the UI), the
 * MP3 conversion step, ffmpeg in the production image, Rider B's
 * entry totals, and Rider A's banner copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('the composer records, previews, and only then sends', () => {
  const page = read('src/pages/Workforce.jsx');
  assert.match(page, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  assert.match(page, /new MediaRecorder\(stream/);
  assert.match(page, /postVoiceMessage\(businessId, activeThread\.id, dataUrl, recRef\.current\.durationMs\)/);
  assert.match(page, /voiceNoteFileUrl\(businessId, message\.thread_id, message\.id\)/);
  assert.match(page, /t\('workforce\.messages\.sendVoice'\)/);
  assert.match(page, /t\('workforce\.messages\.discard'\)/);
  assert.match(page, /t\('workforce\.messages\.micDenied'\)/);
});

test('the conversation list carries the Sent/Received label and voice rows', () => {
  const page = read('src/pages/Workforce.jsx');
  assert.match(page, /thread\.is_mine && thread\.last_message && \(/);
  assert.match(page, /thread\.last_message\.mine\s*\?\s*t\('workforce\.messages\.sentLabel'\)\s*:\s*t\('workforce\.messages\.receivedLabel'\)/);
  assert.match(page, /thread\.last_message\.kind === 'voice' \? t\('workforce\.messages\.voiceNote'\)/);
  assert.match(page, /message\.mine && message\.read_at \? ` · \$\{t\('workforce\.messages\.readLabel'\)\}` : ''/);
});

test('receipts are shaped on the server, at the one choke point', () => {
  const routes = read('server/workforceRoutes.js');
  // Nov 21, 2026 (profile photos build): the shaper gained an
  // optional fifth argument — the owner's live display name, so
  // a message the owner sent before setting their name still
  // shows the name they go by now. Same one choke point.
  assert.match(routes, /function shapeMessageForViewer\(message, thread, access, viewerUserId, ownerName = null\)/);
  assert.match(routes, /const hideRead = Boolean\(reader\) && reader\.key === OWNER_KEY && !access\.isOwner;/);
  assert.match(routes, /read_at: hideRead \? null : message\.read_at/);
  // The thread read and both post responses pass through it.
  assert.ok((routes.match(/shapeMessageForViewer\(/g) || []).length >= 4);
});

test('voice storage is Postgres, conversion is MP3-only, the file door re-checks access', () => {
  const routes = read('server/workforceRoutes.js');
  assert.match(routes, /convertVoiceToMp3\(parsed\.bytes, parsed\.ext\)/);
  assert.match(routes, /INSERT INTO message_voice_notes/);
  assert.match(routes, /messages\/threads\/:threadId\/voice\/:messageId\/file/);
  assert.match(routes, /m\.thread_id = \$3/, 'the note must belong to the thread in the URL');
  const voice = read('server/voiceNote.js');
  assert.match(voice, /libmp3lame/);
  assert.match(voice, /VOICE_MAX_BYTES = 8 \* 1024 \* 1024/);
  const docker = read('Dockerfile');
  assert.match(docker, /apt-get install -y --no-install-recommends ffmpeg/);
  const migration = read('migrations/031_voice_notes.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS message_voice_notes/);
  assert.match(migration, /kind TEXT NOT NULL DEFAULT 'text'/);
});

test('rider B: completed time entries show their total, open ones do not', () => {
  const page = read('src/pages/Workforce.jsx');
  assert.match(page, /formatDuration\(entry\.clock_in_at, entry\.clock_out_at\)/);
  assert.match(page, /\{entry\.clock_out_at && \(/, 'the total renders only once the entry is closed');
  assert.match(page, /if \(!start \|\| !end\) return '';/, 'a still-open entry formats to no total');
});

test('rider A: the trial banner includes the mobile app', async () => {
  const { en } = await import('../../src/lib/locales/en.js');
  assert.equal(
    en['plans.trialOfferNote'],
    'Included with both website plans and with the mobile app. Nothing is charged today — the countdown starts when you confirm a plan.',
  );
});

test('the header carries a Messages door beside Scan, with the unread badge', () => {
  const layout = read('src/components/Layout.jsx');
  // The door: ungated (every role, both plans), beside the Scan
  // pill, asking Workforce for the inbox by name.
  assert.match(layout, /to="\/workforce"\s+state=\{\{ workforceTab: 'inbox' \}\}/);
  assert.match(layout, /<MessageCircle className="h-3\.5 w-3\.5" aria-hidden="true" \/>/);
  assert.match(layout, /\{t\('workforce\.messages\.title'\)\}/);
  // The badge: the person's own unread count, refreshed on
  // navigation and on a poll, rendered only when something waits.
  assert.match(layout, /getMessageUnread\(activeId\)/);
  assert.match(layout, /setInterval\(loadUnread, 30000\)/);
  assert.match(layout, /\{messageUnread > 0 && \(/);
  // Workforce honors the ask on every arrival.
  const page = read('src/pages/Workforce.jsx');
  assert.match(page, /location\.state\?\.workforceTab === 'inbox' \? 'inbox' : 'clock'/);
  assert.match(page, /if \(location\.state\?\.workforceTab === 'inbox'\) setTab\('inbox'\);/);
});

test('the owner oversight lesson carries the approved discretion line, verbatim', async () => {
  const { en } = await import('../../src/lib/locales/en.js');
  assert.equal(
    en['training.lessons.owner-messages-oversight.step7'],
    'What you do about negative messages between staff members is up to you. Let it pass, speak to someone quietly, or act on it — the choice is yours, and you never have to say where you saw it.',
  );
  assert.match(en['training.lessons.messages-private.step5'], /voice note/i);
});
