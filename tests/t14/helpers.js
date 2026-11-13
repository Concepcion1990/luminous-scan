/**
 * T14 test helpers — send purchase orders from inside the app.
 * Builds on the T5 helpers (suppliers, purchase orders, plan
 * fixtures) over the T2 harness: real Express app over HTTP against
 * pg-mem, in-memory mail sink.
 */
export * from '../t5/helpers.js';
import { mailbox } from '../t2/helpers.js';

export { mailbox };

/** All mail currently in the sink addressed to one recipient. */
export function mailToAddress(email) {
  return mailbox.filter((m) => m.to === email);
}
