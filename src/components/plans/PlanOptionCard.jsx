import { Check } from 'lucide-react';
import { t } from '@/lib/i18n';
import { formatPrice } from '@/lib/plans';

/**
 * One subscription offered on the introduction and comparison screens. Display
 * only — the action passed in is what a customer chooses, never a charge.
 */
export default function PlanOptionCard({ option, action, highlight = false }) {
  return (
    <div
      className={`flex h-full flex-col rounded-xl border bg-card p-4 sm:p-5 ${
        highlight ? 'border-primary/40 shadow-sm' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold leading-tight">{option.name}</h3>
        {option.available === false && (
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
            {t('plans.atLaunch')}
          </span>
        )}
      </div>

      <p className="mt-2 flex items-baseline gap-1">
        <span className="numeric text-2xl font-semibold">{formatPrice(option.price)}</span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {t('plans.perMonth')}
        </span>
      </p>

      {option.key === 'essentials' || option.key === 'business' ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('plans.taxNoteWebsite')}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('plans.taxNoteMobile')}
        </p>
      )}

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{option.blurb}</p>

      <ul className="mt-3 flex-1 space-y-1.5">
        {option.includes.map((line) => (
          <li key={line} className="flex gap-1.5 text-xs leading-snug">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}