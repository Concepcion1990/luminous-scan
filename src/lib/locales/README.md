# Adding a language

Languages are added **one at a time, in ABC order** of the list the owner approves. The first language is **Arabic (ar)** — landed in T6.3, the full app flows in it (RTL included).

## Steps

1. Copy `en.js` to `<code>.js` (BCP 47 code, e.g. `es.js`, `fr.js`) and translate every value. Keep the keys exactly as they are — a key is never renamed in a translation file.
2. Keep `{name}` placeholders intact (`scan.onlyOnHand` uses `{count}` and `{location}`) — they are filled in by `t()`. **Exception:** the English plural-agreement markers (`{s}`, `{plural}`, `{suffix}`, `{us}`, `{cs}`, `{ps}`, `{fs}`, `{rs}`) are OMITTED in languages whose plural does not work that way (Arabic omits them — the plural lives in the word form, and keeping one renders a stray Latin letter).
3. Import it in `src/lib/i18n.js` and add it to `LOCALES`:
   ```js
   import { es } from './locales/es.js';
   export const LOCALES = { en, es };
   ```
4. Add the code to the server allowlist in `server/authRoutes.js` (`SUPPORTED_LANGUAGES`) so Settings can save it.
5. Add the option to the Language select in `src/components/business/DetailsCard.jsx` (with a `settings.details.<language>` label key in `en.js` — the language's own name, e.g. `العربية (Arabic)`).
6. Add a test in `src/lib/i18n.test.js`: every `en` key exists in the new locale, every value is a non-empty string, value placeholders match (minus agreement markers), and `t()` with that locale returns the translated string for at least the nav + scan surfaces. See the Arabic test for the pattern.
7. **No surface conversion is needed anymore** — every page, component, and shared lib file already goes through `t()` (T6.3). A new language is a new file in this folder, not a hunt through the pages.

## What `t()` does when something is missing

- Unknown locale code → English (never a blank screen).
- Missing key in the active locale → the English string.
- Missing key in English too → the key itself, so the gap is visible.

## Surfaces converted (T6.3 — everything)

- Main navigation (`src/components/layout/navGroups.js` + `Layout.jsx`)
- Scan station (`src/pages/Scan.jsx`) + sync indicator (`src/components/sync/SyncIndicator.jsx`)
- Every other page, component, and shared lib file — dashboard, sales, inventory, settings, auth, ops, and the `*Lib.*` label tables. `src/lib/locales/en.js` holds all 2,910 keys; the `fragments/` folder holds the per-surface English sources the locales were translated from.

## Translations are Muse-generated, not professionally translated

A native speaker spotting something off later gets it fixed — say so honestly when reporting a new language, and record any judgment calls in the phase report.
