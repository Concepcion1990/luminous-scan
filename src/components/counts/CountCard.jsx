import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { countSummary, COUNT_STATUS } from '@/lib/counts';

const PILL = {
  muted: 'bg-muted text-muted-foreground',
  info: 'bg-secondary text-foreground',
  warn: 'bg-warn/15 text-warn',
  ok: 'bg-ok/12 text-ok',
};

export default function CountCard({ session, expanded, onToggle, onCancel, onDelete, busy, children }) {
  const status = COUNT_STATUS[session.status] || COUNT_STATUS.open;
  const summary = countSummary(session.lines || []);

  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-sm font-semibold">{session.number}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL[status.tone]}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-1 truncate text-sm">{session.scope_note || session.location_name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[
              session.started_by ? `Started by ${session.started_by}` : '',
              session.started_at ? new Date(session.started_at).toLocaleDateString() : '',
              session.notes,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>
            <span className="numeric text-foreground">{summary.counted}</span>/{summary.total} counted
          </p>
          <p>
            <span className="numeric text-foreground">{summary.differing}</span> differences
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" variant={expanded ? 'secondary' : 'outline'} onClick={onToggle}>
          {expanded ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
          {expanded ? 'Hide sheet' : 'Open sheet'}
        </Button>
        {['open', 'review'].includes(session.status) && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel session
          </Button>
        )}
        {session.status !== 'applied' && (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            disabled={busy}
            onClick={onDelete}
            aria-label={`Delete ${session.number}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {expanded && children}
    </div>
  );
}