/**
 * Account recovery kit — client API wrappers (T7).
 *
 * Thin calls over apiRequest for the spare-key endpoints in
 * server/recoveryRoutes.js: security status, backup codes, backup
 * email, change-email (the same flow serves Settings and the
 * recovery page), the pre-auth recovery entry, and the owner's
 * staff-email fix. Errors carry the server's message (apiRequest
 * surfaces it), which the surfaces show verbatim.
 */
import { apiRequest } from '@/api/client';

export function getSecurityStatus() {
  return apiRequest('/api/account/security');
}

/** (Re)generate the spare-key set. The codes come back exactly once. */
export function generateBackupCodes() {
  return apiRequest('/api/account/backup-codes', { method: 'POST', body: {} });
}

export function startBackupEmail(email) {
  return apiRequest('/api/account/backup-email', { method: 'POST', body: { email } });
}

export function verifyBackupEmail(code) {
  return apiRequest('/api/account/backup-email/verify', { method: 'POST', body: { code } });
}

/**
 * Start a change of the account email. A signed-in (full) session
 * must pass its current password; a recovery session passes none —
 * the spare key was its proof.
 */
export function requestEmailChange(newEmail, password) {
  const body = { new_email: newEmail };
  if (password) body.password = password;
  return apiRequest('/api/account/change-email/request', { method: 'POST', body });
}

export function confirmEmailChange(code) {
  return apiRequest('/api/account/change-email/confirm', { method: 'POST', body: { code } });
}

/** Spare-key entry: present one backup code for the account email. */
export function recoverWithBackupCode(email, backupCode) {
  return apiRequest('/api/auth/recover', { method: 'POST', body: { email, backup_code: backupCode } });
}

/** Ask for a 6-digit code at the account's verified backup email. */
export function requestRecoveryCode(email) {
  return apiRequest('/api/auth/recover', { method: 'POST', body: { email } });
}

export function verifyRecoveryCode(email, code) {
  return apiRequest('/api/auth/recover/verify', { method: 'POST', body: { email, code } });
}

/** Owner-only: move a staff member (and their account, if any) to a new email. */
export function fixStaffEmail(businessId, memberId, email) {
  return apiRequest(`/api/businesses/${businessId}/staff/${memberId}/email`, {
    method: 'POST',
    body: { email },
  });
}
