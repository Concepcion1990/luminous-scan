// Shared by the auth pages (Login, Register, and any page that resumes a flow
// after sign-in, e.g. the MCP OAuth consent page). Keep the redirect
// validation in one place — it is security-sensitive and easy to drift.

// Resolve ?returnTo= to a safe same-origin path, else "/".
//
// The same-origin check alone is not enough: a value like /.//evil.com or
// /\evil.com parses same-origin but normalizes to a protocol-relative
// //evil.com when assigned to location.href — an open redirect. So require the
// resolved path to be exactly one leading slash (no "//" prefix, no backslash).
export function safeReturnTo() {
  const raw = new URLSearchParams(window.location.search).get("returnTo");
  if (!raw) return "/";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return "/";
    // Only access_token/clear_access_token are still URL-read by app-params.js, but the
    // whole bootstrap set stays stripped: one going back to a URL read must not silently
    // become injectable again. Normal app-flow params (e.g. the OAuth consent ctx) are kept.
    for (const p of ["access_token", "clear_access_token", "app_id", "app_base_url", "functions_version", "from_url"]) {
      url.searchParams.delete(p);
    }
    const path = url.pathname + url.search;
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
    return path;
  } catch {
    return "/";
  }
}

// The auth pages themselves. A login bounce must never target one of
// these: they have to render for signed-out visitors exactly as they
// are, returnTo and all. Bouncing /login back to /login was the loop.
export const AUTH_PAGE_PATHS = [
  "/login",
  "/register",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/account-recovery",
];

export function isAuthPagePath(pathname) {
  return AUTH_PAGE_PATHS.includes(pathname);
}

// The app shell's render gate, as a pure decision so the regression
// tests can drive it. Public pages and the auth pages render
// immediately — nothing on them depends on the session — so a cold or
// slow session check can neither stall them behind the loading
// spinner nor sway where they land. "/" and the protected pages DO
// depend on the session (a signed-in visitor at "/" gets the
// Dashboard; a signed-out one is landed on /welcome exactly once), so
// they keep waiting for the check, exactly as before.
//
// (Design-polish pass, 2026-11-13: the spinner previously gated EVERY
// route on the session check — and on the public-settings flag chained
// behind it — so on a cold start even the Welcome page sat behind a
// spinner for seconds, and the signed-out landing waited on the whole
// chain. The gate is now per-route-class, and the public-settings
// loading state plays no part in it: nothing renders from those
// settings, so their loading must never hold the shell hostage.)
export function shellShouldWait({ openToEveryone, authPage, isLoadingAuth }) {
  if (openToEveryone || authPage) return false;
  return Boolean(isLoadingAuth);
}

// The value a login bounce may carry as its ?returnTo=. Pure in
// (value, origin) so the regression tests can drive it directly.
//
// Rules (the 2026-11-12 redirect-loop fix):
// - Always a clean RELATIVE path — never an absolute href. The old
//   bounce carried window.location.href, query string and all, so the
//   URL it produced contained the whole previous URL.
// - Auth pages fall back to "/": a bounce that lands on /login fires
//   the gate again and wraps itself one layer deeper.
// - A value that already contains a returnTo parameter falls back to
//   "/": a bounce never carries another bounce inside it.
// - Cross-origin or unparseable values fall back to "/".
// - The bootstrap parameters safeReturnTo strips on the way back in
//   are stripped here too, so the carried path is the one that will
//   actually be resumed after sign-in.
export function loginBounceTarget(value, origin) {
  if (!value) return "/";
  let url;
  try {
    url = new URL(value, origin);
  } catch {
    return "/";
  }
  if (url.origin !== origin) return "/";
  if (isAuthPagePath(url.pathname)) return "/";
  if (url.searchParams.has("returnTo")) return "/";
  for (const p of ["access_token", "clear_access_token", "app_id", "app_base_url", "functions_version", "from_url"]) {
    url.searchParams.delete(p);
  }
  const path = url.pathname + url.search;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  return path;
}
