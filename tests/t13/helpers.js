/**
 * T13 test helpers — account recovery kit. Builds on t3 helpers
 * (real Express app over HTTP against pg-mem, in-memory mail sink,
 * shop conveniences).
 */
export * from '../t3/helpers.js';
import { mailbox } from '../t2/helpers.js';

export { mailbox };

/** Latest mail to an address whose subject contains the fragment. */
export function latestMailTo(email, subjectPart) {
  const matches = mailbox.filter(
    (m) => m.to === email && (!subjectPart || m.subject.includes(subjectPart)),
  );
  return matches[matches.length - 1] || null;
}
