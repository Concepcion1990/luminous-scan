/**
 * In-app issue reporting — HTTP surface (Support phase).
 *
 *   POST /api/support/report   file a "Report a problem" note
 *
 * The owner's design (Nov 13, 2026): a button inside the app so a
 * customer can tell the team when something breaks — the same
 * report-and-fix loop she runs with her builder, opened to the
 * people using the app.
 *
 * Rules that hold here:
 *   - ACCOUNT-level, never plan-gated. Support is not a paid
 *     feature, and a person locked out by a bug needs the door
 *     most — so this route does NOT live under
 *     /api/businesses/:bid/* (the subscription access gate guards
 *     business data; a support note is not business data) and it
 *     never consults the entitlement for permission to write.
 *   - Any signed-in role may report (owner, manager, staff —
 *     staff hit bugs first at the till). A full session is
 *     required: the app-level recovery guard already refuses
 *     scope='recovery' sessions before this router is reached,
 *     and the handler checks the scope again so the rule holds
 *     even if the allowlist ever changes.
 *   - Fixing context is attached by the SERVER from server-side
 *     truth, never trusted from the client: the selected business
 *     is the caller's own active_business_id, included only when
 *     resolveAccess proves the caller genuinely belongs to it —
 *     otherwise the fields are silently omitted (no error, no
 *     leak). The plan is attached only when an entitlement row
 *     exists for that business. The client contributes only the
 *     page it is on and its language; the user-agent comes from
 *     the request itself. NO inventory data is ever attached.
 *   - The saved row is the record of truth. A copy is emailed to
 *     the support inbox through the Resend mailer; if sending is
 *     unconfigured or fails, the report still stands and the user
 *     still sees success — the failure is logged server-side.
 *   - Abuse guard: at most 5 reports per user per rolling 24
 *     hours, counted from the table itself; the 6th is a 429.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { getPool } from './db.js';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { entitlementFor } from './plans.js';
import { personLevel } from './workforceRoutes.js';
import { sendMail, supportReportEmail } from './email.js';

export const SUPPORT_CATEGORIES = ['broken', 'looks_wrong', 'idea', 'other'];

/** English labels for the notification email (server-side copy). */
export const SUPPORT_CATEGORY_LABELS = {
  broken: 'Something is broken',
  looks_wrong: 'Something looks wrong',
  idea: 'An idea or suggestion',
  other: 'Something else',
};

export const SUPPORT_MESSAGE_MIN = 3;
export const SUPPORT_MESSAGE_MAX = 2000;
export const SUPPORT_MAX_PER_DAY = 5;

/** Where report copies go: SUPPORT_EMAIL env wins; owner's chosen inbox otherwise. */
export function supportInbox() {
  return process.env.SUPPORT_EMAIL || 'theluminousbookshop@outlook.com';
}

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] support route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function cleanShort(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function createSupportRouter({ getPool: pool0 }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(pool0())(req, res, next);

  router.post('/support/report', auth, async (req, res) => {
    try {
      const pool = pool0();
      if (!pool) throw err(503, 'database_not_configured', 'Database is not configured.');
      // A restricted recovery session can only change the account
      // email — it must never file reports. (server/app.js refuses
      // it earlier still; this check keeps the rule local.)
      if (req.sessionScope === 'recovery') {
        throw err(403, 'recovery_scope', 'This sign-in can only finish changing your account email.');
      }
      const user = req.user;
      const body = req.body && typeof req.body === 'object' ? req.body : {};

      const category = typeof body.category === 'string' ? body.category.trim() : '';
      if (!SUPPORT_CATEGORIES.includes(category)) {
        throw err(400, 'support_invalid_category', 'Please choose what this report is about.');
      }
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message) {
        throw err(400, 'support_message_required', 'Please tell us what happened.');
      }
      if (message.length < SUPPORT_MESSAGE_MIN) {
        throw err(400, 'support_message_too_short', 'Please tell us a little more — a sentence or two helps us find it.');
      }
      if (message.length > SUPPORT_MESSAGE_MAX) {
        throw err(400, 'support_message_too_long', 'That is longer than a report can hold — please trim it a little and send again.');
      }

      // Rate limit, counted from the table: the rolling-24h count
      // includes only reports that actually landed.
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) AS count FROM support_reports
          WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
        [user.id],
      );
      if (Number(countRows[0]?.count ?? 0) >= SUPPORT_MAX_PER_DAY) {
        throw err(429, 'support_rate_limited', 'You have sent several reports today. Please wait until tomorrow to send more, so every report can be read properly.');
      }

      // Fixing context from server-side truth. The selected
      // business is the caller's active business; it is attached
      // only when the caller verifiably belongs to it.
      let businessId = null;
      let businessName = '';
      let role = '';
      let plan = null;
      const activeId = user.active_business_id || null;
      if (activeId) {
        const access = await resolveAccess(pool, user, activeId);
        if (access) {
          businessId = activeId;
          businessName = access.business?.name || '';
          role = access.isOwner ? 'owner' : personLevel(access.staffRow);
          const entitlement = await entitlementFor(pool, activeId);
          plan = entitlement ? (entitlement.plan === 'business' ? 'business' : 'essentials') : null;
        }
      }
      const page = cleanShort(body.page, 300);
      const locale = cleanShort(body.locale, 16);
      const userAgent = cleanShort(req.headers['user-agent'] || '', 400);
      const context = { page, plan, locale, user_agent: userAgent };

      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO support_reports
           (id, user_id, reporter_email, business_id, business_name, role, category, message, context, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new')`,
        [id, user.id, user.email || '', businessId, businessName, role, category, message, JSON.stringify(context)],
      );

      // Notification copy. A mail failure never loses the report
      // and never fails the user's send — the row above is the
      // record of truth; the failure is logged for the team.
      try {
        await sendMail(supportReportEmail({
          to: supportInbox(),
          reporterEmail: user.email || '',
          categoryLabel: SUPPORT_CATEGORY_LABELS[category],
          message,
          reportId: id,
          page,
          businessName,
          role,
          plan: plan ? (plan === 'business' ? 'Business' : 'Essentials') : '',
          locale,
          userAgent,
        }));
      } catch (mailError) {
        console.error('[twin] support report email failed:', mailError.message);
      }

      return res.status(201).json({ ok: true, id });
    } catch (error) {
      return handleError(res, error);
    }
  });

  return router;
}
