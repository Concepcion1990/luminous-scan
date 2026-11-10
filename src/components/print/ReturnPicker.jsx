import { reasonLabel, RETURN_KINDS, RETURN_STATUS } from '@/lib/returns';
import { t } from '@/lib/i18n';

const TONE = {
  muted: 'bg-muted text-muted-foreground',
  warn: 'bg-warn/15 text-warn',
  info: 'bg-secondary text-secondary-foreground',
  ok: 'bg-ok/15 text-ok',
};

export default function ReturnPicker({ returns, value, onChange }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('print.returnsExchanges')}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{t('print.pickReturnToPrint')}</p>
      <div className="mt-3 max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
        {returns.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {t('print.noReturns')}
          </p>
        )}
        {returns.map((ret) => {
          const status = RETURN_STATUS[ret.status] || RETURN_STATUS.new;
          const kind = RETURN_KINDS.find((k) => k.value === ret.kind);
          return (
            <button
              key={ret.id}
              type="button"
              onClick={() => onChange(ret.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                value === ret.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="numeric text-xs font-semibold">{ret.number}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${TONE[status.tone] || TONE.muted}`}>
                  {status.label}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {kind?.label || t('print.returnFallback')} · {reasonLabel(ret.reason)} ·{' '}
                {ret.customer_name || ret.order_number || t('print.noCustomerLower')}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}