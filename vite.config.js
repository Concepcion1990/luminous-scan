import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { generateAppIcons } from './scripts/app-icons.mjs'

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

// Emit the raster icon family into dist/ (app-icon fix,
// 2026-11-24; diagnosis ~/workspace/diagnosis-app-icon/report.md).
// The manifest offered the globe only as SVG, and Windows/Android/
// iOS install surfaces need raster icons — with none, Chrome fell
// back to a generated letter tile ("L") for the installed app.
// scripts/app-icons.mjs decodes the PNG masters inside the public
// SVG wrappers and writes real icon-192.png / icon-512.png, a
// maskable 512, an apple-touch-icon and a favicon.ico. No binary
// ever rides the text-only GitHub push: the PNGs are born here,
// from text already in the repo, and the artwork is the masters'
// own bytes/resizes — never redrawn. Like the SW stamper this
// works on dist/ directly, so it runs for the client build (the
// SSR build's dist-server output carries no icons and needs none).
function emitAppIcons() {
  return {
    name: 'emit-app-icons',
    apply: 'build',
    closeBundle() {
      const distDir = path.join(__dirname, 'dist')
      const publicDir = path.join(__dirname, 'public')
      if (!existsSync(path.join(publicDir, 'icon-192.svg'))) return
      if (!existsSync(path.join(publicDir, 'icon-512.svg'))) return
      generateAppIcons({ publicDir, outDir: distDir })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    stampServiceWorker(),
    emitAppIcons(),
  ],
  resolve: {
    // The `@/` alias used across src/ was previously provided by the
    // Base44 Vite plugin; the twin defines it directly. No Base44 plugin.
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
