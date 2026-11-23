/**
 * Cross-store messages — the second messaging door (the
 * owner's ruling, Nov 23, 2026).
 *
 *   GET   /api/businesses/:bid/xstore/people
 *   GET   /api/businesses/:bid/xstore/threads
 *   POST  /api/businesses/:bid/xstore/threads                 get-or-create { user_id }
 *   GET   /api/businesses/:bid/xstore/threads/:threadId
 *   POST  /api/businesses/:bid/xstore/threads/:threadId/messages
 *   POST  /api/businesses/:bid/xstore/threads/:threadId/voice  voice note (converted to MP3 server-side)
 *   GET   /api/businesses/:bid/xstore/threads/:threadId/voice/:messageId/file
 *   PATCH /api/businesses/:bid/xstore/threads/:threadId/read
 *   GET   /api/businesses/:bid/xstore/unread
 *   GET   /api/businesses/:bid/xstore/people/:userId/photo
 *
 * WHY A SECOND DOOR: the in-store inbox (workforceRoutes.js)
 * is hard-scoped to one business — its threads are pairs of
 * staff rows inside one store, and the owner found she could
 * only ever pick people from the store she was standing in.
 * Her ruling: that inbox stays EXACTLY as it is, and this new
 * door's scope is the ACCOUNT — everyone under one owner,
 * across all their businesses (two, three, up to five). Any
 * member of a Business account (owner, manager, staff) can
 * message any other member of the same account, whichever
 * business they belong to. The :bid in the path is only the
 * door the caller walked through (their access + plan are
 * resolved there); the data is scoped by account_owner_id,
 * the owner's user id, on every query.
 *
 * BUSINESS-ONLY: the account's governing plan (356 inheritance
 * included, via resolveAccess' planKey) must be Business.
 * Essentials gets the standard plan_gated refusal on every
 * route here, no nav door, no lessons — no trace.
 *
 * PRIVACY: a conversation here is private to its two
 * participants — there is NO owner oversight in this door (the
 * in-store oversight exists because a store's threads are the
 * store's record; a cross-store conversation belongs to the
 * two people in it, and the owner is a participant like
 * everyone else). Read receipts follow the Nov 19, 2026 law
 * through the single shaping choke point below: a non-owner
 * NEVER learns whether the owner read their message — they
 * see Delivered, never Read, when the reader is the owner.
 *
 * DELIVERED: stamped by the server at insert. This app
 * delivers to a server-side inbox, so a stored message HAS
 * landed in the other person's inbox — delivered_at is that
 * landing, and read_at (set when they open the conversation)
 * is the step after it.
 *
 * PHOTOS: participants carry `photo` — true only when that
 * person holds an APPROVED profile photo in one of the
 * account's businesses (a pending photo is invisible by law,
 * exactly as everywhere else). The photo bytes ride this
 * door's own file route because the per-business file route
 * rightly refuses anyone without access to THAT business —
 * and the person across the conversation may work in a store
 * the viewer has no access to. The account route re-checks
 * account membership for both the viewer and the person
 * pictured, and only ever reads approved_data.
 *
 * VOICE: the same machinery as the in-store inbox — the
 * client records through the sample-counted PCM capture
 * (src/lib/voiceCapture.js), the server converts to MP3
 * (server/voiceNote.js) before anything is stored, and the
 * bytes are served only behind the participant check.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess, loadBusinessesForUser } from './authz.js';
import { featureAllowed } from './plans.js';
import { assertNotInGrace } from './billing.js';
import { parseVoiceDataUrl, convertVoiceToMp3, VOICE_MAX_DURATION_MS } from './voiceNote.js';
import { ownerPublicName } from './profilePhotos.js';
import { personLevel } from './workforceRoutes.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({
      error: error.code || 'error',
      message: error.message,
      ...(error.payload || {}),
    });
  }
  console.error('[twin] cross-store message route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

async function accessOr403(pool, user, businessId) {
  const access = await resolveAccess(pool, user, businessId);
  if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
  return access;
}

export function createXstoreMessageRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/xstore';

  /** Access to the business the caller is standing in, the
   *  Business gate, and the account this door speaks for. */
  async function ctx(req) {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    if (!featureAllowed(access.planKey, 'xstoreMessages')) {
      throw err(403, 'plan_gated', 'Cross-store messages are part of the Business plan.');
    }
    return { access, accountOwnerId: access.business.owner_id };
  }

  // ---- The account directory ------------------------------------
  // Everyone who can be messaged in this account: the owner,
  // plus each signed-in user holding an ACTIVE staff row in
  // one of the owner's businesses. One person with rows in
  // several businesses is ONE entry, carrying every business
  // they belong to. A staff row with no signed-in user behind
  // it has nowhere to receive messages and is left out (the
  // in-store rule, participantForKey's no_account refusal,
  // applied at the list instead of the tap).

  async function accountDirectory(p, accountOwnerId, currentBusiness) {
    const businesses = await loadBusinessesForUser(p, accountOwnerId);
    const businessIds = businesses.map((b) => b.id);
    const businessName = new Map(businesses.map((b) => [b.id, b.name]));

    const { rows } = await p.query(
      `SELECT sm.id AS staff_id, sm.business_id, sm.full_name,
              sm.role_id, sm.role_name, u.id AS user_id
         FROM staff_members sm
         JOIN businesses b ON b.id = sm.business_id
         LEFT JOIN users u ON LOWER(u.email) = LOWER(sm.email)
        WHERE b.owner_id = $1 AND sm.status = 'active'
        ORDER BY sm.full_name ASC`,
      [accountOwnerId],
    );

    // Approved photos for the whole account in one read:
    // person keys are 'owner' or staff row ids, per business.
    const photoKeys = new Set();
    if (businessIds.length) {
      const { rows: photoRows } = await p.query(
        `SELECT business_id, person_key FROM profile_photos
          WHERE business_id = ANY($1) AND approved_data IS NOT NULL`,
        [businessIds],
      );
      for (const row of photoRows) photoKeys.add(`${row.business_id}:${row.person_key}`);
    }

    const people = new Map();
    const ownerEntry = {
      user_id: accountOwnerId,
      name: await ownerPublicName(p, currentBusiness),
      role: 'owner',
      level: 'owner',
      staff_ids: [],
      businesses: businesses.map((b) => ({ id: b.id, name: b.name })),
      photo: businessIds.some((id) => photoKeys.has(`${id}:owner`)),
    };
    people.set(accountOwnerId, ownerEntry);

    for (const row of rows) {
      if (!row.user_id) continue;
      let entry = people.get(row.user_id);
      if (!entry) {
        entry = {
          user_id: row.user_id,
          name: row.full_name,
          role: 'staff',
          level: 'staff',
          staff_ids: [],
          businesses: [],
          photo: false,
        };
        people.set(row.user_id, entry);
      }
      entry.staff_ids.push(row.staff_id);
      if (!entry.businesses.some((b) => b.id === row.business_id)) {
        entry.businesses.push({ id: row.business_id, name: businessName.get(row.business_id) || '' });
      }
      const level = personLevel(row);
      if (level === 'manager') entry.level = 'manager';
      entry.role = row.role_name || entry.role;
      if (photoKeys.has(`${row.business_id}:${row.staff_id}`)) entry.photo = true;
    }
    return { people, businesses };
  }

  function publicPerson(entry) {
    if (!entry) return null;
    return {
      user_id: entry.user_id,
      name: entry.name,
      role: entry.role,
      level: entry.level,
      businesses: entry.businesses,
      photo: entry.photo,
    };
  }

  // ---- Threads ---------------------------------------------------

  async function threadOr404(p, threadId, accountOwnerId) {
    const { rows } = await p.query(
      'SELECT * FROM xstore_threads WHERE id = $1 AND account_owner_id = $2 LIMIT 1',
      [threadId, accountOwnerId],
    );
    if (!rows[0]) throw err(404, 'not_found', 'Conversation not found.');
    return rows[0];
  }

  function threadParticipantIds(thread) {
    return [thread.participant_a_user_id, thread.participant_b_user_id];
  }

  async function threadUnread(p, threadId, userId) {
    const { rows } = await p.query(
      `SELECT COUNT(*)::int AS count FROM xstore_messages
        WHERE thread_id = $1 AND sender_user_id != $2 AND read_at IS NULL`,
      [threadId, userId],
    );
    return rows[0]?.count ?? 0;
  }

  // READ RECEIPTS WITH THE OWNER EXCEPTION (the owner's law,
  // Nov 19, 2026): a message's read_at may be shown to a viewer
  // ONLY when the person who did the reading is not the account
  // owner — or the viewer IS the owner. Delivered is never
  // hidden: it names the inbox, not the person's attention.
  // This shaper is the single choke point for message reads.
  function shapeMessageForViewer(message, thread, accountOwnerId, viewerUserId) {
    const readerId = threadParticipantIds(thread).find((id) => id !== message.sender_user_id);
    const hideRead = readerId === accountOwnerId && viewerUserId !== accountOwnerId;
    return {
      ...message,
      read_at: hideRead ? null : message.read_at,
      mine: message.sender_user_id === viewerUserId,
    };
  }

  async function publicThread(p, thread, directory, viewerUserId) {
    const participants = threadParticipantIds(thread).map((userId) => {
      const entry = directory.people.get(userId);
      if (entry) return publicPerson(entry);
      // A person who has since left the account: fall back to
      // the name their messages carry, never an email.
      return { user_id: userId, name: '', role: 'staff', level: 'staff', businesses: [], photo: false };
    });
    const other = participants.find((pt) => pt.user_id !== viewerUserId) ?? null;
    const { rows: lastRows } = await p.query(
      `SELECT body, kind, sender_name, sender_user_id, created_at FROM xstore_messages
        WHERE thread_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [thread.id],
    );
    const last = lastRows[0] ?? null;
    if (!participants.find((pt) => pt.name)) {
      // Fill a departed participant's name from their own words.
      for (const pt of participants) {
        if (!pt.name && last && last.sender_user_id === pt.user_id) pt.name = last.sender_name;
      }
    }
    return {
      id: thread.id,
      participants,
      other,
      last_message: last ? { ...last, mine: last.sender_user_id === viewerUserId } : null,
      last_message_at: thread.last_message_at,
      unread: await threadUnread(p, thread.id, viewerUserId),
      created_at: thread.created_at,
    };
  }

  router.get(`${base}/people`, asyncHandler(async (req, res) => {
    const { access, accountOwnerId } = await ctx(req);
    const directory = await accountDirectory(pool(), accountOwnerId, access.business);
    return res.json({
      me_user_id: req.user.id,
      people: [...directory.people.values()].map(publicPerson),
    });
  }));

  router.get(`${base}/threads`, asyncHandler(async (req, res) => {
    const { access, accountOwnerId } = await ctx(req);
    const { rows } = await pool().query(
      `SELECT * FROM xstore_threads
        WHERE account_owner_id = $1
          AND (participant_a_user_id = $2 OR participant_b_user_id = $2)
        ORDER BY last_message_at DESC NULLS LAST, created_at DESC LIMIT 200`,
      [accountOwnerId, req.user.id],
    );
    const directory = await accountDirectory(pool(), accountOwnerId, access.business);
    const threads = [];
    let unreadTotal = 0;
    for (const thread of rows) {
      const pub = await publicThread(pool(), thread, directory, req.user.id);
      unreadTotal += pub.unread || 0;
      threads.push(pub);
    }
    return res.json({ threads, unread_total: unreadTotal });
  }));

  router.post(`${base}/threads`, asyncHandler(async (req, res) => {
    const { access, accountOwnerId } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const directory = await accountDirectory(pool(), accountOwnerId, access.business);
    const me = directory.people.get(req.user.id);
    if (!me) {
      throw err(403, 'forbidden', 'This conversation is private to the two people in it.');
    }
    const targetId = String(req.body?.user_id || '');
    if (!targetId) throw err(400, 'invalid_value', 'Choose who to message.');
    if (targetId === req.user.id) {
      throw err(400, 'invalid_value', 'You cannot message yourself.');
    }
    const other = directory.people.get(targetId);
    if (!other) {
      throw err(400, 'invalid_value', 'That person is not part of this account.');
    }
    const [a, b] = [req.user.id, targetId].sort();
    const existing = await pool().query(
      `SELECT * FROM xstore_threads
        WHERE account_owner_id = $1 AND participant_a_user_id = $2 AND participant_b_user_id = $3 LIMIT 1`,
      [accountOwnerId, a, b],
    );
    if (existing.rows[0]) {
      return res.json({ thread: await publicThread(pool(), existing.rows[0], directory, req.user.id), created: false });
    }
    const inserted = await pool().query(
      `INSERT INTO xstore_threads (id, account_owner_id, participant_a_user_id, participant_b_user_id, origin_business_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [crypto.randomUUID(), accountOwnerId, a, b, req.params.bid],
    );
    return res.status(201).json({
      thread: await publicThread(pool(), inserted.rows[0], directory, req.user.id),
      created: true,
    });
  }));

  /** The thread + proof the caller is one of its two people. */
  async function participantThread(req, accountOwnerId) {
    const thread = await threadOr404(pool(), req.params.threadId, accountOwnerId);
    if (!threadParticipantIds(thread).includes(req.user.id)) {
      throw err(403, 'forbidden', 'This conversation is private to the two people in it.');
    }
    return thread;
  }

  router.get(`${base}/threads/:threadId`, asyncHandler(async (req, res) => {
    const { access, accountOwnerId } = await ctx(req);
    const thread = await participantThread(req, accountOwnerId);
    const { rows } = await pool().query(
      `SELECT m.*, vn.duration_ms AS voice_duration_ms
         FROM xstore_messages m
         LEFT JOIN xstore_voice_notes vn ON vn.message_id = m.id
        WHERE m.thread_id = $1 ORDER BY m.created_at ASC LIMIT 500`,
      [thread.id],
    );
    const directory = await accountDirectory(pool(), accountOwnerId, access.business);
    return res.json({
      thread: await publicThread(pool(), thread, directory, req.user.id),
      messages: rows.map((m) => shapeMessageForViewer(m, thread, accountOwnerId, req.user.id)),
    });
  }));

  /** The caller's own directory entry — their message name is
   *  the name the account knows them by, resolved fresh. */
  async function myEntry(req, access, accountOwnerId) {
    const directory = await accountDirectory(pool(), accountOwnerId, access.business);
    const me = directory.people.get(req.user.id);
    if (!me) {
      throw err(403, 'forbidden', 'This conversation is private to the two people in it.');
    }
    return me;
  }

  router.post(`${base}/threads/:threadId/messages`, asyncHandler(async (req, res) => {
    const { access, accountOwnerId } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const thread = await participantThread(req, accountOwnerId);
    const body = String(req.body?.body || '').trim();
    if (!body) throw err(400, 'invalid_value', 'Write a message first.');
    const me = await myEntry(req, access, accountOwnerId);
    const inserted = await pool().query(
      `INSERT INTO xstore_messages (id, thread_id, account_owner_id, sender_user_id, sender_name, body, kind, delivered_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'text', NOW()) RETURNING *`,
      [crypto.randomUUID(), thread.id, accountOwnerId, req.user.id, me.name, body.slice(0, 2000)],
    );
    await pool().query(
      'UPDATE xstore_threads SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
      [thread.id],
    );
    return res.status(201).json({
      message: shapeMessageForViewer(inserted.rows[0], thread, accountOwnerId, req.user.id),
    });
  }));

  // ---- Voice notes -------------------------------------------------
  // The in-store path, unchanged: the phone's recording is
  // converted to MP3 before anything is stored, and the bytes
  // are served only from the file route below, behind the same
  // participant check as the thread itself.

  router.post(`${base}/threads/:threadId/voice`, asyncHandler(async (req, res) => {
    const { access, accountOwnerId } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    const thread = await participantThread(req, accountOwnerId);
    const parsed = parseVoiceDataUrl(req.body?.dataUrl);
    if (!parsed) {
      throw err(400, 'invalid_value', 'Send a voice recording of a few minutes at most.');
    }
    const durationMs = Math.min(
      Math.max(0, Math.round(Number(req.body?.duration_ms) || 0)),
      VOICE_MAX_DURATION_MS,
    );
    let mp3;
    try {
      mp3 = await convertVoiceToMp3(parsed.bytes, parsed.ext);
    } catch {
      throw err(400, 'invalid_value', "That recording could not be prepared — please record it again.");
    }
    const me = await myEntry(req, access, accountOwnerId);
    const messageId = crypto.randomUUID();
    const inserted = await pool().query(
      `INSERT INTO xstore_messages (id, thread_id, account_owner_id, sender_user_id, sender_name, body, kind, delivered_at)
       VALUES ($1, $2, $3, $4, $5, '', 'voice', NOW()) RETURNING *`,
      [messageId, thread.id, accountOwnerId, req.user.id, me.name],
    );
    await pool().query(
      `INSERT INTO xstore_voice_notes (message_id, account_owner_id, content_type, size_bytes, duration_ms, data_base64)
       VALUES ($1, $2, 'audio/mpeg', $3, $4, $5)`,
      [messageId, accountOwnerId, mp3.length, durationMs, mp3.toString('base64')],
    );
    await pool().query(
      'UPDATE xstore_threads SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
      [thread.id],
    );
    return res.status(201).json({
      message: {
        ...shapeMessageForViewer(inserted.rows[0], thread, accountOwnerId, req.user.id),
        voice_duration_ms: durationMs,
      },
    });
  }));

  router.get(`${base}/threads/:threadId/voice/:messageId/file`, asyncHandler(async (req, res) => {
    const { accountOwnerId } = await ctx(req);
    const thread = await participantThread(req, accountOwnerId);
    const { rows } = await pool().query(
      `SELECT vn.content_type, vn.data_base64 FROM xstore_voice_notes vn
         JOIN xstore_messages m ON m.id = vn.message_id
        WHERE vn.message_id = $1 AND vn.account_owner_id = $2 AND m.thread_id = $3 LIMIT 1`,
      [req.params.messageId, accountOwnerId, thread.id],
    );
    const note = rows[0];
    if (!note) throw err(404, 'not_found', 'Voice note not found.');
    res.setHeader('Content-Type', note.content_type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline; filename="voice-note.mp3"');
    return res.send(Buffer.from(note.data_base64, 'base64'));
  }));

  router.patch(`${base}/threads/:threadId/read`, asyncHandler(async (req, res) => {
    const { accountOwnerId } = await ctx(req);
    const thread = await participantThread(req, accountOwnerId);
    await pool().query(
      'UPDATE xstore_messages SET read_at = NOW() WHERE thread_id = $1 AND sender_user_id != $2 AND read_at IS NULL',
      [thread.id, req.user.id],
    );
    return res.json({ unread: await threadUnread(pool(), thread.id, req.user.id) });
  }));

  router.get(`${base}/unread`, asyncHandler(async (req, res) => {
    const { accountOwnerId } = await ctx(req);
    const { rows } = await pool().query(
      `SELECT COUNT(*)::int AS count FROM xstore_messages m
         JOIN xstore_threads t ON t.id = m.thread_id
        WHERE t.account_owner_id = $1
          AND (t.participant_a_user_id = $2 OR t.participant_b_user_id = $2)
          AND m.sender_user_id != $2 AND m.read_at IS NULL`,
      [accountOwnerId, req.user.id],
    );
    return res.json({ unread: rows[0]?.count ?? 0 });
  }));

  // ---- The account photo file ---------------------------------------
  // An APPROVED photo of one person in this account, for anyone
  // else in the account — and for no one else. The target must
  // be in the caller's account directory; the bytes come from
  // whichever of the account's businesses holds the person's
  // approved photo (the owner's 'owner' key, or any of the
  // person's staff rows). Pending bytes are never read here.

  router.get(`${base}/people/:userId/photo`, asyncHandler(async (req, res) => {
    const { access, accountOwnerId } = await ctx(req);
    const directory = await accountDirectory(pool(), accountOwnerId, access.business);
    const target = directory.people.get(req.params.userId);
    if (!target || !target.photo) throw err(404, 'not_found', 'Photo not found.');
    const personKeys = target.user_id === accountOwnerId ? ['owner'] : target.staff_ids;
    const { rows } = await pool().query(
      `SELECT approved_type, approved_data FROM profile_photos
        WHERE business_id = ANY($1) AND person_key = ANY($2) AND approved_data IS NOT NULL
        ORDER BY approved_at DESC NULLS LAST LIMIT 1`,
      [directory.businesses.map((b) => b.id), personKeys],
    );
    const row = rows[0];
    if (!row) throw err(404, 'not_found', 'Photo not found.');
    res.setHeader('Content-Type', row.approved_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline; filename="profile-photo"');
    return res.send(Buffer.from(row.approved_data, 'base64'));
  }));

  return router;
}
