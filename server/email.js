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
export function backupEmailCodeEmail({ to, code }) {
  const subject = 'Your Luminous StockHaven backup email code';
  const text = [
    'Hello,',
    '',
    `Your Luminous StockHaven backup email code is ${code}. It expires in 10 minutes.`,
    '',
    'You (or someone signed in as you) asked to set this address as the',
    'backup email for a Luminous StockHaven account — the spare key that',
    'can help recover the account if the main email is ever lost.',
    'Only finish this step if you recognize it.',
    '',
    '— Luminous StockHaven',
  ].join('\n');
  return { to, subject, text };
}

/** Recovery-kit code mail: the 6-digit entry code sent to the BACKUP email. */
export function accountRecoveryCodeEmail({ to, code }) {
  const subject = 'Your Luminous StockHaven account recovery code';
  const text = [
    'Hello,',
    '',
    `Your Luminous StockHaven account recovery code is ${code}. It expires in 10 minutes.`,
    '',
    'Someone asked to recover a Luminous StockHaven account using this',
    'backup email. The code only opens the change-email step — it cannot',
    'sign anyone in, and nothing else about the account can be reached',
    'with it. If this was not you, you can ignore this email; the code',
    'expires on its own.',
    '',
    '— Luminous StockHaven',
  ].join('\n');
  return { to, subject, text };
}

/** Recovery-kit code mail: proving ownership of a NEW account email. */
export function newEmailCodeEmail({ to, code }) {
  const subject = 'Confirm your new Luminous StockHaven email';
  const text = [
    'Hello,',
    '',
    `Your Luminous StockHaven new email code is ${code}. It expires in 10 minutes.`,
    '',
    'Enter this code to finish moving a Luminous StockHaven account to',
    'this address. Your shop, your inventory and your team access move',
    'with it — nothing is left behind, and no new free trial starts.',
    'If you did not ask for this, ignore this email.',
    '',
    '— Luminous StockHaven',
  ].join('\n');
  return { to, subject, text };
}

/**
 * Notice that an account's email was changed. Sent to the OLD address
 * (and to the verified backup address) after every successful change.
 * The new address is masked: if the old mailbox is the compromised
 * one, the notice must not hand over where the account went.
 */
export function emailChangedNoticeEmail({ to, newEmail }) {
  const subject = 'Your Luminous StockHaven account email was changed';
  const [namePart, domainPart] = String(newEmail || '').split('@');
  const masked = namePart && domainPart ? `${namePart.slice(0, 1)}•••@${domainPart}` : 'a new address';
  const text = [
    'Hello,',
    '',
    `The email on your Luminous StockHaven account was changed to ${masked}.`,
    'Your shop, inventory and history moved with the account.',
    '',
    "If this was you, no action is needed. If this was NOT you, contact",
    'us right away — reply to this email or reach us through',
    'theluminousbookshop.com — and we will help you secure your account.',
    '',
    '— Luminous StockHaven',
  ].join('\n');
  return { to, subject, text };
}

/**
 * Purchase-order email (Send-PO phase) — sent from inside the app to
 * the supplier's contact address, with the PO PDF attached.
 *
 * WHITE-LABEL ABSOLUTE (owner's rule): the subject, body and closing
 * carry ONLY the sending business's own name. The app's name appears
 * NOWHERE — a supplier receiving this sees an order from the store
 * they sell to, and nothing else. Composed server-side in English
 * per the codebase convention (like notification detail strings).
 */
export function purchaseOrderEmail({ to, businessName, currency, order }) {
  const from = String(businessName || '').trim();
  const money = (value) => {
    const amount = Number(value) || 0;
    try {
      return new Intl.NumberFormat('en-US', {
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
    'Hello,',
    '',
    `Please find attached purchase order ${order.number || ''} from ${from}.`,
    '',
  ];
  if (order.supplier_name) lines.push(`Supplier: ${order.supplier_name}`);
  if (order.order_date) lines.push(`Order date: ${order.order_date}`);
  if (order.expected_date) lines.push(`Expected by: ${order.expected_date}`);
  lines.push(`Total: ${money(order.total)}`);
  lines.push('');
  lines.push('The full order — every line, quantity and price — is in the attached PDF.');
  if (order.note) {
    lines.push('');
    lines.push(`Note: ${order.note}`);
  }
  lines.push('');
  lines.push('Thank you,');
  lines.push(from);
  return {
    to,
    subject: `Purchase order ${order.number || ''} from ${from}`,
    text: lines.join('\n'),
  };
}

/**
 * Trial reminder emails (owner's Nov 7 design, switched ON
 * 2026-11-12). Exactly TWO emails per trial, composed server-side in
 * English per the codebase convention. These are the app writing to
 * its OWN subscriber about their subscription, so the app's name is
 * correct here (the white-label rule governs supplier documents, not
 * StockHaven's own account mail).
 *
 * Truthfulness branch: a subscriber who already cancelled during the
 * trial keeps the full 7 days and is charged NOTHING — their copy
 * says the plan simply ends. Everyone else is told the paid plan
 * starts when the trial ends unless they cancel first. Cancelling
 * lives in Settings → Billing, and both templates say so.
 */
function trialDateLine(trialEndsAt) {
  const ends = trialEndsAt ? new Date(trialEndsAt) : null;
  if (!ends || Number.isNaN(ends.getTime())) return '';
  return ends.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export function trialReminderDay4Email({ to, plan, trialEndsAt, cancelAtPeriodEnd }) {
  const planName = plan === 'business' ? 'Business' : 'Essentials';
  const dateLine = trialDateLine(trialEndsAt);
  const text = [
    'Hello,',
    '',
    `You are on day 4 of your 7-day free trial of Luminous StockHaven ${planName}.`,
    dateLine ? `Your trial ends on ${dateLine}.` : 'Your trial ends in about three days.',
    '',
    ...(cancelAtPeriodEnd
      ? [
        'You have already cancelled, so no charge is coming: your plan',
        'simply ends when the trial ends, and everything stays yours',
        'until then. Nothing more will be billed.',
      ]
      : [
        'When the trial ends, your paid plan starts and the card from',
        'checkout is charged — unless you cancel before then. Cancelling',
        'during the trial still keeps the full 7 days.',
        'To cancel: open Settings, then Billing, in the app.',
      ]),
    '',
    'We will write once more, 24 hours before the trial ends.',
    '',
    '— Luminous StockHaven',
  ].join('\n');
  return { to, subject: 'Day 4 of your Luminous StockHaven trial', text };
}

export function trialReminderFinalEmail({ to, plan, trialEndsAt, cancelAtPeriodEnd }) {
  const planName = plan === 'business' ? 'Business' : 'Essentials';
  const dateLine = trialDateLine(trialEndsAt);
  const text = [
    'Hello,',
    '',
    '24 hours until your trial ends.',
    dateLine
      ? `Your 7-day free trial of Luminous StockHaven ${planName} ends on ${dateLine}.`
      : `Your 7-day free trial of Luminous StockHaven ${planName} ends within the next day.`,
    '',
    ...(cancelAtPeriodEnd
      ? [
        'You have already cancelled, so this is only a goodbye note:',
        'no charge is coming, and your plan ends when the trial ends.',
      ]
      : [
        'When the trial ends, your paid plan starts and the card from',
        'checkout is charged. If you do not want that, cancel before the',
        'trial ends: open Settings, then Billing, in the app. Cancelling',
        'now still keeps the app fully yours until the trial ends.',
      ]),
    '',
    '— Luminous StockHaven',
  ].join('\n');
  return { to, subject: '24 hours until your Luminous StockHaven trial ends', text };
}

/**
 * Support report email (Support phase) — a copy of a "Report a
 * problem" note filed from inside the app, sent to the owner's
 * support inbox. The database row is the record of truth; this mail
 * is the notification, and the reporter address rides in the body so
 * the owner can reply to the person directly. Composed in English
 * per the codebase convention (like notification detail strings).
 * Carries NO inventory data — only what the reporter wrote and the
 * fixing context the app attaches openly (the form tells the user
 * exactly what is included before they send).
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

export function staffInviteEmail({ to, businessName, inviterName }) {
  return {
    to,
    subject: `You have been invited to ${businessName || 'Luminous StockHaven'}`,
    text:
      `You have been invited to help manage ${businessName || 'a business'} on Luminous StockHaven` +
      `${inviterName ? ` by ${inviterName}` : ''}.\n\n` +
      'Create your account with this email address, then sign in — your staff access will be ready. ' +
      'If you did not expect this invitation, you can ignore this email.',
  };
}

export function verificationEmail({ to, code }) {
  return {
    to,
    subject: 'Your Luminous StockHaven verification code',
    text:
      `Your Luminous StockHaven verification code is ${code}.\n\n` +
      'Enter it on the verification screen to finish creating your account. ' +
      'The code expires in 10 minutes and can only be used once.\n\n' +
      'If you did not create an account, you can ignore this email.',
  };
}

export function passwordResetEmail({ to, resetUrl, code }) {
  return {
    to,
    subject: 'Reset your Luminous StockHaven password',
    text:
      'We received a request to reset your Luminous StockHaven password.\n\n' +
      `Reset it here: ${resetUrl}\n\n` +
      `Your reset code is ${code} — you can also enter it on the reset page. ` +
      'The code expires in 10 minutes and can only be used once.\n\n' +
      'If you did not ask for a password reset, you can ignore this email — your password will not change.',
  };
}
