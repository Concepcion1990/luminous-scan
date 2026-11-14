/**
 * Retired Nov 14, 2026 — pull-to-refresh now lives in ONE app-wide
 * shell implementation (src/components/PullToRefreshShell.jsx), so
 * every page has the gesture, not just the four pages that used to
 * wrap this per-page component (Dashboard, Inventory, Movements,
 * Scan). Nothing imports this file.
 *
 * It remains as a tombstone because the snapshot publish route
 * creates and updates files but cannot delete them; the remote copy
 * is retired the same way, in the same publish.
 */
export default function PullToRefresh() {
  return null;
}
