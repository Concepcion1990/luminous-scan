import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import App from '@/App.jsx'
import { initLocale } from '@/lib/i18n'
import '@/index.css'

// The visitor's language choice (public LanguagePicker) is restored
// before the first render, so a returning visitor never sees an
// English flash before their language applies.
initLocale()

// T6: the app shell is installable and opens with no connection (the
// offline queue holds the work; the service worker never answers API
// traffic from a cache — a queued change is only confirmed by the
// server). Registration is best-effort: a browser without service
// workers still runs the app, just without the cached shell.
if (
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  !new URLSearchParams(window.location.search).has('embed')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Prompt discovery (lap-3, Nov 15, 2026): browsers check for
        // a new worker on document navigations, but an installed
        // app session can live for hours on SPA route changes alone
        // — a phone kept serving the previous build for ~an hour
        // after a deploy, until a logout forced a full navigation.
        // Ask for an update check whenever the app becomes visible
        // again, and hourly while it stays open. The worker itself
        // does the rest (skipWaiting + clients.claim + the versioned
        // cache purge in public/sw.js); nothing here force-reloads
        // an open tab — the next navigation serves the new build.
        const checkForUpdate = () => {
          registration.update().catch(() => {});
        };
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });
        window.setInterval(checkForUpdate, 60 * 60 * 1000);
      })
      .catch(() => {
        // No service worker, no problem: the app still works online,
        // and the queue still holds offline work for the session.
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider
    attribute="class"
    defaultTheme="system"
    enableSystem
    enableColorScheme
    disableTransitionOnChange
  >
    <App />
  </ThemeProvider>
)