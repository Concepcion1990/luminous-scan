/**
 * Sync client — T6. Talks to the server sync endpoints and drives the
 * offline queue to a confirmed state.
 *
 * (Node-testable: this module uses only relative imports and the
 * global fetch — the `@/` alias is Vite-only, so the API client is
 * NOT imported here. The default send below is the same shape as
 * apiRequest: same-origin session cookie, JSON in/out, an Error with
 * `.status` on failure.)
 *
 * The contract with the server (server/sync.js):
 *   - POST /sync/apply takes { changes: [{ idempotency_key, kind, payload }] }
 *     and answers per change: 'applied', 'duplicate' (already applied —
 *     the replay is harmless) or 'failed' with a reason.
 *   - GET /sync/state answers { version, movements, ... } — the
 *     convergence check: a different version means the server state
 *     moved and the client must re-read.
 *
 * flushQueue rules (the "no silent failure" part):
 *   - Sends pending changes in the order they were queued, oldest first.
 *   - A change leaves the queue ONLY when the server confirms it
 *     ('applied' or 'duplicate'). A network failure leaves everything
 *     queued and the flush reports it as still pending.
 *   - A server validation failure ('failed') is retried a few times
 *     (stock may arrive in the meantime), then marked 'failed' on the
 *     device and kept — never silently dropped. Staff can discard a
 *     failed change from the sync indicator once they have seen it.
 *   - A 401/403 (signed out, or the workspace went read-only) stops
 *     the flush immediately — retrying auth failures is pointless.
 */
import { csrfHeadersFor } from './csrf.js';

export const SYNC_MAX_ATTEMPTS = 5;

/**
 * Same-origin JSON fetch (same shape as apiRequest, without the alias).
 *
 * T6.1 CSRF — the flush-time token: a fresh token is fetched HERE,
 * at send time, and sent as the X-CSRF-Token header. The queued
 * changes themselves never carry a token (see applyQueuedChanges
 * below: only idempotency_key, kind and payload travel), so a change
 * queued offline still applies after reconnect, whatever token
 * rotation happened in between.
 */
export async function defaultSend(path, { method = 'GET', body } = {}) {
  const csrfHeaders = await csrfHeadersFor(path, method);
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function applyQueuedChanges(businessId, changes, send = defaultSend) {
  return send(`/api/businesses/${encodeURIComponent(businessId)}/sync/apply`, {
    method: 'POST',
    body: {
      changes: changes.map((change) => ({
        idempotency_key: change.key,
        kind: change.kind,
        payload: change.payload,
      })),
    },
  });
}

export async function fetchSyncState(businessId, send = defaultSend) {
  return send(`/api/businesses/${encodeURIComponent(businessId)}/sync/state`);
}

function isAuthFailure(error) {
  return error?.status === 401 || error?.status === 403;
}

function isValidationFailure(result) {
  return result?.status === 'failed';
}

/**
 * Flush one queue store for one business. Returns a summary:
 *   { sent, confirmed, duplicates, stillPending, failed, stopped }
 * `queue` is any store with the offlineQueue interface (IndexedDB in
 * the app, memory in tests). `send` defaults to the real API and is
 * injected in tests.
 */
export async function flushQueue(queue, businessId, { send = defaultSend } = {}) {
  const all = await queue.all();
  const pending = all.filter((c) => c.businessId === businessId && c.status !== 'failed');
  const summary = { sent: 0, confirmed: 0, duplicates: 0, stillPending: 0, failed: 0, stopped: false };
  if (!pending.length) return summary;

  // Mark the batch in flight so the indicator shows "still sending".
  for (const change of pending) {
    await queue.update({ ...change, status: 'sending', attempts: (change.attempts || 0) + 1 });
  }

  let response;
  try {
    response = await applyQueuedChanges(businessId, pending, send);
  } catch (error) {
    // The network (or the server) failed: everything stays queued.
    // An auth failure stops the flush — there is nothing to retry.
    for (const change of pending) {
      await queue.update({ ...change, status: 'pending', lastError: error?.message || 'Could not reach the server.' });
    }
    summary.stillPending = pending.length;
    summary.stopped = isAuthFailure(error);
    return summary;
  }

  const results = Array.isArray(response?.results) ? response.results : [];
  for (let i = 0; i < pending.length; i += 1) {
    const change = pending[i];
    const result = results[i];
    summary.sent += 1;
    if (!result || result.status === 'applied') {
      await queue.remove(change.key);
      summary.confirmed += 1;
    } else if (result.status === 'duplicate') {
      // Already applied on an earlier attempt — confirmed, not double-counted.
      await queue.remove(change.key);
      summary.duplicates += 1;
      summary.confirmed += 1;
    } else if (isValidationFailure(result)) {
      const attempts = (change.attempts || 0) + 1;
      if (attempts >= SYNC_MAX_ATTEMPTS) {
        await queue.update({ ...change, status: 'failed', attempts, lastError: result.message || 'The server refused this change.' });
        summary.failed += 1;
      } else {
        await queue.update({ ...change, status: 'pending', attempts, lastError: result.message || 'The server refused this change.' });
        summary.stillPending += 1;
      }
    } else {
      await queue.update({ ...change, status: 'pending', lastError: 'No confirmation from the server.' });
      summary.stillPending += 1;
    }
  }
  return summary;
}

/** Drop one failed change from the queue (staff choice, after seeing it). */
export async function discardQueuedChange(queue, key) {
  await queue.remove(key);
}
