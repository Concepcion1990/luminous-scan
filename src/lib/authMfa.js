/**
 * Sign-in helpers — T2 (email + password only).
 *
 * The Base44 version of this module drove Base44's platform MFA flow
 * (`/api/apps/<id>/auth/...`, `/auth/mfa`) and Google sign-in through
 * the Base44 SDK. Neither exists on the twin:
 *
 * - Email + password login is real: `loginWithMfa` POSTs to the
 *   twin's /api/auth/login and returns the user. The name is kept so
 *   the ported Login page needs no churn; the twin has no MFA step,
 *   so the result never carries `mfa_required` and `continueMfa` is
 *   a plain redirect to the return-to page.
 * - A failed sign-in answers through the same API-error registry as
 *   every other call (src/lib/apiErrors.js), so the error speaks
 *   the language the visitor picked on the page — never the server's
 *   raw English (owner catch, Nov 18, 2026: "Invalid email or
 *   password." on an otherwise fully Spanish login page).
 * - Google sign-in is NOT built, by the owner's decision (Nov 9):
 *   email and password only — she thinks it is more secure, with
 *   fewer doors into the app and no third party in the middle of her
 *   customers' logins. `loginWithGoogle` / `loginWithSocial` reject
 *   with that message. No Google OAuth code, client id, or secret
 *   exists anywhere on the twin. If social login is ever proposed
 *   again, that decision is the record to revisit.
 */

import { apiErrorMessage } from './apiErrors.js';

const GOOGLE_UNAVAILABLE = new Error(
  'Google sign-in is not available — please log in with your email and password.',
);

async function loginRequest(email, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Same resolution as src/api/client.js request(): the server's
    // stable code + English message become the reader's language
    // whenever the words are known to the map; the English message
    // itself is the final fallback — never a raw code, never blank.
    const error = new Error(apiErrorMessage(data, response.status));
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function loginWithMfa(email, password) {
  const result = await loginRequest(email, password);
  return { ...result, mfa_required: false };
}

export async function continueMfa(_result, returnTo) {
  window.location.assign(returnTo || '/');
}

export async function loginWithSocial() {
  throw GOOGLE_UNAVAILABLE;
}

export function loginWithGoogle() {
  return Promise.reject(GOOGLE_UNAVAILABLE);
}
