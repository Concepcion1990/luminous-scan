import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Stamp the service worker with this build's version (design-polish
// pass, 2026-11-13). public/sw.js names its cache
// 'luminous-stockhaven-shell-__SW_VERSION__'; replacing the marker in
// dist/sw.js with a hash of the built index.html means every deploy
// that changes the client produces a byte-different worker, so the
// browser installs it, its activate step purges the old caches, and a
// returning phone can never be stranded on a previous build's shell.
// A server-only deploy leaves index.html (and so the stamp) unchanged
// — the shell genuinely is the same, so no reinstall is needed.
function stampServiceWorker() {
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    closeBundle() {
      const swPath = path.join(__dirname, 'dist', 'sw.js')
      const indexPath = path.join(__dirname, 'dist', 'index.html')
      if (!existsSync(swPath) || !existsSync(indexPath)) return
      const version = createHash('sha256').update(readFileSync(indexPath)).digest('hex').slice(0, 12)
      const sw = readFileSync(swPath, 'utf8')
      if (sw.includes('__SW_VERSION__')) {
        writeFileSync(swPath, sw.replaceAll('__SW_VERSION__', version))
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    stampServiceWorker(),
  ],
  resolve: {
    // The `@/` alias used across src/ was previously provided by the
    // Base44 Vite plugin; the twin defines it directly. No Base44 plugin.
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
