/**
 * In-app trial notices.
 *
 * Concepcion's three notices, shown inside the app (Dashboard banner
 * and Plan summary card), computed from the verified trial end date
 * the server already stores on the entitlement record:
 *
 *   "You have 5 more days left on your trial."   (5 days left)
 *   "You have 3 more days left on your trial."   (3 days left)
 *   "24 hours until your trial ends."            (last 24 hours)
 *
 * The windows are disjoint, so at most one notice ever shows. Outside
 * them — more than 5 days left, between 3 and 5 days, between 1 and 3
 * days, or after the trial — nothing shows. These are notices only:
 * they never send email, never change access, and never confirm a
 * scheduled payment. The two reminder EMAILS (day 4 and 24 hours)
 * live separately in base44/shared/trialReminderDelivery.js.
 *
 * T6.3: the messages are getters, not import-time t() calls, so a
 * language switch re-renders them live instead of freezing the locale
 * that was active when this module first loaded.
 */

import { t } from './i18n.js';

const HOUR_MS = 60 * 60 * 1000;

export const IN_APP_NOTICE_MESSAGES = Object.freeze({
  get 'five-day'() { return t('plans.trialNoticeFiveDay'); },
  get 'three-day'() { return t('plans.trialNoticeThreeDay'); },
  get 'one-day'() { return t('plans.trialNoticeOneDay'); },
});

/**
 * The notice for a real (paid) trial record, or null.
 *
 * Only records with status 'trialing' and a parseable trial_ends_at
 * qualify. Complimentary pre-launch previews are NOT trials — they
 * keep their own banner copy and return null here.
 *
 * The windows are tied to whole days left, so the words are always
 * true: "5 more days" only shows while 5 whole days are left
 * (96–120 hours), "3 more days" only while 3 are left (48–72
 * hours), and "24 hours" only in the last day. In between — 4 days
 * left, 2 days left, 6–7 days left — nothing shows.
 */
export function trialInAppNotice(record, now = Date.now()) {
  if (!record || record.status !== 'trialing') return null;
  if (typeof record.trial_ends_at !== 'string') return null;
  const endsMs = Date.parse(record.trial_ends_at);
  if (!Number.isFinite(endsMs) || !Number.isFinite(now)) return null;
  const remainingMs = endsMs - now;
  if (remainingMs <= 0) return null;
  let stage = null;
  if (remainingMs <= 24 * HOUR_MS) stage = 'one-day';
  else if (remainingMs > 48 * HOUR_MS && remainingMs <= 72 * HOUR_MS) stage = 'three-day';
  else if (remainingMs > 96 * HOUR_MS && remainingMs <= 120 * HOUR_MS) stage = 'five-day';
  if (!stage) return null;
  return { stage, message: IN_APP_NOTICE_MESSAGES[stage] };
}
