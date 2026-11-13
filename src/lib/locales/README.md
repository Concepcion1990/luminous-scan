# Adding a language

Languages are added **one at a time, in ABC order** of the list the owner approves. The first language is **Arabic (ar)** — landed in T6.3, the full app flows in it (RTL included). The T6.3 continuation batch added seven more, same pipeline: **Amharic (am), Bengali (bn), Bhojpuri (bho), Mandarin Simplified (zh-Hans), Mandarin Traditional (zh-Hant), Cantonese (yue), Shanghainese / Wu (wuu)** — 2,917 keys each, every one wired into the registry, the server allowlist and the Settings select, with per-locale coverage + switch tests. The third batch added nine more, same pipeline: **French — France (fr-FR), Canadian French (fr-CA), German (de), Gujarati (gu), Hausa (ha), Hindi (hi), Indonesian (id), Malay (ms), Italian (it)** — 2,926 keys each (the nine new Settings label keys grew the key count from 2,917), every one wired into the registry, the server allowlist and the Settings select, with per-locale coverage + switch tests. The fourth batch added nine more, same pipeline: **Japanese (ja), Javanese (jv), Kannada (kn), Korean (ko), Marathi (mr), Nigerian Pidgin (pcm), Persian (fa), Dari (prs), Tajik (tg)** — 2,935 keys each (the nine batch-4 Settings label keys grew the key count from 2,926), every one wired into the registry, the server allowlist and the Settings select, with per-locale coverage + switch tests. Persian, Dari and Tajik are RTL locales (already listed in `RTL_LOCALES`); their switch tests assert `isRTL()` engages while they are active. Supported locales now: `en, ar, am, bn, bho, zh-Hans, zh-Hant, yue, wuu, fr-CA, ms, gu, de, fr-FR, ha, it, hi, id, ja, jv, kn, ko, mr, pcm, fa, prs, tg` — 27 locales (registry order in `src/lib/i18n.js`; server allowlist in `server/authRoutes.js` is ABC). English variants (en-GB, en-AU, en-CA, en-IN) are NOT built — the owner has not confirmed that set.

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
- Every other page, component, and shared lib file — dashboard, sales, inventory, settings, auth, ops, and the `*Lib.*` label tables. `src/lib/locales/en.js` holds all 2,935 keys; the `fragments/` folder holds the per-surface English sources the locales were translated from.

## Standing rules (learned in batch 3)

- **The Delete Account confirmation word stays `DELETE` in every language.** `src/pages/Settings.jsx` compares the typed text against the literal `'DELETE'` — if a translation renders the prompt as "type SUPPRIMER" (or any other word), the button stays disabled and the flow breaks. Keep `DELETE` literal in `settings.delete.enterDelete` and `settings.delete.dialogDescription`.
- **Language label values are identical in every locale file.** `settings.details.<language>` is the language's own name plus its English name in parentheses (e.g. `Français (French)`); never translate the English gloss, and keep `settings.details.english` as `English` in every locale. The merge script inserts these from `labels.json`, and the per-language slice check catches a translated gloss only if you look — check them by hand before merging.

## Translations are Muse-generated, not professionally translated

A native speaker spotting something off later gets it fixed — say so honestly when reporting a new language, and record any judgment calls in the phase report.
