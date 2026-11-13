/**
 * T23 test helpers — builds on tests/t3/helpers.js (real Express app
 * over HTTP against pg-mem, in-memory mail sink, business/plan
 * fixtures). Adds a latest-mail lookup for notification assertions.
 */
export * from '../t3/helpers.js';
import { mailbox } from '../t3/helpers.js';

export { mailbox };

/** Most recent captured mail to an address (throws when none). */
export function latestMailTo(email) {
  const found = [...mailbox].reverse().find((m) => m.to === email);
  if (!found) throw new Error(`no mail captured for ${email}`);
  return found;
}
