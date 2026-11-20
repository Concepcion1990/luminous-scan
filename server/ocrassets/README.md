# OCR assets for the ISBN digits reader (server/ocrAssets.js)

The product form's ISBN button reads the *printed digits* of an
ISBN with tesseract.js (client-side OCR, owner ruling Nov 19,
2026). The engine's three binary payloads live here so the app
serves them from its own origin — no CDN, nothing loads until a
person actually taps the ISBN button.

All three payloads are open-licensed (Apache License 2.0):

- `tesseract-core-simd-lstm.wasm.js` and
  `tesseract-core-lstm.wasm.js` — the LSTM OCR core (WebAssembly
  embedded in JS) from the `tesseract.js-core` npm package,
  version 5.x, part of tesseract.js (Apache License 2.0,
  https://github.com/naptha/tesseract.js). The worker picks the
  SIMD build when the browser supports it, the plain LSTM build
  otherwise; the app always runs the LSTM-only engine, so the
  two legacy+LSTM core builds are not shipped.
- `eng.traineddata.gz` — the English language data from
  tesseract-ocr/tessdata_fast (Apache License 2.0), recompressed
  locally with `gzip -9`. The uncompressed traineddata is
  4,113,088 bytes, sha256
  7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2.
  Digits recognition uses a character whitelist
  (`0123456789X`), so the language data only has to know digit
  shapes.
- `tesseract.min.js` and `worker.min.js` — the tesseract.js
  5.1.1 API script and worker script, plain JavaScript text;
  they ship as themselves (see manifest.json for their byte
  lengths and sha256). The API script is loaded by the page on
  demand (src/lib/isbnOcr.js injects it), so the OCR engine is
  never part of the app bundle and costs nothing until used.
  The `tesseract.js` npm package is a devDependency kept as the
  provenance source for these vendored files; nothing in the
  app imports it.

Delivery form: like the print fonts (server/fonts/), the binary
payloads ship as base64 TEXT chunks (`<Base>.b64.000`, `.001`,
...) because the app's publish route carries UTF-8 text only.
manifest.json records every payload's original file name, byte
length, sha256 and chunk list. Joining a payload's chunks,
stripping whitespace and base64-decoding reproduces the original
file byte-for-byte; server/ocrAssets.js verifies length + sha256
at load time. A payload that is missing or fails verification is
simply unavailable — the ISBN reader then answers with its plain
"didn't read clearly — try again or type it" message, and the
rest of the app is untouched.
