import { decoImageStyle, docFrameStyle, formatPrintedAt } from '@/lib/docStyle';
import { getLocale, t } from '@/lib/i18n';

/**
 * The shared dressing of the letter-size document family
 * (release 350, Nov 23, 2026): the Studio's page frame, its two
 * decoration banners, and the printed-at stamp. Every document
 * the Studio touches renders these the same way, so the frame,
 * the banners and the stamp can never drift apart between an
 * invoice, a purchase order and a count sheet.
 *
 * THE FRAME frames the document block on screen and the FULL
 * printed page on paper (the print stylesheet promotes it to a
 * fixed overlay at the page's edge, repeated on every sheet).
 * The 80mm receipt is the one exception: it is a slip, so its
 * frame (page={false}) stays around the slip itself.
 *
 * THE BANNERS: unsized, they print at their natural
 * proportions; sized in the Studio, they STRETCH to fill the
 * exact band the owner set (see decoImageStyle — her ruling,
 * Nov 23, 2026). The bottom banner ANCHORS at the page bottom
 * on paper — the print stylesheet fixes its wrapper to the
 * bottom of the sheet; on screen, and on the receipt slip, it
 * simply follows the words.
 *
 * CENTERED ON THE PAGE (release 355, Nov 23, 2026 — her
 * ruling: the picture "starts at the center" and widens
 * "outward equally on each side" to the set width). The
 * bottom banner's print wrapper spans the printable width,
 * so on paper it has always been centered on the PAGE. The
 * top banner rendered only inside the 180mm document root,
 * so on paper it centered on the DOCUMENT instead — at her
 * 50% setting the two banners printed at different widths
 * around different centers. The top banner therefore renders
 * TWICE: the in-flow copy the preview shows (centered in the
 * document, holding the banner's space in the layout), and a
 * print-only band copy the print stylesheet fixes across the
 * top of the printable area — the same span the bottom
 * banner's wrapper gets — where the picture centers on the
 * page at the set share of the page's width. On paper the
 * in-flow copy keeps its space but does not paint. The
 * receipt slip (band={false}) is a slip, not a page: its
 * banner stays inside the slip, centered there.
 *
 * THE STAMP prints on every Studio document — and nowhere else:
 * the 4×6 shipping label never carries it.
 */

export function DocFrame({ style, brandColor, page = true }) {
  const frame = docFrameStyle(style, brandColor);
  if (!frame) return null;
  return (
    <div
      aria-hidden="true"
      className={page ? 'doc-frame doc-frame-page' : 'doc-frame doc-frame-box'}
      style={frame}
    />
  );
}

export function DecoHeader({ style, capMm = 24, band = true, className = '' }) {
  if (!style?.headerImage) return null;
  const imgStyle = decoImageStyle(style, 'header', capMm);
  return (
    <>
      <img
        src={style.headerImage}
        alt=""
        className={`doc-deco ${band ? 'doc-deco-flow ' : ''}${className}`}
        style={imgStyle}
      />
      {band && (
        <div aria-hidden="true" className="doc-deco-top">
          <img src={style.headerImage} alt="" className="doc-deco" style={imgStyle} />
        </div>
      )}
    </>
  );
}

export function DecoFooter({ style, capMm = 24, anchor = true, className = '' }) {
  if (!style?.footerImage) return null;
  return (
    <div className={`${anchor ? 'doc-deco-bottom' : ''} ${className}`}>
      <img
        src={style.footerImage}
        alt=""
        className="doc-deco"
        style={decoImageStyle(style, 'footer', capMm)}
      />
    </div>
  );
}

export function PrintedAt({ className = '' }) {
  const { date, time } = formatPrintedAt(new Date(), getLocale());
  return (
    <p
      className={`font-mono text-[6.5pt] uppercase tracking-wide text-black/60 ${className}`}
    >
      {t('print.printedAt', { date, time })}
    </p>
  );
}
