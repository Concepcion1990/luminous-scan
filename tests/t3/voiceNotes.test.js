/**
 * Voice notes in team Messages (owner ruling, Nov 19, 2026).
 *
 * A recording is stored and played back exactly as spoken; the
 * only processing is the server converting it to one common
 * format (MP3) so a note recorded on Android plays on iPhone and
 * vice versa. The audio lives in Postgres behind an authenticated
 * route scoped to the conversation's two people plus the owner's
 * oversight READ — the owner can listen in oversight but can
 * never post into a conversation they are not part of.
 *
 * Read receipts carry the owner exception: a staff member never
 * sees whether the owner read their message, under any code
 * path; the owner sees when staff read theirs; staff↔staff and
 * manager↔staff receipts flow both ways. The oversight rule is
 * untouched: the owner's oversight read marks nothing for the
 * participants.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  pool,
  req,
  reqRaw,
  close,
  resetRateLimits,
  registerVerifiedUser,
  login,
  cookieFrom,
  ownerWithBusiness,
} from './helpers.js';

after(close);
beforeEach(() => resetRateLimits());

/** A tiny but real WAV: 0.25 s of a 440 Hz tone, 8 kHz mono. */
function fixtureWavDataUrl() {
  const sampleRate = 8000;
  const frames = sampleRate / 4;
  const data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + frames * 2, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); // PCM
  data.writeUInt16LE(1, 22); // mono
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i += 1) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000), 44 + i * 2);
  }
  return `data:audio/wav;base64,${data.toString('base64')}`;
}

async function addMember(owner, { email, name, roleId = 'preset-sales', roleName = 'Sales clerk' }) {
  const invite = await req('/api/entities/StaffMember', {
    method: 'POST',
    cookie: owner.cookie,
    body: {
      business_id: owner.business.id,
      full_name: name,
      email,
      role_id: roleId,
      role_name: roleName,
    },
  });
  assert.equal(invite.status, 201, invite.text);
  const user = await registerVerifiedUser(email);
  const row = (await pool.query(
    'SELECT id FROM staff_members WHERE business_id = $1 AND lower(email) = lower($2)',
    [owner.business.id, email],
  )).rows[0];
  assert.ok(row, 'the staff row activated at sign-in');
  // A full-week posted schedule so the shift window lets them in.
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await pool.query(
      `INSERT INTO work_schedules (id, business_id, staff_member_id, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, '00:00', '23:59')`,
      [crypto.randomUUID(), owner.business.id, row.id, weekday],
    );
  }
  const loginRes = await login(email, 'CorrectHorse123');
  assert.equal(loginRes.status, 200, loginRes.text);
  return { user: user.user, cookie: cookieFrom(loginRes.setCookie), staffId: row.id };
}

const wf = (owner, path) => `/api/businesses/${owner.business.id}/workforce${path}`;

async function openThread(owner, cookie, partnerKey) {
  const body = partnerKey === 'owner'
    ? { with_owner: true }
    : { staff_member_id: partnerKey.replace(/^staff:/, '') };
  const res = await req(wf(owner, '/messages/threads'), {
    method: 'POST', cookie, body,
  });
  assert.equal(res.status, 201, res.text);
  return res.json.thread;
}

async function getThread(owner, cookie, threadId) {
  const res = await req(wf(owner, `/messages/threads/${threadId}`), { cookie });
  assert.equal(res.status, 200, res.text);
  return res.json;
}

async function markRead(owner, cookie, threadId) {
  const res = await req(wf(owner, `/messages/threads/${threadId}/read`), {
    method: 'PATCH', cookie, body: {},
  });
  assert.equal(res.status, 200, res.text);
  return res.json;
}

async function postVoice(owner, cookie, threadId, dataUrl = fixtureWavDataUrl()) {
  return req(wf(owner, `/messages/threads/${threadId}/voice`), {
    method: 'POST', cookie, body: { dataUrl, duration_ms: 1500 },
  });
}

test('a voice note round-trips: posted as voice, stored as MP3, playable by the receiver', async () => {
  const owner = await ownerWithBusiness('vn1-owner@example.com', 'VN One', { plan: 'essentials' });
  const staff = await addMember(owner, { email: 'vn1-staff@example.com', name: 'Vera Voice' });
  const thread = await openThread(owner, staff.cookie, 'owner');

  const posted = await postVoice(owner, staff.cookie, thread.id);
  assert.equal(posted.status, 201, posted.text);
  assert.equal(posted.json.message.kind, 'voice');
  assert.equal(posted.json.message.body, '');
  assert.equal(posted.json.message.voice_duration_ms, 1500);

  // The stored row is MP3, not the WAV that was uploaded.
  const stored = (await pool.query(
    'SELECT content_type, size_bytes, data_base64 FROM message_voice_notes WHERE message_id = $1',
    [posted.json.message.id],
  )).rows[0];
  assert.equal(stored.content_type, 'audio/mpeg');
  assert.ok(stored.size_bytes > 0);
  const bytes = Buffer.from(stored.data_base64, 'base64');
  assert.notEqual(bytes.subarray(0, 4).toString('latin1'), 'RIFF', 'the WAV container is gone');
  assert.ok(
    bytes.subarray(0, 3).toString('latin1') === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0),
    'the stored bytes are an MP3 stream',
  );

  // The owner hears it back through the file door.
  const file = await reqRaw(
    wf(owner, `/messages/threads/${thread.id}/voice/${posted.json.message.id}/file`),
    { cookie: owner.cookie },
  );
  assert.equal(file.status, 200, file.text);
  assert.match(file.headers.get('content-type'), /audio\/mpeg/);
  assert.ok(file.buffer.equals(bytes), 'the served bytes are the stored recording');

  // The owner's thread read shows the voice message with its length.
  const view = await getThread(owner, owner.cookie, thread.id);
  const message = view.messages.find((m) => m.id === posted.json.message.id);
  assert.equal(message.kind, 'voice');
  assert.equal(message.voice_duration_ms, 1500);
});

test('the voice file door is scoped: non-participants are refused, cross-thread fetches fail', async () => {
  const owner = await ownerWithBusiness('vn2-owner@example.com', 'VN Two', { plan: 'essentials' });
  const staffA = await addMember(owner, { email: 'vn2-a@example.com', name: 'Ana A' });
  const staffB = await addMember(owner, { email: 'vn2-b@example.com', name: 'Ben B' });
  const thread = await openThread(owner, staffA.cookie, 'owner');
  const posted = await postVoice(owner, staffA.cookie, thread.id);
  assert.equal(posted.status, 201, posted.text);
  const messageId = posted.json.message.id;

  // A staff member outside the conversation cannot play it.
  const outsider = await reqRaw(
    wf(owner, `/messages/threads/${thread.id}/voice/${messageId}/file`),
    { cookie: staffB.cookie },
  );
  assert.equal(outsider.status, 403, outsider.text);

  // Nor post into it.
  const outsiderPost = await postVoice(owner, staffB.cookie, thread.id);
  assert.equal(outsiderPost.status, 403, outsiderPost.text);

  // The note cannot be fetched through a different thread's door.
  const otherThread = await openThread(owner, staffA.cookie, `staff:${staffB.staffId}`);
  const cross = await reqRaw(
    wf(owner, `/messages/threads/${otherThread.id}/voice/${messageId}/file`),
    { cookie: staffA.cookie },
  );
  assert.equal(cross.status, 404, cross.text);
});

test('oversight: the owner can listen to a staff conversation but never post into it', async () => {
  const owner = await ownerWithBusiness('vn3-owner@example.com', 'VN Three', { plan: 'business' });
  const staffA = await addMember(owner, { email: 'vn3-a@example.com', name: 'Ana A' });
  const staffB = await addMember(owner, { email: 'vn3-b@example.com', name: 'Ben B' });
  const thread = await openThread(owner, staffA.cookie, `staff:${staffB.staffId}`);
  const posted = await postVoice(owner, staffA.cookie, thread.id);
  assert.equal(posted.status, 201, posted.text);

  const file = await reqRaw(
    wf(owner, `/messages/threads/${thread.id}/voice/${posted.json.message.id}/file`),
    { cookie: owner.cookie },
  );
  assert.equal(file.status, 200, 'the owner hears it in oversight');

  const ownerPost = await postVoice(owner, owner.cookie, thread.id);
  assert.equal(ownerPost.status, 403, 'the owner cannot post voice into a conversation they are not part of');
});

test('the receipt exception: staff never see the owner’s read state; the owner sees staff’s', async () => {
  const owner = await ownerWithBusiness('vn4-owner@example.com', 'VN Four', { plan: 'essentials' });
  const staff = await addMember(owner, { email: 'vn4-staff@example.com', name: 'Sam Staff' });
  const thread = await openThread(owner, staff.cookie, 'owner');

  // Staff sends; the owner reads it.
  const sent = await req(wf(owner, `/messages/threads/${thread.id}/messages`), {
    method: 'POST', cookie: staff.cookie, body: { body: 'for the owner' },
  });
  assert.equal(sent.status, 201, sent.text);
  await markRead(owner, owner.cookie, thread.id);

  // The staff member's view of their own message carries NO read
  // state — the owner's reading is invisible to them.
  const staffView = await getThread(owner, staff.cookie, thread.id);
  const own = staffView.messages.find((m) => m.id === sent.json.message.id);
  assert.equal(own.read_at, null, 'the staff member must never see that the owner read it');

  // The owner's view keeps the true state.
  const ownerView = await getThread(owner, owner.cookie, thread.id);
  const seen = ownerView.messages.find((m) => m.id === sent.json.message.id);
  assert.ok(seen.read_at, 'the owner sees their own read state on the incoming message');

  // The other direction: the owner sends, staff reads, the owner
  // sees the receipt.
  const ownerSent = await req(wf(owner, `/messages/threads/${thread.id}/messages`), {
    method: 'POST', cookie: owner.cookie, body: { body: 'for the staff member' },
  });
  assert.equal(ownerSent.status, 201, ownerSent.text);
  const before = await getThread(owner, owner.cookie, thread.id);
  assert.equal(
    before.messages.find((m) => m.id === ownerSent.json.message.id).read_at, null,
    'unread until the staff member opens it',
  );
  await markRead(owner, staff.cookie, thread.id);
  const afterRead = await getThread(owner, owner.cookie, thread.id);
  assert.ok(
    afterRead.messages.find((m) => m.id === ownerSent.json.message.id).read_at,
    'the owner sees when the staff member read their message',
  );
});

test('staff↔staff receipts flow both ways', async () => {
  const owner = await ownerWithBusiness('vn5-owner@example.com', 'VN Five', { plan: 'essentials' });
  const staffA = await addMember(owner, { email: 'vn5-a@example.com', name: 'Ana A' });
  const staffB = await addMember(owner, { email: 'vn5-b@example.com', name: 'Ben B' });
  const thread = await openThread(owner, staffA.cookie, `staff:${staffB.staffId}`);

  const sent = await req(wf(owner, `/messages/threads/${thread.id}/messages`), {
    method: 'POST', cookie: staffA.cookie, body: { body: 'hello B' },
  });
  assert.equal(sent.status, 201, sent.text);
  const before = await getThread(owner, staffA.cookie, thread.id);
  assert.equal(before.messages.find((m) => m.id === sent.json.message.id).read_at, null);

  await markRead(owner, staffB.cookie, thread.id);
  const afterRead = await getThread(owner, staffA.cookie, thread.id);
  assert.ok(
    afterRead.messages.find((m) => m.id === sent.json.message.id).read_at,
    'a staff sender sees a staff reader’s receipt',
  );
});

test('the owner’s oversight read marks nothing for the participants', async () => {
  const owner = await ownerWithBusiness('vn6-owner@example.com', 'VN Six', { plan: 'business' });
  const staffA = await addMember(owner, { email: 'vn6-a@example.com', name: 'Ana A' });
  const staffB = await addMember(owner, { email: 'vn6-b@example.com', name: 'Ben B' });
  const thread = await openThread(owner, staffA.cookie, `staff:${staffB.staffId}`);
  const sent = await req(wf(owner, `/messages/threads/${thread.id}/messages`), {
    method: 'POST', cookie: staffA.cookie, body: { body: 'between staff' },
  });
  assert.equal(sent.status, 201, sent.text);

  await getThread(owner, owner.cookie, thread.id); // oversight read

  const unread = await req(wf(owner, '/messages/unread'), { cookie: staffB.cookie });
  assert.equal(unread.status, 200, unread.text);
  assert.equal(unread.json.unread, 1, 'B’s unread count is untouched by the owner’s oversight read');
  const bView = await getThread(owner, staffB.cookie, thread.id);
  assert.equal(bView.thread.unread, 1);
});

test('the conversation list carries the last message’s kind and whose it was', async () => {
  const owner = await ownerWithBusiness('vn7-owner@example.com', 'VN Seven', { plan: 'essentials' });
  const staff = await addMember(owner, { email: 'vn7-staff@example.com', name: 'Sam Staff' });
  const thread = await openThread(owner, staff.cookie, 'owner');
  const posted = await postVoice(owner, staff.cookie, thread.id);
  assert.equal(posted.status, 201, posted.text);

  const staffList = await req(wf(owner, '/messages/threads'), { cookie: staff.cookie });
  const staffRow = staffList.json.threads.find((t) => t.id === thread.id);
  assert.equal(staffRow.last_message.kind, 'voice');
  assert.equal(staffRow.last_message.mine, true, 'the sender’s row knows the last message was theirs');

  const ownerList = await req(wf(owner, '/messages/threads'), { cookie: owner.cookie });
  const ownerRow = ownerList.json.threads.find((t) => t.id === thread.id);
  assert.equal(ownerRow.last_message.kind, 'voice');
  assert.equal(ownerRow.last_message.mine, false, 'the receiver’s row knows the last message arrived');
});

test('a browser-shaped data URL (type parameters and all) is accepted', async () => {
  // Chrome's MediaRecorder hands back a blob typed
  // "audio/webm;codecs=opus", so the data URL a real phone sends
  // carries the codecs parameter. The first harness run caught
  // the parser refusing exactly that shape — every real Android
  // recording would have bounced. The bytes here are a genuine
  // WebM/Opus recording of the fixture tone, made by ffmpeg.
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-fixture-'));
  try {
    const wavPath = path.join(dir, 'tone.wav');
    const webmPath = path.join(dir, 'tone.webm');
    const wavUrl = fixtureWavDataUrl();
    fs.writeFileSync(wavPath, Buffer.from(wavUrl.split(',')[1], 'base64'));
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wavPath, '-c:a', 'libopus', webmPath]);
    const webm = fs.readFileSync(webmPath);
    const browserUrl = `data:audio/webm;codecs=opus;base64,${webm.toString('base64')}`;

    const owner = await ownerWithBusiness('vn9-owner@example.com', 'VN Nine', { plan: 'essentials' });
    const staff = await addMember(owner, { email: 'vn9-staff@example.com', name: 'Vera Voice' });
    const thread = await openThread(owner, staff.cookie, 'owner');
    const posted = await postVoice(owner, staff.cookie, thread.id, browserUrl);
    assert.equal(posted.status, 201, posted.text);
    assert.equal(posted.json.message.kind, 'voice');
    const stored = (await pool.query(
      'SELECT content_type FROM message_voice_notes WHERE message_id = $1',
      [posted.json.message.id],
    )).rows[0];
    assert.equal(stored.content_type, 'audio/mpeg', 'converted to the one common format as always');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bad recordings are refused plainly and nothing is stored', async () => {
  const owner = await ownerWithBusiness('vn8-owner@example.com', 'VN Eight', { plan: 'essentials' });
  const staff = await addMember(owner, { email: 'vn8-staff@example.com', name: 'Sam Staff' });
  const thread = await openThread(owner, staff.cookie, 'owner');

  const cases = [
    'data:text/plain;base64,aGVsbG8=', // not audio at all
    'data:image/png;base64,iVBORw0KGgo=', // an image, not a recording
    'data:audio/webm;base64,%%%not-base64%%%', // undecodable
    `data:audio/webm;base64,${Buffer.from('this is not audio').toString('base64')}`, // audio label, not audio
    '',
  ];
  for (const dataUrl of cases) {
    const res = await postVoice(owner, staff.cookie, thread.id, dataUrl);
    assert.equal(res.status, 400, `${res.status} for ${dataUrl.slice(0, 40)}`);
  }
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM messages WHERE thread_id = $1', [thread.id],
  );
  assert.equal(rows[0].n, 0, 'no message was stored for any refused recording');
});
