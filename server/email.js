/**
 * Outbound email — Resend (T0 decision Q-A), T2.
 *
 * Reads RESEND_API_KEY from the environment (EMAIL_API_KEY is accepted
 * as a legacy alias). From-address comes from EMAIL_FROM, which is
 * REQUIRED whenever a key is set.
 *
 * FAILS CLOSED: when no key is configured, `sendMail` throws
 * EmailNotConfigured — callers must surface a clear error and must
 * NOT pretend the mail went out. No fake success, ever.
 *
 * Testing: tests inject an in-memory sink with `__setMailSink(fn)`
 * (captures { to, subject, text, html, attachments }); no real email
 * is ever sent from a test. Local development may set
 * EMAIL_LOG_SINK=1 (and only with NODE_ENV != 'production') to log
 * mail to the console instead of sending — DEV ONLY, never on Fly,
 * never in production.
 *
 * Attachments (Send-PO phase): `attachments` is an array of
 * { filename, content } where content is a Buffer or a base64 string.
 * Resend takes base64 content; the sink keeps the raw Buffer so tests
 * can inspect exactly what would have gone out.
 *
 * Trial reminders (owner decision 2026-11-12: ON) are composed here
 * too — trialReminderDay4Email / trialReminderFinalEmail below; the
 * scheduling + idempotency live in server/trialReminders.js.
 */
import { config } from './config.js';
import { emailStringsFor, fillEmail } from './emailStrings.js';

/**
 * The language an account reads in, resolved server-side. The
 * person's own language home comes first (users.language,
 * migration 052 — the language they picked, carried on the
 * account itself). Until an account is seeded, the fallbacks
 * mirror the shell's seeding order: the business the person is
 * standing in (their active business), then the first business
 * the account owns, then any business it belongs to, else null
 * (callers fall back to the request's language, then English).
 */
export async function resolveAccountLanguage(pool, userId) {
  if (!pool || !userId) return null;
  try {
    const account = await pool.query(
      'SELECT language, active_business_id FROM users WHERE id = $1',
      [userId],
    );
    if (account.rows[0]?.language) return account.rows[0].language;
    const activeBusinessId = account.rows[0]?.active_business_id;
    if (activeBusinessId) {
      const active = await pool.query(
        'SELECT language FROM businesses WHERE id = $1',
        [activeBusinessId],
      );
      if (active.rows[0]?.language) return active.rows[0].language;
    }
    const owned = await pool.query(
      'SELECT language FROM businesses WHERE owner_id = $1 ORDER BY created_at ASC LIMIT 1',
      [userId],
    );
    if (owned.rows[0]?.language) return owned.rows[0].language;
    const member = await pool.query(
      `SELECT b.language FROM business_memberships m
         JOIN businesses b ON b.id = m.business_id
        WHERE m.user_id = $1 ORDER BY b.created_at ASC LIMIT 1`,
      [userId],
    );
    return member.rows[0]?.language || null;
  } catch {
    return null;
  }
}

export class EmailNotConfigured extends Error {
  constructor(detail) {
    super(detail || 'Email is not configured');
    this.name = 'EmailNotConfigured';
    this.code = 'email_not_configured';
  }
}

let mailSink = null;

/** Test-only injection point. Pass null to restore real sending. */
export function __setMailSink(fn) {
  mailSink = fn;
}

function resendApiKey() {
  return process.env.RESEND_API_KEY || process.env.EMAIL_API_KEY || '';
}

function emailFrom() {
  return process.env.EMAIL_FROM || '';
}

export function emailConfigured() {
  return Boolean(resendApiKey());
}

/**
 * Normalize caller attachments to [{ filename, content: Buffer }].
 * Accepts a Buffer or a base64 string as content; anything else is a
 * caller bug and throws before any send is attempted.
 */
function normalizeAttachments(attachments) {
  if (!attachments) return [];
  if (!Array.isArray(attachments)) throw new Error('sendMail attachments must be an array');
  return attachments.map((att) => {
    if (!att?.filename) throw new Error('sendMail attachment requires a filename');
    if (Buffer.isBuffer(att.content)) return { filename: String(att.filename), content: att.content };
    if (typeof att.content === 'string') {
      return { filename: String(att.filename), content: Buffer.from(att.content, 'base64') };
    }
    throw new Error('sendMail attachment content must be a Buffer or a base64 string');
  });
}

/**
 * Send one email. Throws EmailNotConfigured when sending is impossible.
 * Returns { id } on success (Resend's message id, or 'sink' / 'log' for
 * the test/dev paths). `to`, `subject`, `text` are required; `html` is
 * optional (plain-text fallback is used when omitted). `attachments`
 * is optional — see the header note.
 */
export async function sendMail({ to, subject, text, html, attachments }) {
  if (!to || !subject || !text) {
    throw new Error('sendMail requires to, subject and text');
  }
  const files = normalizeAttachments(attachments);
  if (mailSink) {
    const message = { to, subject, text, html: html || text, attachments: files };
    await mailSink(message);
    return { id: 'sink' };
  }
  // DEV ONLY: an explicit local log sink replaces sending entirely, so
  // the register -> verify loop can be exercised without a Resend key.
  // Gated on NODE_ENV != 'production' AND an explicit flag — in
  // production this branch can never run and the key is required.
  if (config.nodeEnv !== 'production' && process.env.EMAIL_LOG_SINK === '1') {
    console.log(`[twin] DEV EMAIL LOG SINK — to: ${to} | subject: ${subject}\n${text}`);
    return { id: 'log' };
  }
  const apiKey = resendApiKey();
  if (!apiKey) {
    throw new EmailNotConfigured(
      'RESEND_API_KEY is not set — verification and reset emails cannot be sent.',
    );
  }
  const from = emailFrom();
  if (!from) {
    throw new EmailNotConfigured(
      'EMAIL_FROM is not set — a sender address is required whenever RESEND_API_KEY is set.',
    );
  }
  const payload = { from, to, subject, text, html: html || text };
  if (files.length) {
    payload.attachments = files.map((file) => ({
      filename: file.filename,
      content: file.content.toString('base64'),
    }));
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend rejected the email (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data = await response.json().catch(() => ({}));
  return { id: data.id || 'unknown' };
}

/** Recovery-kit code mail: confirming a backup (spare-key) email. */
export function backupEmailCodeEmail({ to, code, lang }) {
  const s = emailStringsFor(lang);
  return { to, subject: s['backup.subject'], text: fillEmail(s['backup.body'], { code }) };
}

/** Recovery-kit code mail: the 6-digit entry code sent to the BACKUP email. */
export function accountRecoveryCodeEmail({ to, code, lang }) {
  const s = emailStringsFor(lang);
  return { to, subject: s['recovery.subject'], text: fillEmail(s['recovery.body'], { code }) };
}

/** Recovery-kit code mail: proving ownership of a NEW account email. */
export function newEmailCodeEmail({ to, code, lang }) {
  const s = emailStringsFor(lang);
  return { to, subject: s['newEmail.subject'], text: fillEmail(s['newEmail.body'], { code }) };
}

/**
 * Notice that an account's email was changed. Sent to the OLD address
 * (and to the verified backup address) after every successful change.
 * The new address is masked: if the old mailbox is the compromised
 * one, the notice must not hand over where the account went.
 */
export function emailChangedNoticeEmail({ to, newEmail, lang }) {
  const s = emailStringsFor(lang);
  const [namePart, domainPart] = String(newEmail || '').split('@');
  const masked = namePart && domainPart ? `${namePart.slice(0, 1)}•••@${domainPart}` : s['changed.newAddress'];
  return {
    to,
    subject: s['changed.subject'],
    text: fillEmail(s['changed.body'], { masked }),
  };
}

/**
 * Purchase-order email (Send-PO phase) — sent from inside the app to
 * the supplier's contact address, with the PO PDF attached.
 *
 * WHITE-LABEL ABSOLUTE (owner's rule): the subject, body and closing
 * carry ONLY the sending business's own name. The app's name appears
 * NOWHERE — a supplier receiving this sees an order from the store
 * they sell to, and nothing else. Composed in the business's own
 * language (leftovers sweep, Nov 15, 2026); the white-label rule is
 * about names, and it holds in every language.
 */
export function purchaseOrderEmail({ to, businessName, currency, order, lang }) {
  const s = emailStringsFor(lang);
  const from = String(businessName || '').trim();
  const money = (value) => {
    const amount = Number(value) || 0;
    try {
      return new Intl.NumberFormat(lang && lang !== 'en' ? lang : 'en-US', {
        style: 'currency',
        currency: currency || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `$${amount.toFixed(2)}`;
    }
  };
  const lines = [
    s['common.hello'],
    '',
    fillEmail(s['po.helloLine'], { number: order.number || '', business: from }),
    '',
  ];
  if (order.supplier_name) lines.push(fillEmail(s['po.supplier'], { name: order.supplier_name }));
  if (order.order_date) lines.push(fillEmail(s['po.orderDate'], { date: order.order_date }));
  if (order.expected_date) lines.push(fillEmail(s['po.expectedBy'], { date: order.expected_date }));
  lines.push(fillEmail(s['po.total'], { amount: money(order.total) }));
  lines.push('');
  lines.push(s['po.fullOrder']);
  if (order.note) {
    lines.push('');
    lines.push(fillEmail(s['po.note'], { note: order.note }));
  }
  lines.push('');
  lines.push(s['po.thanks']);
  lines.push(from);
  return {
    to,
    subject: fillEmail(s['po.subject'], { number: order.number || '', business: from }),
    text: lines.join('\n'),
  };
}

/**
 * Trial reminder emails (owner's Nov 7 design, switched ON
 * 2026-11-12). Exactly TWO emails per trial, composed in the
 * subscriber's own language (leftovers sweep, Nov 15, 2026). These
 * are the app writing to its OWN subscriber about their
 * subscription, so the app's name is correct here (the white-label
 * rule governs supplier documents, not StockHaven's own account
 * mail).
 *
 * Truthfulness branch: a subscriber who already cancelled during the
 * trial keeps the full 7 days and is charged NOTHING — their copy
 * says the plan simply ends. Everyone else is told the paid plan
 * starts when the trial ends unless they cancel first. Cancelling
 * lives in Settings → Billing, and both templates say so.
 */
function trialDateLine(trialEndsAt, lang) {
  const ends = trialEndsAt ? new Date(trialEndsAt) : null;
  if (!ends || Number.isNaN(ends.getTime())) return '';
  return ends.toLocaleDateString(lang && lang !== 'en' ? lang : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function trialReminderDay4Email({ to, plan, trialEndsAt, cancelAtPeriodEnd, lang }) {
  const s = emailStringsFor(lang);
  const planName = plan === 'business' ? 'Business' : 'Essentials';
  const dateLine = trialDateLine(trialEndsAt, lang);
  const text = [
    s['common.hello'],
    '',
    fillEmail(s['day4.opening'], { planName }),
    dateLine ? fillEmail(s['day4.endsOn'], { date: dateLine }) : s['day4.endsSoon'],
    '',
    ...(cancelAtPeriodEnd ? [s['day4.cancelled']] : [s['day4.active']]),
    '',
    s['day4.more'],
    '',
    s['common.signature'],
  ].join('\n');
  return { to, subject: s['day4.subject'], text };
}

export function trialReminderFinalEmail({ to, plan, trialEndsAt, cancelAtPeriodEnd, lang }) {
  const s = emailStringsFor(lang);
  const planName = plan === 'business' ? 'Business' : 'Essentials';
  const dateLine = trialDateLine(trialEndsAt, lang);
  const text = [
    s['common.hello'],
    '',
    s['final.opening'],
    dateLine
      ? fillEmail(s['final.endsOn'], { planName, date: dateLine })
      : fillEmail(s['final.endsSoon'], { planName }),
    '',
    ...(cancelAtPeriodEnd ? [s['final.cancelled']] : [s['final.active']]),
    '',
    s['common.signature'],
  ].join('\n');
  return { to, subject: s['final.subject'], text };
}

/**
 * The failed-payment warning email (release 341, owner's ruling
 * Nov 19, 2026): sent ONCE per failed-payment episode, 3 days
 * before the 14-day full-use grace ends, to the OWNER only, in
 * the owner's own language. Scheduling + the claim ledger live in
 * server/failedPayment.js (runFailedPaymentSweep). Like the trial
 * reminders, this is the app writing to its own subscriber about
 * their subscription, so the app's name is correct here.
 */
export function paymentFailedWarningEmail({ to, plan, graceEndsAt, lang }) {
  const s = emailStringsFor(lang);
  const planName = plan === 'business' ? 'Business' : 'Essentials';
  const dateLine = trialDateLine(graceEndsAt, lang);
  return {
    to,
    subject: s['payfail.subject'],
    text: fillEmail(s['payfail.body'], { planName, date: dateLine }),
  };
}

/**
 * Support report email (Support phase) — a copy of a "Report a
 * problem" note filed from inside the app, sent to the owner's
 * support inbox. OPERATOR MAIL: this goes to the platform operator's
 * own inbox (not to a subscriber), so it stays in the operator's
 * working language — the reporter's own words ride verbatim in the
 * body, in whatever language they wrote them. The database row is
 * the record of truth; this mail is the notification, and the
 * reporter address rides in the body so the owner can reply to the
 * person directly. Carries NO inventory data — only what the
 * reporter wrote and the fixing context the app attaches openly
 * (the form tells the user exactly what is included before they
 * send).
 */
export function supportReportEmail({
  to, reporterEmail, categoryLabel, message, reportId,
  page, businessName, role, plan, locale, userAgent,
}) {
  const lines = [
    'A Luminous StockHaven user reported a problem from inside the app.',
    '',
    `Category: ${categoryLabel}`,
    `From: ${reporterEmail || 'unknown'} — reply to them at that address.`,
    '',
    'What they wrote:',
    String(message || ''),
    '',
    'Details the app attached automatically:',
    `- Page they were on: ${page || 'not recorded'}`,
    `- Business: ${businessName || 'none selected'}`,
    `- Their role there: ${role || 'none'}`,
    `- Plan: ${plan || 'none'}`,
    `- App language: ${locale || 'not recorded'}`,
    `- Device / browser: ${userAgent || 'not recorded'}`,
    '',
    `The report is saved in the app database (id ${reportId}, status new) — this email is a copy.`,
    '',
    '— Luminous StockHaven',
  ];
  return {
    to,
    subject: `Problem report: ${categoryLabel} — Luminous StockHaven`,
    text: lines.join('\n'),
  };
}

/**
 * Account-deletion REQUEST email (Deletion-request phase,
 * Nov 14, 2026) — the notification copy of a request filed from
 * Settings → Delete account, sent to the owner's support inbox.
 * The request is a REQUEST FOR REVIEW: this mail says, in words,
 * that nothing has been deleted and billing is untouched — the
 * database row is the record of truth and the review happens by
 * a person, never automatically from this mail.
 */
export function deletionRequestEmail({ to, requesterEmail, requestId, requestedAt }) {
  const lines = [
    'A Luminous StockHaven user has asked for their account to be deleted.',
    '',
    `From: ${requesterEmail || 'unknown'} — the account email on the request.`,
    `Requested at: ${requestedAt || 'not recorded'}`,
    '',
    'This is a request for review only. Nothing has been deleted,',
    'and the account’s billing has not been changed. Review the',
    'request in the app database (account_deletion_requests,',
    `id ${requestId}, status requested) and handle it by hand.`,
    '',
    '— Luminous StockHaven',
  ];
  return {
    to,
    subject: 'Account deletion request — Luminous StockHaven',
    text: lines.join('\n'),
  };
}

export function staffInviteEmail({ to, businessName, inviterName, lang, registerUrl }) {
  const s = emailStringsFor(lang);
  const body = fillEmail(s['invite.body'], {
    business: businessName || s['invite.aBusiness'],
    byInviter: inviterName ? fillEmail(s['invite.byInviter'], { inviterName }) : '',
  });
  // The direct door (Nov 19, 2026): the invite used to tell the
  // person to "create your account with this email address" and
  // take them NOWHERE — they had to hunt from the sign-in page.
  // Now the email carries a link straight to the Create your
  // account page with their invited email pre-filled. Since Nov
  // 22, 2026 the link also carries the row's single-use invite
  // token (server/inviteLinks.js): the first open claims the
  // link for that browser session, and the staff row activates
  // only when the link completes — the owner's single-use
  // ruling. Creating the account still requires setting a
  // password and entering the verification code sent to that
  // same inbox.
  const linkLine = registerUrl ? fillEmail(s['invite.linkLine'], { registerUrl }) : '';
  return {
    to,
    subject: fillEmail(s['invite.subject'], { business: businessName || 'Luminous StockHaven' }),
    text: linkLine ? `${body}\n\n${linkLine}` : body,
  };
}

export function verificationEmail({ to, code, lang }) {
  const s = emailStringsFor(lang);
  return {
    to,
    subject: s['verify.subject'],
    text: fillEmail(s['verify.body'], { code }),
  };
}

export function passwordResetEmail({ to, resetUrl, code, lang }) {
  const s = emailStringsFor(lang);
  return {
    to,
    subject: s['reset.subject'],
    text: fillEmail(s['reset.body'], { resetUrl, code }),
  };
}
