import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';


export default function CountLineRow({ line, onChange }) {
  const parsed = Number(line.counted);
  const counted =
    line.counted === null || line.counted === '' || !Number.isFinite(parsed) ? null : parsed;
  const diff = counted === null ? null : counted - (Number(line.expected) || 0);

  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-border py-1.5 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm">{line.product_name}</p>
        <p className="font-mono text-[10px] text-muted-foreground">{line.sku}</p>
      </div>
      <div className="w-14 text-right">
        <p className="numeric text-sm text-muted-foreground">{line.expected}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="numeric"
          min="0"
          className="h-8 w-16 text-center"
          value={line.counted ?? ''}
          placeholder="—"
          aria-label={t('counts.countedAria', { name: line.product_name })}
          onChange={(e) => {
            const raw = e.target.value;
            const next = Number(raw);
            // A transient "-" or half-typed number clears the cell instead of
            // being stored, so it can never be applied as a count.
            onChange(raw === '' || !Number.isFinite(next) || next < 0 ? null : next);
          }}
        />
        <span
          className={`numeric w-9 text-right text-[11px] ${
            diff === null ? 'text-muted-foreground' : diff === 0 ? 'text-ok' : 'text-warn'
          }`}
        >
          {diff === null ? '' : diff > 0 ? `+${diff}` : diff}
        </span>
      </div>
    </div>
  );
}