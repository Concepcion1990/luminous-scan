import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { conditionLabel, reasonLabel, RETURN_STATUS } from '@/lib/returns';
import { money } from '@/lib/purchasing';
import { t } from '@/lib/i18n';

const PILL = {
  muted: 'bg-muted text-muted-foreground',
  info: 'bg-secondary text-foreground',
  warn: 'bg-warn/15 text-warn',
  ok: 'bg-ok/12 text-ok',
};

export default function ReturnCard({ record, currency, busy, onEdit, onAction }) {
  const status = RETURN_STATUS[record.status] || RETURN_STATUS.new;
  const lines = record.lines || [];
  const replacements = record.exchange_lines || [];

  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-sm font-semibold">{record.number}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL[status.tone]}`}>
              {status.label}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {record.kind === 'exchange' ? t('returns.exchange') : t('returns.returnKind')}
            </span>
          </div>
          <p className="mt-1 truncate text-sm">
            {record.customer_name || t('returns.noCustomerName')}
            {record.order_number ? ` · ${record.order_number}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[reasonLabel(record.reason), record.received_date, record.location_name]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="text-right">
          <p className="numeric text-sm font-semibold">{money(record.refund_amount, currency)}</p>
          <p className="text-[11px] text-muted-foreground">{t('returns.refundRecorded')}</p>
        </div>
      </div>

      <ul className="mt-2.5 space-y-1 border-t border-border pt-2.5 text-xs">
        {lines.map((line, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="min-w-0 truncate">
              {line.product_name}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">{line.sku}</span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              {line.quantity} · {conditionLabel(line.condition)} ·{' '}
              {line.restock ? t('returns.restock') : t('returns.notRestocked')}
            </span>
          </li>
        ))}
        {replacements.map((line, i) => (
          <li key={`x-${i}`} className="flex justify-between gap-2 text-ok">
            <span className="min-w-0 truncate">
              {t('returns.replacement', { name: line.product_name })}
            </span>
            <span className="numeric shrink-0">{line.quantity}</span>
          </li>
        ))}
      </ul>

      {record.notes && <p className="mt-2 text-xs text-muted-foreground">{record.notes}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {record.status === 'new' && (
          <Button size="sm" disabled={busy} onClick={() => onAction('approve')}>
            {t('returns.approve')}
          </Button>
        )}
        {record.status === 'approved' && (
          <Button size="sm" disabled={busy} onClick={() => onAction('complete')}>
            {t('returns.completeApply')}
          </Button>
        )}
        {['new', 'approved'].includes(record.status) && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>
            <Pencil className="mr-1 h-3.5 w-3.5" /> {t('returns.edit')}
          </Button>
        )}
        {['new', 'approved'].includes(record.status) && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction('reject')}>
            {t('returns.reject')}
          </Button>
        )}
        {['new', 'rejected'].includes(record.status) && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            disabled={busy}
            onClick={() => onAction('delete')}
            aria-label={t('returns.deleteAria', { number: record.number })}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}