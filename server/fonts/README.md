Print fonts for the server PDF pipeline (server/printFonts.js).

All fonts are open-licensed and embedded only into PDFs the app
generates for its own users:

- NotoSans-*.ttf and NotoSansArabic-Regular.ttf — Noto Sans family,
  © Google LLC, SIL Open Font License 1.1 / Apache License 2.0
  (https://github.com/notofonts).
- DroidSansFallbackFull.ttf — Droid Sans Fallback (CJK), © The
  Android Open Source Project, Apache License 2.0.
- NanumGothic-Regular.ttf — Nanum Gothic (Hangul), © NAVER
  Corporation, SIL Open Font License 1.1.

Delivery form: the fonts ship as base64 TEXT, not binary TTF
files, because the app's publish route carries UTF-8 text only.
Each font is split into chunk files (<Base>.b64.000, .001, ...),
and manifest.json records every font's original file name, byte
length, sha256 and chunk list. Joining a font's chunks, stripping
whitespace and base64-decoding reproduces the original TTF
byte-for-byte; server/printFonts.js verifies length + sha256 at
load time. A font that is missing or fails verification is
treated as unavailable and printing degrades to the per-string
English fallback — font loading never fails a print request.

Fonts are loaded from disk on first use and cached; they are never
inlined into the JavaScript bundle.
