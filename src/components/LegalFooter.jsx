import { Link } from 'react-router-dom';
import { LEGAL_FOOTER as footer } from '@/lib/trademarkNotice';
import { t } from '@/lib/i18n';

/**
 * Small, centered legal line at the bottom of the pages. (The old
 * © line was removed on Nov 12, 2026, then restored the same day on
 * her word without the © symbol and with her registered legal name,
 * Book and Shop as separate words — the exact text lives in
 * src/lib/trademarkNotice.js.)
 * Deliberately quiet — it must not interfere with a customer's work.
 * The text lives in src/lib/trademarkNotice.js and is rendered verbatim.
 *
 * The About link sits alongside the legal text, small and subtle, so
 * anyone can reach the founder's story from every page that carries
 * this footer.
 *
 * `className` is extra spacing for the context it sits in — the shared
 * Layout passes bottom padding so the line clears the fixed mobile tab
 * bar; every other page leaves it off.
 */
export default function LegalFooter({ className = '' }) {
  return (
    <footer
      className={`mt-10 border-t border-border pt-4 text-center text-[11px] leading-relaxed text-muted-foreground ${className}`}
    >
      <p>
        <Link to="/about" className="font-medium underline underline-offset-4 hover:text-foreground">
          {t('layout.aboutLink')}
        </Link>
      </p>
      <p className="mt-1">{footer.copyrightLine}</p>
      <p className="mt-1">{footer.trademarkLine}</p>
    </footer>
  );
}
