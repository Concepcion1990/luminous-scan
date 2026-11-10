/**
 * Password hashing — T2 decision (recorded in twin-t2-report.md):
 * bcrypt via the pure-JavaScript `bcryptjs` package, cost factor 12.
 *
 * Why bcrypt, not argon2id: the plan allows either. argon2id's npm
 * package needs a native build (no prebuilt binary is guaranteed in
 * this environment or in the Fly `node:20-slim` build stage), while
 * bcryptjs is pure JS — it installs and runs identically everywhere
 * the twin runs, with no toolchain. bcrypt remains an OWASP-accepted
 * password hash. Cost 12 is the usual server-side default (~250 ms
 * per hash on this hardware class).
 *
 * NEVER store or log a plaintext password. Only hashes leave this
 * module, and only `verifyPassword` ever sees a candidate password.
 */
import bcrypt from 'bcryptjs';

const COST = 12;

/** bcrypt hash of a password (72-byte bcrypt input limit is enforced by callers). */
export async function hashPassword(password) {
  return bcrypt.hash(password, COST);
}

/** Constant-shape comparison: returns false for a bad hash instead of throwing. */
export async function verifyPassword(password, hash) {
  if (!password || !hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

/**
 * A real bcrypt hash (of a fixed dummy password, generated once at
 * module load) used to compare against when the email does not exist,
 * so a login for an unknown email costs the same bcrypt work as a
 * real one (no timing signal for user enumeration). A hand-written
 * fake hash string would NOT do: bcrypt rejects it instantly.
 */
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-equalisation', COST);

export async function dummyPasswordCheck(password) {
  return verifyPassword(password, DUMMY_HASH);
}
