# Adding a language

Languages are added **one at a time, in ABC order** of the list the owner approves. The first language has **not** been picked yet — do not add one on a guess.

## Steps

1. Copy `en.js` to `<code>.js` (BCP 47 code, e.g. `es.js`, `fr.js`) and translate every value. Keep the keys exactly as they are — a key is never renamed in a translation file.
2. Keep `{name}` placeholders intact (`scan.onlyOnHand` uses `{count}` and `{location}`) — they are filled in by `t()`.
3. Import it in `src/lib/i18n.js` and add it to `LOCALES`:
   ```js
   import { es } from './locales/es.js';
   export const LOCALES = { en, es };
   ```
4. Add the code to the server allowlist in `server/authRoutes.js` (`SUPPORTED_LANGUAGES`) so Settings can save it.
5. Add the option to the Language select in `src/components/business/DetailsCard.jsx`.
6. Add a test in `src/lib/i18n.test.js`: every `en` key exists in the new locale, and `t()` with that locale returns the translated string for at least the nav + scan surfaces.
7. Convert the next surface (one page at a time) to `t()` keys, the same way nav + Scan were converted in T6.

## What `t()` does when something is missing

- Unknown locale code → English (never a blank screen).
- Missing key in the active locale → the English string.
- Missing key in English too → the key itself, so the gap is visible.

## Surfaces converted so far (T6)

- Main navigation (`src/components/layout/navGroups.js` + `Layout.jsx`)
- Scan station (`src/pages/Scan.jsx`) + sync indicator (`src/components/sync/SyncIndicator.jsx`)

Everything else still writes English inline — convert one surface at a time as languages land.
