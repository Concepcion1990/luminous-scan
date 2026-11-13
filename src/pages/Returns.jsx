import { useEffect, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, Plus, Undo2 } from 'lucide-react';
import ReturnCard from '@/components/returns/ReturnCard';
import ReturnFormDialog from '@/components/returns/ReturnFormDialog';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { t } from '@/lib/i18n';
import {
  approveReturn,
  completeReturn,
  deleteReturn,
  rejectReturn,
  RETURN_FILTERS,
  statusQuery,
} from '@/lib/returns';

export default function Returns() {
  const { user, profile, activeId } = useBusiness();
  const currency = profile?.currency || 'USD';
  const [records, setRecords] = useState([]);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    (async () => {
      const [orderPage, prodPage, locPage] = await Promise.all([
        base44.entities.Order.filter(scoped({}, activeId), { sort: '-created_date', limit: 200 }),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
      ]);
      setOrders(orderPage.items ?? []);
      setProducts(prodPage.items ?? []);
      setLocations(locPage.items ?? []);
    })();
  }, [activeId, reload]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const status = statusQuery(filter);
      const query = status === 'all' ? {} : { status };
      const page = await base44.entities.Return.filter(scoped(query, activeId), {
        sort: '-created_date',
        limit: 200,
      });
      setRecords(page.items ?? []);
      setLoading(false);
    })();
  }, [filter, reload, activeId]);

  const run = async (record, fn) => {
    setBusyId(record.id);
    setFlash(null);
    try {
      const message = await fn();
      setFlash({ ok: true, text: message || t('returns.updated', { number: record.number }) });
      setReload((n) => n + 1);
    } catch (e) {
      setFlash({ ok: false, text: e.message || t('returns.failed') });
    } finally {
      setBusyId('');
    }
  };

  const action = (record, key) => {
    if (key === 'approve') {
      return run(record, async () => {
        await approveReturn(record, user);
        return t('returns.approved', { number: record.number });
      });
    }
    if (key === 'reject') {
      return run(record, async () => {
        await rejectReturn(record);
        return t('returns.rejected', { number: record.number });
      });
    }
    if (key === 'complete') {
      return run(record, async () => {
        const linkedOrder = orders.find((o) => o.id === record.order_id) || null;
        const result = await completeReturn({ ret: record, products, user, linkedOrder });
        const bits = [];
        if (result.restocked)
          bits.push(
            t('returns.restockedUnits', {
              count: result.restocked,
              s: result.restocked === 1 ? '' : 's',
            })
          );
        if (result.replaced)
          bits.push(
            t('returns.replacementUnits', {
              count: result.replaced,
              s: result.replaced === 1 ? '' : 's',
            })
          );
        return t('returns.completed', { number: record.number, bits: bits.join(', ') });
      });
    }
    if (key === 'delete') {
      if (!window.confirm(t('returns.deleteConfirm', { number: record.number }))) return null;
      return run(record, async () => {
        await deleteReturn(record);
        return t('returns.deleted', { number: record.number });
      });
    }
    return null;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t('returns.eyebrow')}</p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('returns.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('returns.subtitle')}
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setEditOpen(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> {t('returns.logReturn')}
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

      <div className="flex flex-wrap gap-1.5">
        {RETURN_FILTERS.map((f) => (
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

      {loading && <p className="text-sm text-muted-foreground">{t('returns.loading')}</p>}

      {!loading && !records.length && (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <Undo2 className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">{t('returns.emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('returns.emptyHint')}</p>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {records.map((record) => (
          <ReturnCard
            key={record.id}
            record={record}
            currency={currency}
            busy={busyId === record.id}
            onEdit={() => {
              setEditing(record);
              setEditOpen(true);
            }}
            onAction={(key) => action(record, key)}
          />
        ))}
      </div>

      <ReturnFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        record={editing}
        orders={orders}
        products={products}
        locations={locations}
        currency={currency}
        onSaved={(text) => {
          setFlash({ ok: true, text });
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
}