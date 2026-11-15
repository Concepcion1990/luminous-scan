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

export const DOC_FONTS = {
  default: '',
  serif: "Georgia, 'Times New Roman', Times, serif",
  sans: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
  typewriter: "'Courier New', Courier, monospace",
};

export const DOC_FONT_KEYS = Object.keys(DOC_FONTS);

export const DOC_BORDERS = ['none', 'single', 'double', 'dashed', 'dotted'];

export const DEFAULT_DOC_STYLE = {
  color: false,
  font: 'default',
  border: 'none',
  headerImage: '',
  footerImage: '',
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
 * The frame color follows the brand color when color printing is
 * on and the business has one; otherwise the frame is the same
 * honest black as the document text. With no frame chosen the
 * document keeps its own padding exactly (padding: undefined).
 */
export function docRootStyle(style, brandColor) {
  const resolved = style ?? DEFAULT_DOC_STYLE;
  const frame = FRAME_SPECS[resolved.border];
  const fontFamily = docFontFamily(resolved);
  if (!frame) return fontFamily ? { fontFamily } : {};
  const color =
    resolved.color === true && /^#[0-9a-fA-F]{6}$/.test(brandColor || '')
      ? brandColor
      : '#000';
  return {
    ...(fontFamily ? { fontFamily } : {}),
    border: `${frame.border} ${color}`,
    padding: frame.padding,
  };
}

/** Class flags a document root carries for the print stylesheet. */
export function docRootClass(style) {
  return style?.color === true ? 'doc-color-on' : 'doc-bw';
}
