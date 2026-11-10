import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import App from '@/App.jsx'
import '@/index.css'

// T6: the app shell is installable and opens with no connection (the
// offline queue holds the work; the service worker never answers API
// traffic from a cache — a queued change is only confirmed by the
// server). Registration is best-effort: a browser without service
// workers still runs the app, just without the cached shell.
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
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