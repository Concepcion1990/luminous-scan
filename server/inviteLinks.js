/**
 * Single-use staff invite links — core (Nov 22, 2026).
 *
 * The owner's ruling (Nov 22, 2026): "that one link that the
 * owner sends over to their staff member is used only once
 * and if they don't use it when they click on it then the
 * owner has to send another link."
 *
 * Before this module the invite email's link carried NO
 * secret: it was the register page with the invited email
 * prefilled, the staff_members row matched by email was the
 * whole invite, and the link could be opened forever. Now
 * every invite email carries a one-use token:
 *
 *   mint    — each (re)send of the invite email mints a fresh
 *             token for the staff row (only its SHA-256 hash
 *             is stored) and supersedes any earlier link.
 *   open    — the FIRST open of the link claims it for that
 *             browser session: an atomic fresh -> opened flip
 *             stores a claim hash, and the claim secret lives
 *             only in that session. The same session may keep
 *             going (reloads, back button); any later open
 *             without that session's claim is refused, and a
 *             WRONG claim spends the link outright.
 *   bind    — a registration submitted from the claiming
 *             session marks the link 'used' inside the
 *             register transaction; the staff row may flip
 *             Active only once its link is 'used' (the flip
 *             guard in server/staff.js).
 *   accept  — a signed-in person whose account email IS the
 *             invited address completes the link by opening
 *             it: the row flips on the spot. This is also the
 *             recovery road when a mail scanner pre-opened
 *             the link (see the publish record's honest-edge
 *             flag): sign in first, then tap the link.
 *
 * LEGACY ROWS: a staff row with no token (invites sent before
 * this build; their plain ?email= links are already in
 * inboxes) is not governed here at all — it keeps the old
 * email-match activation until any invite email is (re)sent
 * for it, which mints its first token.
 *
 * Every refusal answers the same 410 + the same kind message
 * (apiErrors.inviteLinkUsed, x52): the endpoint never says
 * WHICH failure it was.
 */
import crypto from 'node:crypto';

export const INVITE_LINK_USED_MESSAGE =
  'This invite link has already been used. Ask the owner of the business to send you a new invite.';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function newSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Mint (or re-mint) the invite link for a staff row. Called by
 * the one invite-email door on every send: the previous token
 * is overwritten, so the previous link dies immediately.
 * Returns the raw token for the emailed URL — never stored.
 */
export async function mintInviteToken(db, staffRowId) {
  const token = newSecret();
  await db.query(
    `UPDATE staff_members
        SET invite_token_hash = $2, invite_claim_hash = NULL,
            invite_link_state = 'fresh', invite_issued_at = NOW(),
            invite_opened_at = NULL, updated_at = NOW()
      WHERE id = $1`,
    [staffRowId, sha256(token)],
  );
  return token;
}

async function rowByToken(db, token) {
  if (!token || typeof token !== 'string' || token.length < 16 || token.length > 200) return null;
  const { rows } = await db.query(
    'SELECT * FROM staff_members WHERE invite_token_hash = $1 LIMIT 1',
    [sha256(token)],
  );
  return rows[0] || null;
}

function usedRefusal() {
  return { status: 410, body: { error: 'invite_link_used', message: INVITE_LINK_USED_MESSAGE } };
}

/**
 * The open door (POST /api/auth/invite/open). `user` is the
 * softly-loaded signed-in user, or null. Returns a result the
 * route sends verbatim: { status, body }.
 */
export async function openInviteLink(db, { token, claim, user }) {
  const row = await rowByToken(db, token);
  if (!row) return usedRefusal();
  if (row.status !== 'invited') return usedRefusal();
  const state = row.invite_link_state;

  // Signed-in completion: the account email IS the invited
  // address — the strongest proof the link reached its person.
  if (
    user && user.email_verified && user.scope !== 'recovery'
    && String(user.email || '').toLowerCase() === String(row.email || '').toLowerCase()
    && (state === 'fresh' || state === 'opened')
  ) {
    const flipped = await db.query(
      `UPDATE staff_members
          SET invite_link_state = 'used', updated_at = NOW()
        WHERE id = $1 AND invite_link_state IN ('fresh', 'opened')
        RETURNING id`,
      [row.id],
    );
    if (flipped.rows.length) {
      // The flip itself (activation + memberships + training
      // seed) rides the one path every acceptance uses; the
      // flip guard in staff.js admits this row because its
      // link now reads 'used'. Imported lazily to keep the
      // module graph one-directional.
      const { activateStaffRowsForEmail } = await import('./staff.js');
      await activateStaffRowsForEmail(db, row.email);
      return { status: 200, body: { ok: true, completed: true, email: row.email } };
    }
    return usedRefusal();
  }

  if (state === 'fresh') {
    // The first open claims the link — atomically: the WHERE
    // clause admits exactly one winner among simultaneous
    // opens, and the claim secret goes back to that session
    // only.
    const claimSecret = newSecret();
    const { rows: claimed } = await db.query(
      `UPDATE staff_members
          SET invite_link_state = 'opened', invite_claim_hash = $2,
              invite_opened_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND invite_link_state = 'fresh'
        RETURNING id`,
      [row.id, sha256(claimSecret)],
    );
    if (claimed.length) {
      return { status: 200, body: { ok: true, email: row.email, claim: claimSecret } };
    }
    // Lost the race: the winner's visit is unharmed (this open
    // presented no claim, so nothing is spent) — but THIS open
    // cannot use the link.
    return usedRefusal();
  }

  if (state === 'opened') {
    if (claim && row.invite_claim_hash && sha256(claim) === row.invite_claim_hash) {
      // The claiming session, continuing its one visit.
      return { status: 200, body: { ok: true, email: row.email, claim } };
    }
    if (claim) {
      // A claim was presented and it is NOT the claiming
      // session's: a different session once held this link.
      // The link is spent, exactly as ruled.
      await db.query(
        `UPDATE staff_members SET invite_link_state = 'spent', updated_at = NOW()
          WHERE id = $1 AND invite_link_state = 'opened'`,
        [row.id],
      );
    }
    // No claim at all: refused, but not spent — the claiming
    // session may still be alive in its own tab, and the
    // signed-in email owner can still complete the link.
    return usedRefusal();
  }

  // 'used' or 'spent': dead either way, same answer.
  return usedRefusal();
}

/**
 * The register door's bind, inside its transaction: a signup
 * submitted from the claiming session consumes the link.
 * Returns one of:
 *   { bound: true }             — link marked 'used'
 *   { bound: false }            — no live link governs this
 *                                 signup (no token presented,
 *                                 unknown token, or the token
 *                                 belongs to a different email:
 *                                 a plain signup proceeds)
 *   { refused: true }           — the presented token IS this
 *                                 email's link but it is spent,
 *                                 used, unopened or claimed by
 *                                 another session: refuse the
 *                                 registration, create nothing.
 */
export async function bindInviteAtRegister(db, { token, claim, email }) {
  if (!token) return { bound: false };
  const { rows } = await db.query(
    'SELECT * FROM staff_members WHERE invite_token_hash = $1 FOR UPDATE',
    [sha256(String(token))],
  );
  const row = rows[0];
  if (!row) return { bound: false };
  if (String(row.email || '').toLowerCase() !== String(email || '').toLowerCase()) {
    return { bound: false };
  }
  if (row.status !== 'invited') return { refused: true };
  if (
    row.invite_link_state === 'opened'
    && claim && row.invite_claim_hash
    && sha256(claim) === row.invite_claim_hash
  ) {
    await db.query(
      `UPDATE staff_members SET invite_link_state = 'used', updated_at = NOW() WHERE id = $1`,
      [row.id],
    );
    return { bound: true };
  }
  return { refused: true };
}
