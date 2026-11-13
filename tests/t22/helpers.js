/**
 * T22 test helpers — the SEO serving checks need the real Express app
 * over HTTP, so this builds on tests/t2/helpers.js (real app against
 * pg-mem) exactly as the later segments do.
 */
export * from '../t2/helpers.js';
import { base, close } from '../t2/helpers.js';

export { base, close };
