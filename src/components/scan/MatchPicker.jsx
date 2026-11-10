import { RotateCcw, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

/** Shown when one scanned code matches several products, such as ISBN copies. */
export default function MatchPicker({ matches, onSelect, onDismiss }) {
  return (
    <div className="space-y-3 p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-medium">
            {t('scan.matchesCount', { count: matches.length, s: matches.length === 1 ? '' : 's' })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('scan.matchPickerHint')}
          </p>
        </div>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {matches.map((match) => (
          <li key={match.id}>
            <button
              type="button"
              onClick={() => onSelect(match)}
              className="w-full px-3 py-2.5 text-left transition-colors hover:bg-muted"
            >
              <span className="block truncate text-sm font-medium">{match.name}</span>
              <span className="numeric block truncate text-xs text-muted-foreground">
                {[match.sku, match.upc, match.condition].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Button variant="ghost" size="sm" onClick={onDismiss}>
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {t('scan.scanNext')}
      </Button>
    </div>
  );
}