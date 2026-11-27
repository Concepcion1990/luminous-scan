/**
 * Texting (SMS) — the rented service behind the curtain
 * (Nov 26, 2026; plan release 376, the owner's Q6 ruling).
 *
 * The eBay-keyset pattern, exactly: guest texting needs a
 * rented SMS service the app does not carry in its own
 * code. NO PROVIDER IS CHOSEN HERE and no provider's API
 * is hard-coded — the seam speaks plain JSON over HTTPS to
 * whatever send endpoint the owner's keyset names:
 *
 *   SMS_SERVICE_URL   the rented service's send endpoint
 *   SMS_API_KEY       its key (sent as a Bearer header)
 *   SMS_FROM_NUMBER   the number texts come from
 *
 * Until all three exist as server secrets, the text road
 * is NOT AVAILABLE BY DESIGN: `smsConfigured()` is false,
 * the pages say so in plain words, and `sendSms` refuses
 * with a 503 — no fake sent state, no crash, and nothing
 * is ever marked sent that did not go out. The moment the
 * keyset lands, the same code sends for real with no
 * rebuild — the keyset is the publish gate for the text
 * channel, not a build blocker (the eBay door's shape).
 *
 * The payload is the generic shape every SMS gateway
 * accepts or adapts at its own edge: { from, to, body }.
 * A provider-specific adapter, if one is ever wanted,
 * belongs behind this seam and nowhere else.
 */

function err(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

export const SMS_NOT_CONFIGURED_MESSAGE =
  'Text messages are not available yet — the texting service has not been set up.';

export function smsConfig(env = process.env) {
  const serviceUrl = env.SMS_SERVICE_URL || '';
  const apiKey = env.SMS_API_KEY || '';
  const fromNumber = env.SMS_FROM_NUMBER || '';
  return {
    serviceUrl,
    apiKey,
    fromNumber,
    configured: Boolean(serviceUrl && apiKey && fromNumber),
  };
}

export function smsConfigured(env = process.env) {
  return smsConfig(env).configured;
}

/**
 * Send one text. Throws sms_not_configured (503) when the
 * keyset is absent — callers surface that as "not available
 * yet", never as a send. `fetchImpl` is the test seam.
 */
export async function sendSms({ to, body }, { env = process.env, fetchImpl = fetch } = {}) {
  const cfg = smsConfig(env);
  if (!cfg.configured) {
    throw err(503, 'sms_not_configured', SMS_NOT_CONFIGURED_MESSAGE);
  }
  const target = String(to || '').trim();
  const text = String(body || '').trim();
  if (!target || !text) {
    throw err(400, 'sms_invalid', 'A text needs a number and a message.');
  }
  const response = await fetchImpl(cfg.serviceUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: cfg.fromNumber, to: target, body: text }),
  });
  if (!response || !response.ok) {
    throw err(502, 'sms_send_failed', 'The texting service did not accept the message.');
  }
  const data = typeof response.json === 'function' ? await response.json().catch(() => ({})) : {};
  return { id: data?.id || 'sent' };
}
