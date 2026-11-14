/**
 * Account-deletion REQUESTS — HTTP surface (Deletion-request
 * phase, Nov 14, 2026).
 *
 *   GET  /api/account/deletion-request   the caller's own request status
 *   POST /api/account/deletion-request   file the request { confirmation: 'DELETE' }
 *
 * This closes the leftover gap the Settings page was shipped
 * with: its Delete Account card invoked `request-account-deletion`
 * through the Base44-shaped shim, and the twin never implemented
 * the server side.
 *
 * The designed semantics, held exactly:
 *   - REQUEST FOR REVIEW. Filing stores ONE row in
 *     account_deletion_requests and emails a copy to the owner's
 *     support inbox. It deletes NOTHING — no user row, no
 *     business, no product — and it touches NO billing state (no
 *     entitlement, no Stripe object). The Settings page's
 *     "request received — your account and data have not been
 *     deleted" state is therefore literally true. Any actual
 *     deletion happens later, by a person's review, through the
 *     existing cancel-to-wipe machinery — never from here.
 *   - The caller's OWN request only. The page reads this endpoint
 *     for the signed-in user ("the endpoint verifies auth and
 *     reads only the current user's request" — Settings.jsx), and
 *     it is not role-gated in the UI: any full-session signed-in
 *     user may ask for their own account to be reviewed. A
 *     restricted recovery session may NOT (the app-level guard
 *     refuses it before this router; the handler checks again,
 *     the supportRoutes discipline).
 *   - ACCOUNT-level, never plan-gated — like support, it does not
 *     live under /api/businesses/:bid/*, so the subscription gate
 *     can never stand between a customer and this door.
 *   - The confirmation word: the Settings dialog gates on the
 *     CURRENT language's own delete word client-side, then sends
 *     the function's expected token — the literal 'DELETE'.
 *     Anything else is a 400; the server never guesses.
 *   - Recorded once: while a request is pending (requested /
 *     under_review), a repeat submission returns the existing
 *     request — no second row, no second email. A light abuse
 *     cap (3 filings per user per rolling 24h) mirrors the
 *     support endpoint's posture.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { sendMail, deletionRequestEmail } from './email.js';
import { supportInbox } from './supportRoutes.js';

export const DELETION_CONFIRMATION = 'DELETE';
export const DELETION_MAX_PER_DAY = 3;
const PENDING_STATUSES = ['requested', 'under_review'];

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] deletion-request route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

/** The wire shape the Settings page reads (status + request actions share it). */
function publicRequest(row) {
  if (!row) return { pending: false, status: null, requested_at: null };
  return {
    pending: PENDING_STATUSES.includes(row.status),
    status: row.status,
    requested_at: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

export function createDeletionRouter({ getPool: pool0 }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(pool0())(req, res, next);

  async function latestRequest(pool, userId) {
    const { rows } = await pool.query(
      'SELECT * FROM account_deletion_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId],
    );
    return rows[0] ?? null;
  }

  function refuseRecovery(req) {
    if (req.sessionScope === 'recovery') {
      throw err(403, 'recovery_scope', 'This sign-in can only finish changing your account email.');
    }
  }

  router.get('/account/deletion-request', auth, async (req, res) => {
    try {
      const pool = pool0();
      if (!pool) throw err(503, 'database_not_configured', 'Database is not configured.');
      refuseRecovery(req);
      const row = await latestRequest(pool, req.user.id);
      return res.json(publicRequest(row));
    } catch (error) {
      return handleError(res, error);
    }
  });

  router.post('/account/deletion-request', auth, async (req, res) => {
    try {
      const pool = pool0();
      if (!pool) throw err(503, 'database_not_configured', 'Database is not configured.');
      refuseRecovery(req);
      const user = req.user;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (String(body.confirmation || '') !== DELETION_CONFIRMATION) {
        throw err(400, 'deletion_confirmation_required', 'Type the confirmation word to file this request.');
      }

      // Recorded once: a pending request IS the answer to a
      // repeat submission — same row, same requested_at, no
      // duplicate, no second email.
      const existing = await latestRequest(pool, user.id);
      if (existing && PENDING_STATUSES.includes(existing.status)) {
        return res.json({ success: true, ...publicRequest(existing) });
      }

      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) AS count FROM account_deletion_requests
          WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
        [user.id],
      );
      if (Number(countRows[0]?.count ?? 0) >= DELETION_MAX_PER_DAY) {
        throw err(429, 'deletion_rate_limited', 'Several deletion requests were filed today. Please wait until tomorrow — a person reviews every request.');
      }

      const id = crypto.randomUUID();
      const inserted = await pool.query(
        `INSERT INTO account_deletion_requests (id, user_id, user_email, status)
         VALUES ($1, $2, $3, 'requested') RETURNING *`,
        [id, user.id, user.email || ''],
      );
      const row = inserted.rows[0];
      const view = publicRequest(row);

      // Notification copy to the owner's inbox; a mail failure
      // never loses the request and never fails the filing — the
      // row above is the record of truth (the support rule).
      try {
        await sendMail(deletionRequestEmail({
          to: supportInbox(),
          requesterEmail: user.email || '',
          requestId: id,
          requestedAt: view.requested_at,
        }));
      } catch (mailError) {
        console.error('[twin] deletion request email failed:', mailError.message);
      }

      return res.status(201).json({ success: true, ...view });
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
