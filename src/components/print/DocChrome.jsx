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
 * THE BANNERS print at their natural proportions inside the
 * owner's chosen width/length (see decoImageStyle). The bottom
 * banner ANCHORS at the page bottom on paper — the print
 * stylesheet fixes its wrapper to the bottom of the sheet; on
 * screen, and on the receipt slip, it simply follows the words.
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

export function DecoHeader({ style, capMm = 24, className = '' }) {
  if (!style?.headerImage) return null;
  return (
    <img
      src={style.headerImage}
      alt=""
      className={`doc-deco ${className}`}
      style={decoImageStyle(style, 'header', capMm)}
    />
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
