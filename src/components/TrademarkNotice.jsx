import { TRADEMARK_NOTICE as notice } from '@/lib/trademarkNotice';

/**
 * The owner's trademark / copyright statement, in her own words, verbatim.
 * The text lives in src/lib/trademarkNotice.js — this component only lays
 * it out. Do not paraphrase it here; any wording change belongs in that
 * module, and only on the owner's word.
 *
 * Shown on Plans (the page people see before subscribing) and on
 * Subscribe (right as the subscription process starts), so anyone about
 * to pay sees it first. Styled as a calm statement card in the app's own
 * look: the shield heading, the quote in italic, the two sub-headings
 * bold.
 */
export default function TrademarkNotice() {
  return (
    <section
      aria-label="Trademark and copyright notice"
      className="mt-8 rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <h2 className="text-lg font-semibold leading-snug sm:text-xl">{notice.heading}</h2>
      <blockquote className="mt-4 space-y-4 text-sm leading-relaxed text-muted-foreground italic">
        <p>{notice.intro}</p>
        <p>
          <strong className="font-semibold text-foreground">{notice.legalHeading}</strong>{' '}
          {notice.legalBody}
        </p>
        <p>
          <strong className="font-semibold text-foreground">{notice.acquisitionHeading}</strong>{' '}
          {notice.acquisitionBody}
        </p>
      </blockquote>
    </section>
  );
}
