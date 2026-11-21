/**
 * Profile photos + the owner's display name — HTTP surface
 * (Nov 21, 2026).
 *
 *   GET  /api/businesses/:bid/profile-photos/summary
 *   GET  /api/businesses/:bid/profile-photos/me
 *   POST /api/businesses/:bid/profile-photos/me            { dataUrl }
 *   PUT  /api/businesses/:bid/profile-photos/owner-name    { name }   owner
 *   GET  /api/businesses/:bid/profile-photos/pending                  owner
 *   POST /api/businesses/:bid/profile-photos/:staffId/approve         owner
 *   POST /api/businesses/:bid/profile-photos/:staffId/decline         owner
 *   GET  /api/businesses/:bid/profile-photos/:key/file
 *   GET  /api/businesses/:bid/profile-photos/:key/pending-file        owner
 *
 * The owner's rulings (Nov 19, 2026):
 *   - A photo sits beside each person's name in the header; an
 *     approved photo also shows in the owner's Staff list and in
 *     Messages, Messenger-style.
 *   - A staff member's or manager's photo appears NOWHERE until
 *     the owner approves it. The decision lives on the owner's
 *     Staff page. Approval is the OWNER's alone: there is no
 *     manager tick for it (considered and declined), and nobody
 *     can approve their own photo — a member's POST here can only
 *     ever create a PENDING photo, never an approved one.
 *   - Changing a photo follows the same road. While the change
 *     waits — and if it is declined — the current approved photo
 *     stays in place; the decline tells the person so, in the
 *     owner's own words (DECLINED_CHANGE_DETAIL below).
 *   - The owner sets their own photo with no approval, and sets a
 *     display NAME that replaces the word "Owner" everywhere, on
 *     both ends; "Owner" remains the fallback until a name is set.
 *
 * Enforcement is server-side throughout: the file route serves
 * APPROVED bytes only, to people with access to the business;
 * pending bytes are served only to the owner (the approval view)
 * and never through any other route. A roster viewer, a manager,
 * another business's member — none of them can reach a pending
 * photo under any code path.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { assertNotInGrace } from './billing.js';
import {
  OWNER_PERSON_KEY,
  approvedPhotoKeys,
  ownerDisplayName,
  ownerPublicName,
} from './profilePhotos.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] profile photo route failed:', error);
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

// The photo cap follows the store logo's: the app prepares the
// image for the person before upload (src/lib/imagePrep.js), so
// 2 MB of prepared image is generous, and anything past it is
// not a profile photo.
const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function parseProfilePhotoDataUrl(value) {
  const text = String(value || '');
  const match = text.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const mime = match[1];
  if (!PROFILE_PHOTO_TYPES.includes(mime)) return null;
  let bytes;
  try {
    bytes = Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > PROFILE_PHOTO_MAX_BYTES) return null;
  return { mime, base64: match[2] };
}

export const OWNER_NAME_MAX = 80;

// The decision wordings the member is told, in the owner's own
// substance (Nov 19, 2026). The change-decline sentence is hers
// word for word: a person whose new photo is refused still has
// their other one, and the notice must say exactly that.
export const PHOTO_APPROVED_DETAIL = 'Your profile photo was approved. It now appears beside your name.';
export const PHOTO_DECLINED_FIRST_DETAIL = 'Your photo was not approved. Please choose another photo.';
export const PHOTO_DECLINED_CHANGE_DETAIL =
  'Your photo was not approved — but you still have your other one. If you would like to change it, try another photo.';

/** The bell, on the workforce_notifications pattern: one row for
 *  one recipient user, entry_id carrying the related record (the
 *  staff member whose photo it is). */
async function notifyPhotoEvent(pool, business, {
  recipientUserId, recipientStaffId = null, recipientRole = 'staff',
  actorStaffId = null, actorName = '', event, detail, refId = null,
}) {
  if (!recipientUserId) return;
  await pool.query(
    `INSERT INTO workforce_notifications
       (id, business_id, recipient_user_id, recipient_staff_id, recipient_role, actor_staff_id, actor_name, event, detail, entry_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      crypto.randomUUID(), business.id, recipientUserId, recipientStaffId, recipientRole,
      actorStaffId, actorName, event, detail, refId,
    ],
  );
}

async function userForStaffRow(pool, row) {
  if (!row) return null;
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [row.email],
  );
  return rows[0] ?? null;
}

async function photoRow(pool, businessId, personKey) {
  const { rows } = await pool.query(
    'SELECT * FROM profile_photos WHERE business_id = $1 AND person_key = $2 LIMIT 1',
    [businessId, personKey],
  );
  return rows[0] ?? null;
}

/** The caller's own person key in this business: 'owner' for the
 *  owner, their staff row id for a member. Access resolution has
 *  already proven one of the two. */
function myKey(access) {
  if (access.isOwner) return OWNER_PERSON_KEY;
  return access.staffRow?.id || null;
}

function myState(row, isOwner) {
  return {
    is_owner: isOwner,
    has_approved: Boolean(row?.approved_data),
    has_pending: Boolean(row?.pending_data),
    pending_at: row?.pending_at ?? null,
    approved_at: row?.approved_at ?? null,
    decision: row?.decision ?? null,
    decision_had_approved: row?.decision_had_approved === true,
    decision_at: row?.decision_at ?? null,
  };
}

export function createProfilePhotoRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/profile-photos';

  // Everything the chrome needs in one read: who I am here, the
  // owner's public name (their set name, or null — the client
  // falls back to "Owner"), and which people hold an APPROVED
  // photo. Booleans only: no photo state beyond "has one" ever
  // leaks, and pending existence is never in this response.
  router.get(`${base}/summary`, asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    const keys = await approvedPhotoKeys(pool(), req.params.bid);
    return res.json({
      me_key: myKey(access),
      owner_name: await ownerDisplayName(pool(), access.business),
      approved_keys: [...keys],
    });
  }));

  // My own photo state — the one read that may speak of MY
  // pending photo and MY last decision, because it answers only
  // to the person it belongs to.
  router.get(`${base}/me`, asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    const key = myKey(access);
    if (!key) throw err(400, 'no_staff_profile', 'Only team members with a staff profile can do this.');
    const row = await photoRow(pool(), req.params.bid, key);
    return res.json({ key, ...myState(row, access.isOwner) });
  }));

  // Submit a photo. For the owner this IS the approval — their
  // photo lands at once. For anyone else the photo becomes
  // PENDING and nothing else moves: an existing approved photo
  // stays exactly where it was, and the owner's bell rings.
  router.post(`${base}/me`, asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    await assertNotInGrace(pool(), req.params.bid);
    const key = myKey(access);
    if (!key) throw err(400, 'no_staff_profile', 'Only team members with a staff profile can do this.');
    const parsed = parseProfilePhotoDataUrl(req.body?.dataUrl);
    if (!parsed) {
      throw err(400, 'invalid_photo', 'Send a PNG, JPG or WebP image under 2 MB.');
    }
    const bid = req.params.bid;
    if (access.isOwner) {
      await pool().query(
        `INSERT INTO profile_photos
           (business_id, person_key, user_id, approved_type, approved_data, approved_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (business_id, person_key) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           approved_type = EXCLUDED.approved_type,
           approved_data = EXCLUDED.approved_data,
           approved_at = NOW(),
           pending_type = NULL, pending_data = NULL, pending_at = NULL,
           decision = NULL, decision_at = NULL,
           updated_at = NOW()`,
        [bid, key, req.user.id, parsed.mime, parsed.base64],
      );
    } else {
      const me = access.staffRow;
      await pool().query(
        `INSERT INTO profile_photos
           (business_id, person_key, user_id, pending_type, pending_data, pending_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (business_id, person_key) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           pending_type = EXCLUDED.pending_type,
           pending_data = EXCLUDED.pending_data,
           pending_at = NOW(),
           decision = NULL, decision_at = NULL,
           updated_at = NOW()`,
        [bid, key, req.user.id, parsed.mime, parsed.base64],
      );
      const current = await photoRow(pool(), bid, key);
      const changing = Boolean(current?.approved_data);
      await notifyPhotoEvent(pool(), access.business, {
        recipientUserId: access.business.owner_id,
        recipientRole: 'owner',
        actorStaffId: me.id,
        actorName: me.full_name,
        event: 'photo_submitted',
        detail: changing
          ? `${me.full_name} would like to change their profile photo — approve it on the Staff page.`
          : `${me.full_name} would like to add a profile photo — approve it on the Staff page.`,
        refId: me.id,
      });
    }
    const row = await photoRow(pool(), bid, key);
    return res.json({ key, ...myState(row, access.isOwner) });
  }));

  // The owner's display name — account-level (users.display_name),
  // set from any of their businesses' Settings, replacing "Owner"
  // on every surface that names the owner. An empty name clears
  // it back to the fallback.
  router.put(`${base}/owner-name`, asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    if (!access.isOwner) {
      throw err(403, 'forbidden', 'Only the business owner can set the owner name.');
    }
    await assertNotInGrace(pool(), req.params.bid);
    const name = String(req.body?.name ?? '').trim();
    if (name.length > OWNER_NAME_MAX) {
      throw err(400, 'invalid_value', 'Keep your name to 80 characters or fewer.');
    }
    await pool().query(
      'UPDATE users SET display_name = $1 WHERE id = $2',
      [name || null, req.user.id],
    );
    return res.json({ owner_name: name || null });
  }));

  // The owner's decision list: every member with a photo waiting.
  // Names and times only — the pictures themselves ride the
  // owner-only pending-file route below.
  router.get(`${base}/pending`, asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    if (!access.isOwner) {
      throw err(403, 'forbidden', 'Only the business owner can approve team photos.');
    }
    const { rows } = await pool().query(
      `SELECT pp.person_key AS staff_id, pp.pending_at,
              (pp.approved_data IS NOT NULL) AS has_current,
              sm.full_name, sm.email, sm.role_name
         FROM profile_photos pp
         JOIN staff_members sm ON sm.id = pp.person_key AND sm.business_id = pp.business_id
        WHERE pp.business_id = $1 AND pp.pending_data IS NOT NULL
        ORDER BY pp.pending_at ASC`,
      [req.params.bid],
    );
    return res.json({ pending: rows });
  }));

  // The decision itself. Owner only — enforced here, not merely
  // hidden in the UI: a manager's or the member's own call gets
  // the same refusal. Approving promotes the pending bytes to
  // approved; declining discards them. Either way the member's
  // bell rings with what happened, and the decision is recorded
  // on the row for their own Settings to show.
  async function decide(req, approve) {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    if (!access.isOwner) {
      throw err(403, 'forbidden', 'Only the business owner can approve team photos.');
    }
    await assertNotInGrace(pool(), req.params.bid);
    const bid = req.params.bid;
    const staffId = req.params.staffId;
    const { rows: memberRows } = await pool().query(
      'SELECT * FROM staff_members WHERE id = $1 AND business_id = $2 LIMIT 1',
      [staffId, bid],
    );
    const member = memberRows[0];
    if (!member) throw err(404, 'not_found', 'That team member is not in this business.');
    const row = await photoRow(pool(), bid, staffId);
    if (!row?.pending_data) {
      throw err(404, 'not_found', 'That team member has no photo waiting for approval.');
    }
    const hadApproved = Boolean(row.approved_data);
    if (approve) {
      await pool().query(
        `UPDATE profile_photos SET
           approved_type = pending_type, approved_data = pending_data, approved_at = NOW(),
           pending_type = NULL, pending_data = NULL, pending_at = NULL,
           decision = 'approved', decision_had_approved = $3, decision_at = NOW(),
           updated_at = NOW()
         WHERE business_id = $1 AND person_key = $2`,
        [bid, staffId, hadApproved],
      );
    } else {
      await pool().query(
        `UPDATE profile_photos SET
           pending_type = NULL, pending_data = NULL, pending_at = NULL,
           decision = 'declined', decision_had_approved = $3, decision_at = NOW(),
           updated_at = NOW()
         WHERE business_id = $1 AND person_key = $2`,
        [bid, staffId, hadApproved],
      );
    }
    const memberUser = await userForStaffRow(pool(), member);
    await notifyPhotoEvent(pool(), access.business, {
      recipientUserId: memberUser?.id ?? null,
      recipientStaffId: member.id,
      recipientRole: 'staff',
      actorName: await ownerPublicName(pool(), access.business),
      event: approve ? 'photo_approved' : 'photo_declined',
      detail: approve
        ? PHOTO_APPROVED_DETAIL
        : hadApproved
          ? PHOTO_DECLINED_CHANGE_DETAIL
          : PHOTO_DECLINED_FIRST_DETAIL,
      refId: member.id,
    });
    return { member };
  }

  router.post(`${base}/:staffId/approve`, asyncHandler(async (req, res) => {
    await decide(req, true);
    return res.json({ ok: true });
  }));

  router.post(`${base}/:staffId/decline`, asyncHandler(async (req, res) => {
    await decide(req, false);
    return res.json({ ok: true });
  }));

  function servePhoto(row, slot, res) {
    const data = slot === 'pending' ? row?.pending_data : row?.approved_data;
    const type = slot === 'pending' ? row?.pending_type : row?.approved_type;
    if (!row || !data) throw err(404, 'not_found', 'Photo not found.');
    res.setHeader('Content-Type', type || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline; filename="profile-photo"');
    return res.send(Buffer.from(data, 'base64'));
  }

  // An APPROVED photo, for anyone with access to this business —
  // and for no one else. There is deliberately no route by which
  // a non-owner can name the pending slot.
  router.get(`${base}/:key/file`, asyncHandler(async (req, res) => {
    await accessOr403(pool(), req.user, req.params.bid);
    const row = await photoRow(pool(), req.params.bid, req.params.key);
    return servePhoto(row, 'approved', res);
  }));

  // The person's own waiting photo, for their Settings preview.
  // The key is not theirs to choose: it is derived from their
  // session, so this route can only ever return their own bytes.
  // (Defined before /:key/pending-file so 'me' is never read as
  // a person key.)
  router.get(`${base}/me/pending-file`, asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    const key = myKey(access);
    if (!key) throw err(400, 'no_staff_profile', 'Only team members with a staff profile can do this.');
    const row = await photoRow(pool(), req.params.bid, key);
    return servePhoto(row, 'pending', res);
  }));

  // The waiting photo, for the owner's approval view ONLY.
  router.get(`${base}/:key/pending-file`, asyncHandler(async (req, res) => {
    const access = await accessOr403(pool(), req.user, req.params.bid);
    if (!access.isOwner) {
      throw err(403, 'forbidden', 'Only the business owner can approve team photos.');
    }
    const row = await photoRow(pool(), req.params.bid, req.params.key);
    return servePhoto(row, 'pending', res);
  }));

  return router;
}
