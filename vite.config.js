import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    // The `@/` alias used across src/ was previously provided by the
    // Base44 Vite plugin; the twin defines it directly. No Base44 plugin.
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
