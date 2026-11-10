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
 * (captures { to, subject, text, html }); no real email is ever sent
 * from a test. Local development may set EMAIL_LOG_SINK=1 (and only
 * with NODE_ENV != 'production') to log mail to the console instead
 * of sending — DEV ONLY, never on Fly, never in production.
 *
 * Trial reminders are NOT wired here — they stay OFF (plan §2.8).
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
 * Send one email. Throws EmailNotConfigured when sending is impossible.
 * Returns { id } on success (Resend's message id, or 'sink' / 'log' for
 * the test/dev paths). `to`, `subject`, `text` are required; `html` is
 * optional (plain-text fallback is used when omitted).
 */
export async function sendMail({ to, subject, text, html }) {
  if (!to || !subject || !text) {
    throw new Error('sendMail requires to, subject and text');
  }
  if (mailSink) {
    const message = { to, subject, text, html: html || text };
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
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, text, html: html || text }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend rejected the email (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data = await response.json().catch(() => ({}));
  return { id: data.id || 'unknown' };
}

export function verificationEmail({ to, code }) {
  return {
    to,
    subject: 'Your Luminous Stockhaven verification code',
    text:
      `Your Luminous Stockhaven verification code is ${code}.\n\n` +
      'Enter it on the verification screen to finish creating your account. ' +
      'The code expires in 10 minutes and can only be used once.\n\n' +
      'If you did not create an account, you can ignore this email.',
  };
}

export function passwordResetEmail({ to, resetUrl, code }) {
  return {
    to,
    subject: 'Reset your Luminous Stockhaven password',
    text:
      'We received a request to reset your Luminous Stockhaven password.\n\n' +
      `Reset it here: ${resetUrl}\n\n` +
      `Your reset code is ${code} — you can also enter it on the reset page. ` +
      'The code expires in 10 minutes and can only be used once.\n\n' +
      'If you did not ask for a password reset, you can ignore this email — your password will not change.',
  };
}
