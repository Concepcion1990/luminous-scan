/**
 * Rewards routes — staff rewards & incentives (Rewards phase).
 *
 *   GET  /api/businesses/:bid/workforce/rewards           scoped list
 *   POST /api/businesses/:bid/workforce/rewards           give a reward
 *   POST /api/businesses/:bid/workforce/rewards/redeem    { code } mark used at the till
 *   POST /api/businesses/:bid/workforce/rewards/:id/void  void an active reward
 *
 * The owner's design (Nov 9, 2026): a place where the manager — or
 * the owner, who oversees the manager — can give rewards to team
 * members for doing a good job: a percent-off in-store discount, a
 * gift card to anywhere, or any incentive the giver describes.
 *
 * BUSINESS PLAN ONLY (her explicit correction: "business, not
 * business plus") — every route here refuses Essentials with the
 * standard plan_gated error, reads included, and the Workforce page
 * shows Essentials the locked door instead of hiding the tab.
 *
 * Hierarchy (decided server-side from the caller's staff row,
 * never trusted from the client):
 *   - The OWNER gives to ANYONE (staff and managers).
 *   - A MANAGER gives to STAFF only — never to themselves, never
 *     to another manager, never to the owner (the owner is not a
 *     staff row, so there is nobody to give to).
 *   - The owner sees every reward in the business; a manager sees
 *     the rewards they gave + the rewards given to them; staff see
 *     only their own.
 *   - Void: the giver or the owner. A manager cannot void the
 *     owner's gift.
 *   - Redeem: any owner/manager marks a reward used by its code.
 *     Redeeming twice is refused; a void reward cannot be redeemed.
 *
 * The code lives in the app: the recipient shows it, the till side
 * looks it up / redeems it here. Live POS redemption arrives with
 * the POS phase. Giving a reward rings the recipient's bell
 * (workforce_notifications, the workforce pattern).
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from './sessions.js';
import { resolveAccess } from './authz.js';
import { assertNotInGrace } from './billing.js';
import { personLevel } from './workforceRoutes.js';

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function handleError(res, error) {
  if (error?.status) {
    return res.status(error.status).json({ error: error.code || 'error', message: error.message });
  }
  console.error('[twin] rewards route failed:', error);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch((error) => handleError(res, error));
}

// Same unambiguous alphabet as the backup codes (server/recovery.js):
// no I, L, O, 0 or 1, so a code read aloud or off a slip never blurs.
export const REWARD_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateRewardCode() {
  const raw = Array.from({ length: 8 }, () =>
    REWARD_CODE_ALPHABET[crypto.randomInt(REWARD_CODE_ALPHABET.length)]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** 'abcd 2345', 'ABCD2345' and 'ABCD-2345' all mean the same code. */
export function normalizeRewardCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function publicReward(row) {
  return {
    ...row,
    percent_value: row.percent_value == null ? null : Number(row.percent_value),
    amount: row.amount == null ? null : Number(row.amount),
  };
}

export function createRewardsRouter({ getPool: getPoolFn }) {
  const router = Router();
  const auth = (req, res, next) => requireAuth(getPoolFn())(req, res, next);
  router.use(auth);

  const pool = () => {
    const p = getPoolFn();
    if (!p) throw err(503, 'database_not_configured', 'Postgres is not configured yet.');
    return p;
  };
  const base = '/businesses/:bid/workforce/rewards';

  async function ctx(req) {
    const access = await resolveAccess(pool(), req.user, req.params.bid);
    if (!access) throw err(403, 'forbidden', 'You do not have access to this workspace.');
    if (access.planKey !== 'business') {
      throw err(403, 'plan_gated', 'Staff rewards are part of the Business plan.');
    }
    const level = access.isOwner ? 'owner' : personLevel(access.staffRow);
    return { access, level, me: access.staffRow };
  }

  async function scopedRewards(req, { level, me }) {
    // Owner: everything. Manager: gave it OR received it. Staff: own only.
    let query = 'SELECT * FROM rewards WHERE business_id = $1';
    const values = [req.params.bid];
    if (level === 'manager') {
      query += ' AND (giver_user_id = $2 OR recipient_staff_id = $3)';
      values.push(req.user.id, me?.id || 'none');
    } else if (level === 'staff') {
      query += ' AND recipient_staff_id = $2';
      values.push(me?.id || 'none');
    }
    query += ' ORDER BY issued_at DESC, created_at DESC LIMIT 500';
    const { rows } = await pool().query(query, values);
    return rows.map(publicReward);
  }

  async function rewardOr404(businessId, id) {
    const { rows } = await pool().query(
      'SELECT * FROM rewards WHERE id = $1 AND business_id = $2 LIMIT 1',
      [id, businessId],
    );
    if (!rows[0]) throw err(404, 'not_found', 'That reward is not in this business.');
    return rows[0];
  }

  // ---- List (scoped) ----------------------------------------------------

  router.get(base, asyncHandler(async (req, res) => {
    const context = await ctx(req);
    const rewards = await scopedRewards(req, context);
    return res.json({
      rewards,
      level: context.level,
      my_staff_id: context.me?.id || null,
      plan: context.access.planKey,
    });
  }));

  // ---- Give ---------------------------------------------------------------

  router.post(base, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    if (level === 'staff') {
      throw err(403, 'forbidden', 'Rewards are given by the owner or a manager.');
    }
    const body = req.body || {};
    const recipientId = String(body.recipient_staff_id || '');
    const { rows: recipientRows } = await pool().query(
      "SELECT * FROM staff_members WHERE id = $1 AND business_id = $2 AND status = 'active' LIMIT 1",
      [recipientId, req.params.bid],
    );
    const recipient = recipientRows[0];
    if (!recipient) throw err(404, 'not_found', 'That team member is not in this business.');
    const recipientLevel = personLevel(recipient);
    if (level === 'manager' && recipientLevel !== 'staff') {
      throw err(403, 'forbidden', 'Managers give rewards to staff — not to themselves or to another manager. Only the owner rewards a manager.');
    }

    const kind = String(body.kind || '');
    if (!['percent_off', 'gift_card', 'custom'].includes(kind)) {
      throw err(400, 'invalid_value', 'Choose the kind of reward: percent_off, gift_card or custom.');
    }
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title) throw err(400, 'invalid_value', 'Give the reward a name — a few words in your own words.');
    const description = String(body.description || '').trim().slice(0, 1000);
    let percentValue = null;
    let amount = null;
    let currency = '';
    let detail = '';
    if (kind === 'percent_off') {
      percentValue = Number(body.percent_value);
      if (!Number.isFinite(percentValue) || percentValue <= 0 || percentValue > 100) {
        throw err(400, 'invalid_value', 'Percent off must be more than 0 and no more than 100.');
      }
    } else if (kind === 'gift_card') {
      amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw err(400, 'invalid_value', 'Gift card amount must be more than 0.');
      }
      currency = String(body.currency || 'USD').trim().toUpperCase().slice(0, 8) || 'USD';
    } else {
      detail = String(body.detail || '').trim().slice(0, 1000);
      if (!detail) throw err(400, 'invalid_value', 'Describe the reward in your own words.');
    }

    const giverName = access.isOwner ? 'Owner' : me?.full_name || req.user.email;
    let reward = null;
    // Codes are unique per business (UNIQUE (business_id, code));
    // a collision simply draws a new code.
    for (let attempt = 0; attempt < 10 && !reward; attempt += 1) {
      const id = crypto.randomUUID();
      try {
        const inserted = await pool().query(
          `INSERT INTO rewards
             (id, business_id, recipient_staff_id, recipient_name, recipient_email,
              giver_user_id, giver_staff_id, giver_name, giver_role,
              kind, title, description, percent_value, amount, currency, detail, code)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
           RETURNING *`,
          [
            id, req.params.bid, recipient.id, recipient.full_name, recipient.email,
            req.user.id, access.isOwner ? null : me?.id || null, giverName, level,
            kind, title, description, percentValue, amount, currency, detail,
            generateRewardCode(),
          ],
        );
        reward = inserted.rows[0];
      } catch (error) {
        if (!/unique|duplicate/i.test(String(error?.message || ''))) throw error;
      }
    }
    if (!reward) throw err(500, 'code_generation_failed', 'Could not draw a fresh reward code. Please try again.');

    // The recipient's bell rings (workforce notification pattern).
    const recipientUser = (
      await pool().query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [recipient.email])
    ).rows[0];
    if (recipientUser && recipientUser.id !== req.user.id) {
      await pool().query(
        `INSERT INTO workforce_notifications
           (id, business_id, recipient_user_id, recipient_staff_id, recipient_role, actor_staff_id, actor_name, event, detail, entry_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'reward_received', $8, $9)`,
        [
          crypto.randomUUID(), req.params.bid, recipientUser.id, recipient.id, recipientLevel,
          access.isOwner ? null : me?.id || null, giverName,
          `${giverName} gave you a reward: ${reward.title} — show code ${reward.code} at the till.`,
          reward.id,
        ],
      );
    }
    return res.status(201).json({ reward: publicReward(reward) });
  }));

  // ---- Redeem by code (at the till) ----------------------------------------

  router.post(`${base}/redeem`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    if (level === 'staff') {
      throw err(403, 'forbidden', 'Rewards are marked used by the owner or a manager.');
    }
    const code = normalizeRewardCode(req.body?.code);
    if (!code) throw err(400, 'invalid_value', 'Type the reward code.');
    // Compared in code, not SQL: pg-mem (the test database) has no
    // REPLACE(), and codes are unique per business, so a scoped
    // scan-and-match is exact.
    const { rows } = await pool().query(
      'SELECT * FROM rewards WHERE business_id = $1 ORDER BY issued_at DESC LIMIT 500',
      [req.params.bid],
    );
    const reward = rows.find((row) => normalizeRewardCode(row.code) === code);
    if (!reward) throw err(404, 'code_not_found', 'No reward in this business has that code.');
    if (reward.status === 'redeemed') {
      throw err(400, 'already_redeemed', 'That reward was already used — each code works once.');
    }
    if (reward.status === 'void') {
      throw err(400, 'reward_void', 'That reward was voided and cannot be used.');
    }
    const updated = await pool().query(
      `UPDATE rewards
          SET status = 'redeemed', redeemed_at = NOW(), redeemed_by_id = $1,
              redeemed_by_staff_id = $2, redeemed_by_name = $3, redeemed_by_role = $4,
              updated_at = NOW()
        WHERE id = $5 RETURNING *`,
      [
        req.user.id, access.isOwner ? null : me?.id || null,
        access.isOwner ? 'Owner' : me?.full_name || req.user.email, level, reward.id,
      ],
    );
    return res.json({ reward: publicReward(updated.rows[0]) });
  }));

  // ---- Void ------------------------------------------------------------------

  router.post(`${base}/:id/void`, asyncHandler(async (req, res) => {
    const { access, level, me } = await ctx(req);
    await assertNotInGrace(pool(), req.params.bid);
    if (level === 'staff') {
      throw err(403, 'forbidden', 'Rewards are voided by the giver or the owner.');
    }
    const reward = await rewardOr404(req.params.bid, req.params.id);
    const isGiver = reward.giver_user_id === req.user.id;
    if (!access.isOwner && !isGiver) {
      throw err(403, 'forbidden', 'Only the giver or the owner can void a reward — a manager cannot void the owner\u2019s gift.');
    }
    if (reward.status !== 'active') {
      throw err(400, 'not_active', 'Only a reward that is still ready to use can be voided.');
    }
    const updated = await pool().query(
      `UPDATE rewards
          SET status = 'void', voided_at = NOW(), voided_by_id = $1,
              voided_by_staff_id = $2, voided_by_name = $3, voided_by_role = $4,
              updated_at = NOW()
        WHERE id = $5 RETURNING *`,
      [
        req.user.id, access.isOwner ? null : me?.id || null,
        access.isOwner ? 'Owner' : me?.full_name || req.user.email, level, reward.id,
      ],
    );
    return res.json({ reward: publicReward(updated.rows[0]) });
  }));

  return router;
}
