import { useState } from 'react';
import { BellOff, ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { ruleCondition, ruleScope } from '@/lib/alerts';

const VISIBLE = 8;

export default function AlertRuleCard({ rule, items, onEdit, onDelete, onToggle }) {
  const [open, setOpen] = useState(false);
  const count = items.length;

  return (
    <section className={`overflow-hidden rounded-xl border bg-card ${count ? 'border-warn/40' : 'border-border'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{rule.name}</h2>
            {rule.active === false && (
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                paused
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ruleCondition(rule)} · {ruleScope(rule)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`numeric rounded-md px-2 py-1 text-xs font-semibold ${
              count ? 'bg-warn/15 text-warn' : 'bg-secondary text-muted-foreground'
            }`}
          >
            {count}
          </span>
          <button
            type="button"
            onClick={() => onToggle(rule)}
            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {rule.active === false ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            onClick={() => onEdit(rule)}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
            aria-label={`Edit ${rule.name}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(rule)}
            className="rounded-md p-1.5 text-muted-foreground hover:text-destructive"
            aria-label={`Delete ${rule.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {count === 0 ? (
        <p className="border-t border-border bg-secondary/30 px-4 py-3 text-xs text-muted-foreground sm:px-5">
          <BellOff className="mr-1 inline h-3 w-3" />
          Nothing to flag right now — this alert is quiet.
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="flex w-full items-center gap-1.5 border-t border-border px-4 py-2 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground sm:px-5"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {open ? 'Hide' : 'Show'} the {count} flagged {count === 1 ? 'product' : 'products'}
          </button>
          {open && (
            <div className="divide-y divide-border border-t border-border">
              {items.slice(0, VISIBLE).map((item) => (
                <div key={item.key} className="px-4 py-2 sm:px-5">
                  <p className={`truncate text-sm ${item.tone === 'warn' ? 'text-warn' : ''}`}>
                    {item.title}
                  </p>
                  <p className="numeric text-[11px] text-muted-foreground">{item.detail}</p>
                </div>
              ))}
              {count > VISIBLE && (
                <p className="px-4 py-2 text-[11px] text-muted-foreground sm:px-5">
                  and {count - VISIBLE} more — download the alert list from the report below.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}