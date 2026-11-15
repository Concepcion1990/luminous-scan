// Embed mode (lesson visuals, Nov 15, 2026): training steps show
// the app's OWN pages, live, inside a framed picture. A page
// opened with ?embed=visual renders without the bottom tab bar
// or pull-to-refresh — it is a picture of the real page, in the
// reader's own language and session, never a drawing. The flag
// sticks in sessionStorage so client-side navigation inside the
// frame keeps the trim.
const KEY = 'sh.embedVisual';

export function isEmbedVisual() {
  if (typeof window === 'undefined') return false;
  try {
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
