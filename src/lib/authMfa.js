/**
 * Sign-in helpers — FAIL-CLOSED STUB (T1).
 *
 * The Base44 version of this module drove Base44's platform MFA flow
 * (`/api/apps/<id>/auth/...`, `/auth/mfa`) and Google sign-in through
 * the Base44 SDK. None of that exists on the twin: auth (email +
 * password, OTP, password reset, and the Google sign-in decision) is
 * built in T2. Until then every sign-in attempt fails closed with a
 * clear message — never a fake login, never a redirect to a Base44
 * endpoint. The original Base44 implementation stays in the Stockhaven
 * repo's history and in this repo's first T1 commit.
 *
 * Same exports as before, so Login/Register keep building unchanged.
 */

const NOT_READY = new Error('Sign-in is not available yet — auth is built in T2.');

export async function loginWithMfa() {
  throw NOT_READY;
}

export async function continueMfa() {
  throw NOT_READY;
}

export async function loginWithSocial() {
  throw NOT_READY;
}

export function loginWithGoogle() {
  return Promise.reject(NOT_READY);
}
