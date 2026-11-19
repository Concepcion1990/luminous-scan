/**
 * "Download the app" — the permanent install door (owner's
 * ruling, Nov 19, 2026).
 *
 * The browser's own install pop-up flashes by once, right after
 * a staff member creates their account or signs in — easy to
 * miss — and owners who already subscribed never see it at all.
 * So Settings carries a permanent door instead. This module is
 * the machinery behind it:
 *
 *   - It captures the browser's `beforeinstallprompt` event the
 *     moment the app boots (imported for its side effect by
 *     main.jsx), because the event fires once and is gone.
 *   - `promptInstall()` fires that captured prompt. The event is
 *     single-use: after it is spent, the honest fallback is the
 *     manual add-to-home-screen steps for the reader's platform.
 *   - `isStandalone()` says the app is already installed and
 *     running from the home screen — the door then says so
 *     plainly instead of offering a download that cannot happen.
 */

let deferredPrompt = null;
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

/** True when a captured browser install prompt is ready to fire. */
export function canPromptInstall() {
  return deferredPrompt !== null;
}

/** Fire the captured prompt. Resolves 'accepted' | 'dismissed' | 'unavailable'. */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const event = deferredPrompt;
  deferredPrompt = null;
  notify();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'dismissed';
  }
}

/** Running installed (home-screen / standalone display mode)? */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari's own flag for home-screen apps.
  return window.navigator?.standalone === true;
}

/**
 * Which manual steps to show when no prompt can fire:
 * 'ios' (Share → Add to Home Screen), 'android' (browser menu →
 * Install app), or 'desktop' (address-bar install icon / menu).
 */
export function installPlatform() {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  const isIos =
    /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && 'ontouchend' in document);
  if (isIos) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

/** Subscribe to prompt-availability changes; returns an unsubscribe. */
export function onInstallAvailabilityChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
