/**
 * Embedded print fonts for the server PDF pipeline — the leftovers
 * sweep (Nov 15, 2026), item 4.
 *
 * jsPDF's standard fonts encode WinAnsi only, so any label in a
 * non-Latin script used to fall back to English per string. This
 * module embeds open-licensed TrueType fonts (server/fonts/) that
 * cover the scripts of the app's 52 locales, so a document prints
 * in the business's actual language:
 *
 *   base        Noto Sans — Latin Extended, Greek, Cyrillic, Hebrew
 *   arabic      Noto Sans Arabic — Arabic, Persian, Dari, Urdu,
 *               Pashto, Shahmukhi (with the shaper below)
 *   cjk         Droid Sans Fallback — Chinese, Japanese
 *   hangul      Nanum Gothic — Korean
 *   devanagari  Noto Sans Devanagari — Hindi, Bhojpuri, Marathi
 *   bengali / tamil / telugu / gujarati / kannada / gurmukhi
 *   ethiopic    Noto Sans Ethiopic — Amharic
 *   thai        Noto Sans Thai
 *
 * Fonts load from disk lazily, one per script, and are cached as
 * base64 for jsPDF's VFS; they are never inlined into the JS bundle
 * (the whole set is ~10 MB on disk, and a single document registers
 * at most the fonts its own strings need).
 *
 * Delivery form (repackage, Nov 15, 2026): the publish route
 * carries UTF-8 text only, so the TTFs ship as base64 text chunks
 * (server/fonts/<Base>.b64.000, .001, ...) beside a manifest.json
 * recording each font's byte length and sha256. Loading joins the
 * chunks and verifies the decoded bytes against the manifest.
 * FAIL-SOFT, by design: a missing, unreadable or corrupt font is
 * simply unavailable — isPrintRenderable() then judges its strings
 * unrenderable, so labels degrade per string to the English
 * fallback (the pre-fonts WinAnsi behaviour) and data strings draw
 * in the standard font. Font loading NEVER throws up the draw
 * path; a print request cannot fail because a font is absent.
 *
 * Shaping honesty: jsPDF has no text-shaping engine. Scripts whose
 * rendering is a straight codepoint→glyph walk (CJK, Hangul,
 * Cyrillic, Greek, Ethiopic, Thai marks) print correctly. Arabic
 * script DOES shape — letters join — so this module carries a
 * small Arabic reshaper (presentation forms + visual order) that
 * runs before drawing; Noto Sans Arabic ships the presentation
 * forms, verified against its cmap. Indic scripts need full
 * OpenType shaping (conjuncts, pre-base matras) that a reshaper
 * cannot honestly reproduce: LABEL strings in Indic scripts keep
 * the per-string English fallback (see printLabels.js), while DATA
 * strings (a product's own name) still draw in the embedded Indic
 * font — the reader's own words, letter-faithful, rather than the
 * '?' mojibake the standard fonts produced before.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const FONT_FILES = {
  base: 'NotoSans-Regular.ttf',
  arabic: 'NotoSansArabic-Regular.ttf',
  cjk: 'DroidSansFallbackFull.ttf',
  hangul: 'NanumGothic-Regular.ttf',
  devanagari: 'NotoSansDevanagari-Regular.ttf',
  bengali: 'NotoSansBengali-Regular.ttf',
  tamil: 'NotoSansTamil-Regular.ttf',
  telugu: 'NotoSansTelugu-Regular.ttf',
  gujarati: 'NotoSansGujarati-Regular.ttf',
  kannada: 'NotoSansKannada-Regular.ttf',
  gurmukhi: 'NotoSansGurmukhi-Regular.ttf',
  ethiopic: 'NotoSansEthiopic-Regular.ttf',
  thai: 'NotoSansThai-Regular.ttf',
};

// The fonts directory normally sits beside this module; the env
// override exists so tests can point the loader at an empty or
// missing directory and prove the fail-soft degradation.
function fontsDirUrl() {
  if (process.env.SH_PRINT_FONTS_DIR) {
    const dir = process.env.SH_PRINT_FONTS_DIR;
    return pathToFileURL(dir.endsWith('/') ? dir : `${dir}/`);
  }
  return new URL('./fonts/', import.meta.url);
}

let manifestCache; // undefined: not tried yet; null: unavailable
function fontManifest() {
  if (manifestCache === undefined) {
    try {
      const raw = fs.readFileSync(new URL('manifest.json', fontsDirUrl()), 'utf8');
      const parsed = JSON.parse(raw);
      manifestCache = parsed && parsed.fonts ? parsed : null;
    } catch {
      manifestCache = null;
    }
  }
  return manifestCache;
}

const fontBase64Cache = new Map(); // key -> base64 string | null (unavailable)
/**
 * The font's base64 for jsPDF's VFS, or null when the font is
 * missing, unreadable or fails its manifest integrity check.
 * NEVER throws — see the fail-soft note in the header.
 */
export function fontBase64(key) {
  if (!FONT_FILES[key]) return null;
  if (!fontBase64Cache.has(key)) {
    let value = null;
    try {
      const entry = fontManifest()?.fonts?.[key];
      if (entry && Array.isArray(entry.chunks) && entry.chunks.length) {
        const dir = fontsDirUrl();
        const joined = entry.chunks
          .map((name) => fs.readFileSync(new URL(name, dir), 'utf8'))
          .join('')
          .replace(/\s+/g, '');
        const decoded = Buffer.from(joined, 'base64');
        const digest = crypto.createHash('sha256').update(decoded).digest('hex');
        if (decoded.length === entry.bytes && digest === entry.sha256) value = joined;
      }
    } catch {
      value = null;
    }
    fontBase64Cache.set(key, value);
  }
  return fontBase64Cache.get(key);
}

/** True when the embedded font for `key` is present and intact. */
export function fontAvailable(key) {
  return fontBase64(key) !== null;
}

/** Which embedded font's script a codepoint belongs to (null: none). */
export function scriptOfCodepoint(cp) {
  if (cp >= 0x0590 && cp <= 0x05ff) return 'base'; // Hebrew (in Noto Sans)
  if (cp >= 0x0400 && cp <= 0x04ff) return 'base'; // Cyrillic
  if (cp >= 0x0370 && cp <= 0x03ff) return 'base'; // Greek
  if (cp >= 0x1e00 && cp <= 0x1eff) return 'base'; // Latin Extended Additional (Vietnamese, Yoruba)
  if (cp >= 0x0600 && cp <= 0x06ff) return 'arabic';
  if (cp >= 0x0750 && cp <= 0x077f) return 'arabic';
  if (cp >= 0x08a0 && cp <= 0x08ff) return 'arabic';
  if (cp >= 0xfb50 && cp <= 0xfdff) return 'arabic';
  if (cp >= 0xfe70 && cp <= 0xfeff) return 'arabic';
  if (cp >= 0x0900 && cp <= 0x097f) return 'devanagari';
  if (cp >= 0x0980 && cp <= 0x09ff) return 'bengali';
  if (cp >= 0x0a01 && cp <= 0x0a7f) return 'gurmukhi';
  if (cp >= 0x0a80 && cp <= 0x0aff) return 'gujarati';
  if (cp >= 0x0b80 && cp <= 0x0bff) return 'tamil';
  if (cp >= 0x0c00 && cp <= 0x0c7f) return 'telugu';
  if (cp >= 0x0c80 && cp <= 0x0cff) return 'kannada';
  if (cp >= 0x1200 && cp <= 0x137f) return 'ethiopic';
  if (cp >= 0x0e00 && cp <= 0x0e7f) return 'thai';
  if (cp >= 0xac00 && cp <= 0xd7af) return 'hangul';
  if (cp >= 0x1100 && cp <= 0x11ff) return 'hangul';
  if (cp >= 0x4e00 && cp <= 0x9fff) return 'cjk';
  if (cp >= 0x3400 && cp <= 0x4dbf) return 'cjk';
  if (cp >= 0x3040 && cp <= 0x30ff) return 'cjk'; // kana
  if (cp >= 0xf900 && cp <= 0xfaff) return 'cjk';
  return null;
}

const isAscii = (cp) => cp < 0x80;

function isWinAnsiSafeCp(cp) {
  if (cp >= 0x20 && cp <= 0x7e) return true;
  if (cp >= 0xa0 && cp <= 0xff) return true;
  return WINANSI_EXTRA.has(cp);
}

/**
 * The embedded font that can draw this whole string, or null.
 * WinAnsi-safe characters ride along in every font (and in the
 * standard fonts), so only characters outside WinAnsi vote; a
 * string may use exactly ONE non-Latin script — mixed-script
 * strings stay with the caller's fallback (labels: English; data:
 * the standard font, as before).
 */
export function embeddedFontFor(text) {
  let script = null;
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (isWinAnsiSafeCp(cp)) continue;
    const s = scriptOfCodepoint(cp);
    if (!s) return null;
    if (script && s !== script) return null;
    script = s;
  }
  return script;
}

/** Scripts whose LABELS print in the embedded font (see header). */
export const LABEL_RENDERABLE_SCRIPTS = new Set([
  'base', 'arabic', 'cjk', 'hangul', 'ethiopic', 'thai',
]);

/**
 * Can this string print as-is in the PDF pipeline? True when the
 * standard fonts encode it (WinAnsi) or when one embedded font
 * covers it AND its script is label-renderable. Used by
 * printLabels.js for the per-string English fallback decision.
 */
export function isPrintRenderable(text, { forLabel = true } = {}) {
  const value = String(text);
  let winAnsi = true;
  for (const ch of value) {
    if (!isWinAnsiSafeCp(ch.codePointAt(0))) { winAnsi = false; break; }
  }
  if (winAnsi) return true;
  const font = embeddedFontFor(value);
  if (!font) return false;
  // A font that failed to load (missing/corrupt) renders nothing:
  // the string degrades to the caller's fallback, exactly as it
  // did before embedded fonts existed.
  if (!fontAvailable(font)) return false;
  return forLabel ? LABEL_RENDERABLE_SCRIPTS.has(font) : true;
}

const WINANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

// ---------------------------------------------------------------------
// Arabic shaping: logical-order Unicode → presentation forms in
// visual order, for jsPDF's left-to-right pen. Letters join per the
// standard rules; lam-alef ligatures included; vowel marks stay
// attached to their letter; digit runs keep their reading order;
// Latin/other runs keep theirs. A character with no form in the
// table passes through in its isolated form — graceful, never a gap.
// ---------------------------------------------------------------------

// [isolated, final, initial, medial] for dual-joining letters.
const DUAL = {
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c], // ئ
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92], // ب
  0x067e: [0xfb56, 0xfb57, 0xfb58, 0xfb59], // پ
  0x0679: [0xfb66, 0xfb67, 0xfb68, 0xfb69], // ٹ
  0x0686: [0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d], // چ
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98], // ت
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c], // ث
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0], // ج
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4], // ح
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8], // خ
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4], // س
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8], // ش
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc], // ص
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0], // ض
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4], // ط
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8], // ظ
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc], // ع
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0], // غ
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4], // ف
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8], // ق
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc], // ك
  0x06a9: [0xfb8e, 0xfb8f, 0xfb90, 0xfb91], // ک
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0], // ل
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4], // م
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8], // ن
  0x06be: [0xfbaa, 0xfbab, 0xfbac, 0xfbad], // ھ
  0x06c1: [0xfba6, 0xfba7, 0xfba8, 0xfba9], // ہ
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec], // ه
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4], // ي
  0x06cc: [0xfbfc, 0xfbfd, 0xfbfe, 0xfbff], // ی
  0x06af: [0xfb92, 0xfb93, 0xfb94, 0xfb95], // گ
};
// [isolated, final] for right-joining letters (join to the letter
// before them, never to the one after).
const RIGHT = {
  0x0622: [0xfe81, 0xfe82], // آ
  0x0623: [0xfe83, 0xfe84], // أ
  0x0624: [0xfe85, 0xfe86], // ؤ
  0x0625: [0xfe87, 0xfe88], // إ
  0x0627: [0xfe8d, 0xfe8e], // ا
  0x0629: [0xfe93, 0xfe94], // ة
  0x062f: [0xfea9, 0xfeaa], // د
  0x0688: [0xfb88, 0xfb89], // ڈ
  0x0630: [0xfeab, 0xfeac], // ذ
  0x0631: [0xfead, 0xfeae], // ر
  0x0691: [0xfb8c, 0xfb8d], // ڑ
  0x0632: [0xfeaf, 0xfeb0], // ز
  0x0698: [0xfb8a, 0xfb8b], // ژ
  0x0648: [0xfeed, 0xfeee], // و
  0x0649: [0xfeef, 0xfef0], // ى
  0x06d2: [0xfbae, 0xfbaf], // ے
};
// Lam-alef ligatures: [alef codepoint] -> [isolated, final].
const LAM_ALEF = {
  0x0622: [0xfef5, 0xfef6],
  0x0623: [0xfef7, 0xfef8],
  0x0625: [0xfef9, 0xfefa],
  0x0627: [0xfefb, 0xfefc],
};
const isArabicMark = (cp) => (cp >= 0x064b && cp <= 0x065f) || cp === 0x0670 || (cp >= 0x06d6 && cp <= 0x06ed);
const isArabicChar = (cp) => scriptOfCodepoint(cp) === 'arabic' && !isArabicMark(cp);
const isDigitChar = (cp) => (cp >= 0x30 && cp <= 0x39) || (cp >= 0x0660 && cp <= 0x0669) || (cp >= 0x06f0 && cp <= 0x06f9);

/** Shape one Arabic word (no spaces): returns presentation-form string in logical order. */
function shapeWord(chars) {
  // chars: array of codepoints (letters + marks). Build letter units
  // (letter + trailing marks), then pick each letter's form from its
  // neighbours' joining behaviour.
  const units = [];
  for (const cp of chars) {
    if (isArabicMark(cp) && units.length) units[units.length - 1].marks.push(cp);
    else units.push({ cp, marks: [] });
  }
  const joinsForward = (cp) => Boolean(DUAL[cp]); // joins to the NEXT letter
  const joinsBack = (cp) => Boolean(DUAL[cp] || RIGHT[cp]); // joins to the PREVIOUS letter
  const out = [];
  for (let i = 0; i < units.length; i += 1) {
    const { cp, marks } = units[i];
    // Lam-alef ligature: ل followed by an alef variant.
    if (cp === 0x0644 && i + 1 < units.length && LAM_ALEF[units[i + 1].cp] && !units[i + 1].marks.length) {
      const prevJoins = i > 0 && joinsForward(units[i - 1].cp);
      out.push(LAM_ALEF[units[i + 1].cp][prevJoins ? 1 : 0], ...marks);
      i += 1;
      continue;
    }
    const prevJoins = i > 0 && joinsForward(units[i - 1].cp) && joinsBack(cp);
    const nextJoins = i + 1 < units.length && joinsForward(cp) && joinsBack(units[i + 1].cp);
    let form = cp;
    if (DUAL[cp]) form = DUAL[cp][prevJoins && nextJoins ? 3 : prevJoins ? 1 : nextJoins ? 2 : 0];
    else if (RIGHT[cp]) form = RIGHT[cp][prevJoins ? 1 : 0];
    else if (cp === 0x0621) form = 0xfe80; // hamza isolated
    out.push(form, ...marks);
  }
  return out;
}

/**
 * Full Arabic-script shaping + visual ordering for one string.
 * Non-Arabic runs keep their order; Arabic runs are shaped word by
 * word and cluster-reversed; when the string's first strong run is
 * Arabic, the run order reverses too (RTL paragraph).
 */
export function shapeArabicText(text) {
  const chars = [...String(text)];
  // Tokenize into TWO run kinds: arabic runs, and latin runs
  // (everything else — Latin words, dates, money, codes — kept
  // whole and in reading order, because a date or an amount is one
  // LTR phrase wherever it lands). Spaces attach to the run they
  // follow.
  const runs = [];
  let current = null;
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    const kind = ch === ' ' && current
      ? current.kind
      : (isArabicChar(cp) || isArabicMark(cp) ? 'arabic' : 'latin');
    if (!current || current.kind !== kind) {
      current = { kind, chars: [] };
      runs.push(current);
    }
    current.chars.push(ch);
  }
  const shaped = runs.map((run) => {
    if (run.kind !== 'arabic') return run.chars.join('');
    // Shape word by word, then reverse cluster order for visual LTR
    // drawing. A cluster = one shaped letter + its marks; a run of
    // digit clusters (a number written inside Arabic text) stays
    // in reading order as one super-cluster.
    const words = [];
    let word = [];
    const flush = () => { if (word.length) { words.push(word); word = []; } };
    for (const ch of run.chars) {
      if (ch === ' ') { flush(); words.push([' ']); } else word.push(ch.codePointAt(0));
    }
    flush();
    const visualWords = words.map((w) => {
      if (w[0] === ' ') return ' ';
      const shapedCps = shapeWord(w);
      const clusters = [];
      for (const cp of shapedCps) {
        if (isArabicMark(cp) && clusters.length) clusters[clusters.length - 1].push(cp);
        else clusters.push([cp]);
      }
      const grouped = [];
      for (const cluster of clusters) {
        const prev = grouped[grouped.length - 1];
        if (prev && prev.digit && isDigitChar(cluster[0])) prev.cps.push(...cluster);
        else grouped.push({ digit: isDigitChar(cluster[0]), cps: [...cluster] });
      }
      return grouped.reverse().map((g) => String.fromCodePoint(...g.cps)).join('');
    });
    // Words themselves reverse within the run.
    return visualWords.reverse().join('');
  });
  const firstStrong = runs.find((r) => r.kind === 'arabic' || /[\p{L}\p{N}]/u.test(r.chars.join('')));
  if (firstStrong && firstStrong.kind === 'arabic') shaped.reverse();
  return shaped.join('');
}

/** Prepare a string for drawing in the given embedded font. */
export function prepareForFont(text, fontKey) {
  return fontKey === 'arabic' ? shapeArabicText(text) : String(text);
}

// Bidi control marks (RLM/LRM, embeddings, isolates) are formatting
// instructions for a bidi engine; this pipeline draws visual order
// itself, and a stray mark (Intl emits U+200F for 'ar' currency)
// would flip the drawn line in renderers. They are never content.
const BIDI_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
export function stripBidiControls(text) {
  return String(text).replace(BIDI_CONTROLS, '');
}

// ---------------------------------------------------------------------
// jsPDF integration
//
// One jsPDF quirk shapes this layer: its TTF encoder drops Latin
// letters in some embedded fonts (Noto Sans Arabic, Droid Sans
// Fallback) even though their cmaps carry them. So a mixed string
// is never handed to an embedded font whole: it is segmented into
// runs — the embedded font draws only its own script's characters,
// the document's standard font draws everything WinAnsi-safe — and
// the pen advances by each run's measured width. Single-script
// strings (the common case) stay a single draw.
// ---------------------------------------------------------------------

const registeredDocs = new WeakMap();

/**
 * Register the embedded font for `fontKey` on this doc (both styles;
 * the regular face serves bold too — these documents' bold is a
 * weight cue, and a correct script beats a heavier wrong one).
 * Returns the jsPDF font name, or null when unavailable.
 */
export function registerPrintFont(doc, fontKey) {
  if (!fontKey || !FONT_FILES[fontKey]) return null;
  let registered = registeredDocs.get(doc);
  if (!registered) {
    registered = new Set();
    registeredDocs.set(doc, registered);
  }
  const name = `print-${fontKey}`;
  if (!registered.has(fontKey)) {
    const b64 = fontBase64(fontKey);
    if (!b64) return null; // unavailable: caller draws standard/fallback
    const file = FONT_FILES[fontKey];
    try {
      doc.addFileToVFS(file, b64);
      doc.addFont(file, name, 'normal');
      doc.addFont(file, name, 'bold');
    } catch {
      return null;
    }
    registered.add(fontKey);
  }
  return name;
}

/** Segment a prepared string into [text, useEmbedded] runs. */
function segmentRuns(value, fontKey) {
  const runs = [];
  let current = null;
  for (const ch of value) {
    const embedded = !isWinAnsiSafeCp(ch.codePointAt(0)) && scriptOfCodepoint(ch.codePointAt(0)) === fontKey;
    if (!current || current.embedded !== embedded) {
      current = { text: '', embedded };
      runs.push(current);
    }
    current.text += ch;
  }
  return runs.filter((run) => run.text.length);
}

function withFont(doc, name, style, fn) {
  const current = doc.getFont();
  doc.setFont(name, style);
  try {
    return fn();
  } finally {
    doc.setFont(current.fontName, current.fontStyle);
  }
}

/** Width of a prepared string, measured run by run in its real fonts. */
function measureRuns(doc, value, fontKey, embeddedName, style) {
  const current = doc.getFont();
  let width = 0;
  for (const run of segmentRuns(value, fontKey)) {
    if (run.embedded && embeddedName) {
      width += withFont(doc, embeddedName, style, () => doc.getTextWidth(run.text));
    } else {
      width += doc.getTextWidth(run.text);
    }
  }
  doc.setFont(current.fontName, current.fontStyle);
  return width;
}

function drawRuns(doc, value, fontKey, embeddedName, x, y, style) {
  const current = doc.getFont();
  let pen = x;
  for (const run of segmentRuns(value, fontKey)) {
    if (run.embedded && embeddedName) {
      const w = withFont(doc, embeddedName, style, () => {
        const width = doc.getTextWidth(run.text);
        doc.text(run.text, pen, y);
        return width;
      });
      pen += w;
    } else {
      doc.setFont(current.fontName, current.fontStyle);
      const width = doc.getTextWidth(run.text);
      doc.text(run.text, pen, y);
      pen += width;
    }
  }
  doc.setFont(current.fontName, current.fontStyle);
}

/**
 * Draw text, choosing the embedded font when the string needs one
 * and this doc can serve it. Returns 'embedded' or 'standard'.
 */
export function drawPrintText(doc, text, x, y, options) {
  if (Array.isArray(text)) {
    // Multi-line input comes from splitPrintText (already shaped).
    // Lines draw one by one at jsPDF's line spacing, in whichever
    // font each line needs.
    const lineHeight = doc.getFontSize() * doc.getLineHeightFactor();
    let mode = 'standard';
    text.forEach((line, i) => {
      if (drawPrepared(doc, stripBidiControls(line), x, y + i * lineHeight, options, true) === 'embedded') mode = 'embedded';
    });
    return mode;
  }
  return drawPrepared(doc, stripBidiControls(text), x, y, options, false);
}

function drawPrepared(doc, value, x, y, options, preShaped) {
  const fontKey = embeddedFontFor(value);
  if (!fontKey) {
    doc.text(value, x, y, options);
    return 'standard';
  }
  const name = registerPrintFont(doc, fontKey);
  if (!name) {
    doc.text(value, x, y, options);
    return 'standard';
  }
  const prepared = preShaped ? value : prepareForFont(value, fontKey);
  const runs = segmentRuns(prepared, fontKey);
  if (runs.length === 1 && runs[0].embedded) {
    const current = doc.getFont();
    doc.setFont(name, current.fontStyle === 'bold' ? 'bold' : 'normal');
    doc.text(prepared, x, y, options);
    doc.setFont(current.fontName, current.fontStyle);
    return 'embedded';
  }
  drawRuns(doc, prepared, fontKey, name, x, y, doc.getFont().fontStyle === 'bold' ? 'bold' : 'normal');
  return 'embedded';
}

/**
 * splitTextToSize measured in the fonts that will actually draw
 * the string (embedded metrics differ from helvetica's, and mixed
 * strings measure run by run).
 */
export function splitPrintText(doc, text, width) {
  const value = stripBidiControls(text);
  const fontKey = embeddedFontFor(value);
  if (!fontKey) return doc.splitTextToSize(value, width);
  const name = registerPrintFont(doc, fontKey);
  if (!name) return doc.splitTextToSize(value, width);
  const prepared = prepareForFont(value, fontKey);
  const style = doc.getFont().fontStyle === 'bold' ? 'bold' : 'normal';
  const measure = (s) => measureRuns(doc, s, fontKey, name, style);
  // Word wrap on the prepared string; a word longer than the line
  // breaks by character (CJK text has no spaces to wrap on).
  const words = prepared.split(' ');
  const lines = [];
  let line = '';
  const pushLine = () => { if (line) { lines.push(line); line = ''; } };
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= width) {
      line = candidate;
      continue;
    }
    pushLine();
    if (measure(word) <= width) {
      line = word;
      continue;
    }
    let chunk = '';
    for (const ch of word) {
      if (chunk && measure(chunk + ch) > width) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    line = chunk;
  }
  pushLine();
  return lines.length ? lines : [''];
}
