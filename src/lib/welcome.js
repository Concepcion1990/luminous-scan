const KEY = 'stockhaven-welcome-seen';

/** Has this device already been through the first-launch introduction? */
export function hasSeenWelcome() {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Remembered, so the introduction never interrupts normal use twice on a device. */
export function markWelcomeSeen() {
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    // A browser with storage blocked simply sees the introduction again later.
  }
}