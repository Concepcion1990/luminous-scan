// Embed mode (lesson visuals, Nov 15, 2026): training steps show
// the app's OWN pages, live, inside a framed picture. A page
// opened with ?embed=visual renders without the bottom tab bar
// or pull-to-refresh — it is a picture of the real page, in the
// reader's own language and session, never a drawing. The flag
// sticks in sessionStorage so client-side navigation inside the
// frame keeps the trim.
//
// NAV FIX (Nov 18, 2026): sessionStorage belongs to the TAB, not
// the frame — the top page and its same-origin frames share one
// store. The framed picture wrote its flag into the owner's own
// tab store, and from the next full load on, her real app read
// ITSELF as a picture and hid the bottom tab bar on every main
// page for the life of the tab (her phone, Nov 18, 2026: the bar
// vanished after she opened the lessons that carry visuals; only
// closing the tab brought it back). Embed is a property of the
// FRAME, never of the tab: a top-level document is the real app
// and is never trimmed, whatever the shared store says; only a
// framed document may be a picture, and only it reads the flag.
const KEY = 'sh.embedVisual';

export function isEmbedVisual() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.self === window.top) return false;
    if (new URLSearchParams(window.location.search).get('embed') === 'visual') {
      window.sessionStorage.setItem(KEY, '1');
      return true;
    }
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function visualUrl(route) {
  const join = route.includes('?') ? '&' : '?';
  return `${route}${join}embed=visual`;
}
