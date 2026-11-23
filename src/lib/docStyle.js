/**
 * Document Style Studio (Nov 14, 2026) — the choices that dress a
 * business's printed documents: its logo at the top, color or
 * black-and-white, a document font, a page frame, and its own
 * pictures at the top and bottom of the page.
 *
 * The choices live on the business record (businesses.doc_style,
 * migration 025), saved through the same owner-only Settings patch
 * as the logo; the server validates against these same whitelists
 * (server/authRoutes.js sanitizeDocStyle). The studio on the Print
 * page edits them; every document in the letter-size family reads
 * them through resolveDocStyle.
 *
 * HARD GUARD (the owner's honesty doctrine): the style dresses
 * the FRAME only. It can never touch the facts — prices, totals,
 * addresses and the honest footers print exactly as they are,
 * whatever style is chosen.
 */

import { formatLongDate, formatTimeOnly } from './dates.js';

export const DOC_FONTS = {
  default: '',
  serif: "Georgia, 'Times New Roman', Times, serif",
  sans: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  typewriter: "'Courier New', Courier, monospace",
};

export const DOC_FONT_KEYS = Object.keys(DOC_FONTS);

export const DOC_BORDERS = ['none', 'single', 'double', 'dashed', 'dotted'];

/**
 * Decoration picture sizes (release 350, Nov 23, 2026): the owner
 * sizes each decoration in the Studio — a WIDTH (the share of the
 * document width the banner spans, percent) and a LENGTH (the
 * tallest the banner may print, millimetres). Both stay null when
 * never set, and null renders exactly as documents always have:
 * full width under the document's own height cap. A stored value
 * outside the sane range resolves back to null — reads never break.
 */
export const DECO_WIDTH_MIN = 10;
export const DECO_WIDTH_MAX = 100;
export const DECO_LENGTH_MIN = 4;
export const DECO_LENGTH_MAX = 100;

const decoSize = (value, min, max) => {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export const DEFAULT_DOC_STYLE = {
  color: false,
  font: 'default',
  border: 'none',
  headerImage: '',
  footerImage: '',
  headerWidth: null,
  headerLength: null,
  footerWidth: null,
  footerLength: null,
};

/** The business's saved style, always the full resolved object. */
export function resolveDocStyle(business) {
  const saved = business?.doc_style;
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_DOC_STYLE };
  return {
    color: saved.color === true,
    font: DOC_FONT_KEYS.includes(saved.font) ? saved.font : 'default',
    border: DOC_BORDERS.includes(saved.border) ? saved.border : 'none',
    headerImage: typeof saved.headerImage === 'string' ? saved.headerImage : '',
    footerImage: typeof saved.footerImage === 'string' ? saved.footerImage : '',
    headerWidth: decoSize(saved.headerWidth, DECO_WIDTH_MIN, DECO_WIDTH_MAX),
    headerLength: decoSize(saved.headerLength, DECO_LENGTH_MIN, DECO_LENGTH_MAX),
    footerWidth: decoSize(saved.footerWidth, DECO_WIDTH_MIN, DECO_WIDTH_MAX),
    footerLength: decoSize(saved.footerLength, DECO_LENGTH_MIN, DECO_LENGTH_MAX),
  };
}

/** True when the style changes nothing — documents print as they always have. */
export function isPlainDocStyle(style) {
  const resolved = style ?? DEFAULT_DOC_STYLE;
  return (
    resolved.color !== true &&
    (resolved.font ?? 'default') === 'default' &&
    (resolved.border ?? 'none') === 'none' &&
    !resolved.headerImage &&
    !resolved.footerImage
  );
}

/** The CSS font-family for a style ('' keeps the app's own font). */
export function docFontFamily(style) {
  return DOC_FONTS[style?.font] ?? '';
}

const FRAME_SPECS = {
  single: { border: '1pt solid', padding: '5mm' },
  double: { border: '2.5pt double', padding: '5mm' },
  dashed: { border: '1pt dashed', padding: '5mm' },
  dotted: { border: '1.2pt dotted', padding: '5mm' },
};

/**
 * Inline style for a document root carrying the studio's choices.
 * The frame itself no longer rides on the root (release 350): it
 * is a DocFrame overlay that frames the document block on screen
 * and the FULL printed page on paper. The root keeps only the
 * font and — when a frame is chosen — the frame's padding, so
 * the words keep their distance from the frame line exactly as
 * they always have. With no frame chosen the document keeps its
 * own padding exactly (padding: undefined).
 */
export function docRootStyle(style, brandColor) {
  const resolved = style ?? DEFAULT_DOC_STYLE;
  const frame = FRAME_SPECS[resolved.border];
  const fontFamily = docFontFamily(resolved);
  if (!frame) return fontFamily ? { fontFamily } : {};
  return {
    ...(fontFamily ? { fontFamily } : {}),
    padding: frame.padding,
  };
}

/**
 * The frame line for a style (release 350): the border CSS the
 * DocFrame overlay draws, or null when no frame is chosen. The
 * frame color follows the brand color when color printing is on
 * and the business has one; otherwise the frame is the same
 * honest black as the document text.
 */
export function docFrameStyle(style, brandColor) {
  const resolved = style ?? DEFAULT_DOC_STYLE;
  const frame = FRAME_SPECS[resolved.border];
  if (!frame) return null;
  const color =
    resolved.color === true && /^#[0-9a-fA-F]{6}$/.test(brandColor || '')
      ? brandColor
      : '#000';
  return { border: `${frame.border} ${color}` };
}

/**
 * Inline style for one decoration banner (release 350; stretch
 * ruled by the owner Nov 23, 2026, release 353). Two shapes:
 *
 * NEVER SIZED (width and length both unset): exactly as
 * documents have always rendered — full width, NATURAL
 * proportions (object-fit: contain) under the document's own
 * long-standing height cap (capMm). Nothing about the unsized
 * banner changed in 353.
 *
 * SIZED (the owner set a width and/or a length in the Studio):
 * the picture STRETCHES to fill the exact band she set — the
 * chosen share of the page width, the chosen length tall —
 * the whole picture pulled to fit, edges never trimmed
 * (object-fit: fill). Her words: the numbers belong to the
 * owner; "it'll really be up to them how wide they want it."
 * (350 shipped contain for the sized case too, so a square
 * picture letterboxed into a small centered square however
 * wide she asked the band to be — her hand-proof caught it.)
 * When only the width is set, the document's standing cap
 * still bounds the band's height and the picture fills that
 * box; when only the length is set, the band runs full width
 * at exactly that height.
 */
export function decoImageStyle(style, slot, capMm = 24) {
  const resolved = style ?? DEFAULT_DOC_STYLE;
  const width = resolved[`${slot}Width`];
  const length = resolved[`${slot}Length`];
  if (!width && !length) {
    return {
      display: 'block',
      width: '100%',
      maxHeight: `${capMm}mm`,
      objectFit: 'contain',
      marginInline: 'auto',
    };
  }
  return {
    display: 'block',
    width: `${width ?? 100}%`,
    ...(length ? { height: `${length}mm` } : { maxHeight: `${capMm}mm` }),
    objectFit: 'fill',
    marginInline: 'auto',
  };
}

/**
 * The printed-at stamp's words (release 350): the date and time
 * a document was printed, formatted by the reader's own locale.
 * Returns the parts; the sentence itself is the reader's language
 * (print.printedAt).
 *
 * Release 358 (dates the local way): the date part is now the
 * locale's FULL convention — weekday + day + month name + year —
 * through the shared Intl helpers in lib/dates, the same helpers
 * every other surface reads. Because the 357 time trails render
 * through this function too, the one change sweeps the printed-at
 * stamp and every trail stamp together.
 */
export function formatPrintedAt(date = new Date(), locale = 'en') {
  return {
    date: formatLongDate(date, locale || 'en'),
    time: formatTimeOnly(date, locale || 'en'),
  };
}

/** Class flags a document root carries for the print stylesheet. */
export function docRootClass(style) {
  return style?.color === true ? 'doc-color-on' : 'doc-bw';
}
