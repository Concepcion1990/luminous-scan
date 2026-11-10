import { ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Desktop-only status strip for a handheld reader attached to the computer. */
export default function ScannerListener({ armed, lastCode, onFocusInput }) {
  return (
    <div className="hidden items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 lg:flex">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="relative flex h-2 w-2 shrink-0">
          <span
            className={`h-2 w-2 rounded-full ${armed ? 'bg-ok' : 'bg-muted-foreground/40'}`}
          />
        </span>
        <ScanLine className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-xs font-medium">Handheld scanner ready</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {armed
              ? 'Reading a code…'
              : 'Scan anywhere on this page — the reader types the code and sends Enter.'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {lastCode && (
          <span className="numeric font-mono text-[11px] text-muted-foreground" title="Last code read">
            last {lastCode}
          </span>
        )}
        <Button variant="outline" size="sm" onClick={onFocusInput}>
          Focus box
        </Button>
      </div>
    </div>
  );
}