import { t, useLocale } from '@/lib/i18n';

/**
 * The owner's not-for-sale statement, in her own words.
 *
 * Nov 15, 2026 — her ruling: the block translates into all 52
 * locales like everything else. It renders from the locale keys
 * (notice.*); the English values are byte-identical to the frozen
 * module src/lib/trademarkNotice.js, which stays the frozen
 * reference of her exact words — translations are renderings,
 * never edits. Do not paraphrase her words in any locale; any
 * wording change belongs to her, on her word.
 *
 * Shown on Plans (the page people see before subscribing) and on
 * Subscribe (right as the subscription process starts), so anyone
 * about to pay sees it first. Nov 15, 2026 — her ruling ("it should
 * have already been in there"): restored to the Welcome front door
 * and the About page as well, and it rides Register's create-account
 * branch. Styled as a calm statement card in the app's own look:
 * the shield heading, the quote in italic, the two sub-headings bold.
 */
export default function TrademarkNotice() {
  useLocale();
  return (
    <section
      aria-label={t('notice.ariaLabel')}
      className="mt-8 rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <h2 className="text-lg font-semibold leading-snug sm:text-xl">{t('notice.heading')}</h2>
      <blockquote className="mt-4 space-y-4 text-sm leading-relaxed text-muted-foreground italic">
        <p>{t('notice.intro')}</p>
        <p>
          <strong className="font-semibold text-foreground">{t('notice.legalHeading')}</strong>{' '}
          {t('notice.legalBody')}
        </p>
        <p>
          <strong className="font-semibold text-foreground">{t('notice.acquisitionHeading')}</strong>{' '}
          {t('notice.acquisitionBody')}
        </p>
      </blockquote>
    </section>
  );
}
