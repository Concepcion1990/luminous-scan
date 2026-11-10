import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, ClipboardCheck, Plus } from 'lucide-react';
import CountCard from '@/components/counts/CountCard';
import CountSessionDialog from '@/components/counts/CountSessionDialog';
import CountSheet from '@/components/counts/CountSheet';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { productTruncationNotice } from '@/lib/inventory';
import { cancelCount, COUNT_FILTERS, deleteCount, statusQuery } from '@/lib/counts';

export default function Counts() {
  const { user, activeId } = useBusiness();
  const [sessions, setSessions] = useState([]);
  const [products, setProducts] = useState([]);
  const [productTotal, setProductTotal] = useState(0);
  const [locations, setLocations] = useState([]);
  const [levels, setLevels] = useState([]);
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [expanded, setExpanded] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    (async () => {
      const [prodPage, locPage, levelPage, total] = await Promise.all([
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
        base44.entities.StockLevel.filter(scoped({}, activeId), { limit: 2000 }),
        base44.entities.Product.count(scoped({}, activeId)),
      ]);
      setProducts(prodPage.items ?? []);
      setProductTotal(total);
      setLocations(locPage.items ?? []);
      setLevels(levelPage.items ?? []);
    })();
  }, [activeId, reload]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const status = statusQuery(filter);
      const query = status === 'all' ? {} : { status };
      const page = await base44.entities.CountSession.filter(scoped(query, activeId), {
        sort: '-created_date',
        limit: 100,
      });
      setSessions(page.items ?? []);
      setLoading(false);
    })();
  }, [filter, reload, activeId]);

  const run = async (session, fn) => {
    try {
      const message = await fn();
      setFlash({ ok: true, text: message });
      setReload((n) => n + 1);
    } catch (e) {
      setFlash({ ok: false, text: e.message || 'That did not work.' });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Audits</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Stock counts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Count a shelf, review the differences, then approve before stock changes.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Start a count
        </Button>
      </div>

      {flash && (
        <div
          className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
            flash.ok ? 'border-ok/30 bg-ok/8' : 'border-destructive/30 bg-destructive/8'
          }`}
        >
          {flash.ok && <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />}
          <span>{flash.text}</span>
        </div>
      )}

      {productTruncationNotice(products.length, productTotal) && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          {productTruncationNotice(products.length, productTotal)} — the count picker lists products
          alphabetically, so later ones are not offered here.
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {COUNT_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading count sessions…</p>}

      {!loading && !sessions.length && (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <ClipboardCheck className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No count sessions here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Start one to check a shelf against the system, or pick another filter.
          </p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {sessions.map((session) => (
          <CountCard
            key={session.id}
            session={session}
            expanded={expanded === session.id}
            onToggle={() => setExpanded(expanded === session.id ? '' : session.id)}
            onCancel={() =>
              run(session, async () => {
                await cancelCount(session);
                return `${session.number}: cancelled — nothing was counted into stock.`;
              })
            }
            onDelete={() => {
              if (!window.confirm(`Delete ${session.number}?`)) return;
              run(session, async () => {
                await deleteCount(session);
                return `${session.number}: deleted.`;
              });
            }}
          >
            <CountSheet
              session={session}
              products={products}
              levels={levels}
              user={user}
              onChanged={(text) => {
                setFlash({ ok: true, text });
                setReload((n) => n + 1);
              }}
            />
          </CountCard>
        ))}
      </div>

      <CountSessionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        products={products}
        locations={locations}
        levels={levels}
        onCreated={(text) => {
          setFlash({ ok: true, text });
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
}