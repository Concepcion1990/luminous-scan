/**
 * T41 helpers — invite hardening (Nov 22, 2026). Boots the real
 * app via the T4 harness (through T40's re-exports, which carry
 * the blocklist fixtures) and adds the invite fixtures.
 */
export * from '../t40/helpers.js';
import { pool, mailbox } from '../t40/helpers.js';

export async function staffRow(businessId, email) {
  const { rows } = await pool.query(
    'SELECT * FROM staff_members WHERE business_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1',
    [businessId, email],
  );
  return rows[0] || null;
}

/** The invite email for an address: the mailbox entry whose
 * text carries the tokened register link. Latest one wins. */
export function inviteMail(email) {
  return mailbox.filter((m) => m.to === email && String(m.text || '').includes('invite=')).at(-1) || null;
}

export function tokenFromMail(message) {
  const m = String(message?.text || '').match(/invite=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
