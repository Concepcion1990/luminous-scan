/**
 * Data freshness bus (Nov 14, 2026) — the fix for stale pages.
 *
 * The five mobile tab screens live in stable hidden layers
 * (src/components/Layout.jsx): they never unmount, so their load
 * effects never re-run when ANOTHER screen changes the data. The
 * owner created a product from the Scan screen's dialog and the
 * Products page still read "PRODUCTS 0 of 50" while My inventory
 * (a remounting route) told the truth. The data was always right;
 * the kept-alive pages held a stale snapshot, and only
 * pull-to-refresh (which remounts) masked it. A customer must
 * never have to refresh to see their own change.
 *
 * The pattern: mutation points bump a scope's version (the entity
 * client does this centrally for inventory writes — see
 * src/api/client.js), and screens subscribe through useDataFresh:
 * a screen that becomes visible with a newer version behind it
 * refetches through its own existing reload knob, and a bump
 * while the screen is visible refetches right away.
 */

const versions = new Map();
const listeners = new Map();

export function dataVersion(scope) {
  return versions.get(scope) || 0;
}

export function bumpData(scope) {
  versions.set(scope, dataVersion(scope) + 1);
  const fns = listeners.get(scope);
  if (fns) for (const fn of [...fns]) fn();
}

export function subscribeData(scope, fn) {
  if (!listeners.has(scope)) listeners.set(scope, new Set());
  listeners.get(scope).add(fn);
  return () => {
    listeners.get(scope)?.delete(fn);
  };
}
