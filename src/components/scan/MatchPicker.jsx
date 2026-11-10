import { RotateCcw, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Shown when one scanned code matches several products, such as ISBN copies. */
export default function MatchPicker({ matches, onSelect, onDismiss }) {
  return (
    <div className="space-y-3 p-4 sm:p-5">
      <div className="flex items-start gap-2">
        <ScanLine className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-medium">{matches.length} products match this code</p>
          <p className="text-xs text-muted-foreground">
            Choose the exact copy you are working with. Nothing changes until you record an action.
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
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Scan next
      </Button>
    </div>
  );
}