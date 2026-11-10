/**
 * T2 fail-closed tests — no database, no email provider: the server
 * refuses plainly instead of faking success. Runs in its own process
 * (no pool override, no mail sink, no RESEND_API_KEY).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_API_KEY;

const { createApp } = await import('../../server/app.js');
const { sendMail, EmailNotConfigured } = await import('../../server/email.js');

const app = createApp();
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

after(() => new Promise((resolve) => server.close(resolve)));

async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

test('health honestly reports the database as not_configured', async () => {
  const res = await req('/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.database.status, 'not_configured');
});

test('register without a database is 503 database_not_configured, never a fake user', async () => {
  const res = await req('/api/auth/register', {
    method: 'POST',
    body: { email: 'nodb@example.com', password: 'CorrectHorse123' },
  });
  assert.equal(res.status, 503);
  assert.equal(res.json.error, 'database_not_configured');
});

test('me without a session is 401 even with no database', async () => {
  const res = await req('/api/auth/me');
  assert.equal(res.status, 401);
  assert.equal(res.json.error, 'not_signed_in');
});

test('sendMail without a key throws EmailNotConfigured (no fake success)', async () => {
  await assert.rejects(
    sendMail({ to: 'x@example.com', subject: 'Hi', text: 'Hello' }),
    (error) => error instanceof EmailNotConfigured && /RESEND_API_KEY/.test(error.message),
  );
});
