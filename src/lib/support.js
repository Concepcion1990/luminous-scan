/**
 * In-app issue reporting — client API wrapper (Support phase).
 *
 * One thin call over apiRequest for the account-level endpoint in
 * server/supportRoutes.js. The server attaches the fixing context
 * itself (business, role, plan — from its own records, only when
 * the caller truly belongs to the selected business); the client
 * contributes only what it alone knows: the page it is on and the
 * app language currently in use. Errors carry the server's error
 * code on `error.data.error`, which the card maps to its own
 * localized lines.
 */
import { apiRequest } from '@/api/client';

export function submitProblemReport({ category, message, page, locale }) {
  return apiRequest('/api/support/report', {
    method: 'POST',
    body: { category, message, page, locale },
  });
}
