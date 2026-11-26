/**
 * Test-only module hook: resolve the app's `@/` import alias
 * to src/ so plain `node --test` can execute lib modules that
 * import the API client (the Vite alias does not exist here).
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const rel = specifier.slice(2);
    for (const candidate of [rel, `${rel}.js`, `${rel}.jsx`, `${rel}/index.js`]) {
      try {
        return await nextResolve(pathToFileURL(path.join(SRC, candidate)).href, context);
      } catch {
        // try the next shape
      }
    }
  }
  return nextResolve(specifier, context);
}
