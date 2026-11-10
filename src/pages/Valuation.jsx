import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign, Download, FileSpreadsheet, Loader2, Lock, TriangleAlert } from 'lucide-react';
import StatCard from '@/components/StatCard';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { EXPORTS, exportDataset } from '@/lib/exportData';
import { formatMoney, loadInventory, productTruncationNotice } from '@/lib/inventory';
import { useBusiness } from '@/hooks/useBusiness';
import useEntitlements from '@/hooks/useEntitlements';

function Panel({ title, hint, children }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export default function Valuation() {
  const { profile, activeId } = useBusiness();
  const { toast } = useToast();
  // In-page entitlement guard: the route is PlanGate-locked too, but this
  // page must be safe on its own if it is ever rendered without the gate.
  const { can, isLoading: entitlementLoading } = useEntitlements();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState('');

  const runExport = async (format = 'csv') => {
    if (!activeId || exporting) return;
    setExporting(format);
    try {
      const dataset = EXPORTS.find((entry) => entry.id === 'valuation');
      const { count, filename, truncated } = await exportDataset(
        dataset,
        {
          businessId: activeId,
          businessName: profile.name,
          profile,
        },
        format
      );
      toast({
        title: 'Valuation exported',
        description: `${count} row${count === 1 ? '' : 's'} saved as ${filename}${truncated ? ' — stopped at 20,000 rows' : ''}`,
      });
    } catch {
      toast({
        title: 'Export failed',
        description: 'Could not build the file. Try again.',
        variant: 'destructive',
      });
    } finally {
      setExporting('');
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setData(await loadInventory(activeId || ''));
      setLoading(false);
    })();
  }, [activeId]);

  const money = (value) => formatMoney(value || 0, profile.currency, 2);

  const view = useMemo(() => {
    if (!data) return null;
    const productById = new Map(data.products.map((p) => [p.id, p]));

    // A missing cost is not a cost of zero, and a missing price is not a price of
    // zero — only figures that were actually entered are added up.
    const known = (value) => typeof value === 'number' && Number.isFinite(value);

    const totals = data.levels.reduce(
      (acc, level) => {
        const product = productById.get(level.product_id);
        const qty = level.quantity || 0;
        acc.units += qty;
        acc.reserved += level.reserved || 0;
        if (qty > 0 && (!product || !known(product.cost))) acc.costUnknown += qty;
        if (qty > 0 && (!product || !known(product.price))) acc.retailUnknown += qty;
        if (product && known(product.cost)) acc.cost += qty * product.cost;
        if (product && known(product.price)) acc.retail += qty * product.price;
        return acc;
      },
      { units: 0, reserved: 0, cost: 0, retail: 0, costUnknown: 0, retailUnknown: 0 }
    );

    const perLocation = data.locations
      .map((location) => {
        const own = data.levels.filter((level) => level.location_id === location.id);
        const row = own.reduce(
          (acc, level) => {
            const product = productById.get(level.product_id);
            const qty = level.quantity || 0;
            acc.units += qty;
            if (product && known(product.cost)) acc.cost += qty * product.cost;
            if (product && known(product.price)) acc.retail += qty * product.price;
            return acc;
          },
          { units: 0, cost: 0, retail: 0 }
        );
        return { location, ...row };
      })
      .filter((row) => row.units > 0)
      .sort((a, b) => b.cost - a.cost);

    const byProduct = new Map();
    data.levels.forEach((level) => {
      const product = productById.get(level.product_id);
      if (!product) return;
      const entry = byProduct.get(product.id) || {
        product,
        units: 0,
        held: 0,
        cost: 0,
        retail: 0,
        costKnown: known(product.cost),
        priceKnown: known(product.price),
      };
      const qty = level.quantity || 0;
      entry.units += qty;
      entry.held += level.reserved || 0;
      entry.cost += qty * (entry.costKnown ? product.cost : 0);
      entry.retail += qty * (entry.priceKnown ? product.price : 0);
      byProduct.set(product.id, entry);
    });

    const stocked = [...byProduct.values()].filter((entry) => entry.units > 0);
    const lines = [...stocked].sort((a, b) => b.cost - a.cost);
    const noCost = stocked.filter((entry) => !entry.costKnown);
    const noPrice = stocked.filter((entry) => !entry.priceKnown);
    const costComplete = noCost.length === 0;
    const retailComplete = noPrice.length === 0;

    return {
      totals,
      perLocation,
      lines,
      stockedSkus: stocked.length,
      noCost,
      noPrice,
      costComplete,
      retailComplete,
      complete: costComplete && retailComplete,
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {profile.name} · Valuation
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">Stock value</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            What the shelves are worth at cost, and what they would bring in at retail. Figures come from each
            product's unit cost and retail price times the quantity on hand.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => runExport('xlsx')} disabled={Boolean(exporting) || !activeId}>
            {exporting === 'xlsx' ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            )}
            {exporting === 'xlsx' ? 'Building file…' : 'Download Excel'}
          </Button>
          <Button variant="outline" onClick={() => runExport('csv')} disabled={Boolean(exporting) || !activeId}>
            {exporting === 'csv' ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            {exporting === 'csv' ? 'Building file…' : 'Download CSV'}
          </Button>
        </div>
      </div>

      {!entitlementLoading && !can('valuation') && (
        <div className="mx-auto max-w-xl py-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">Stock valuation is a Business feature</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Your workspace is on the Essentials plan. Business adds stock valuation, unlimited
            products and staff, suppliers, purchasing, exports and bundles.
          </p>
          <Button asChild className="mt-5">
            <Link to="/upgrade">See what Business includes</Link>
          </Button>
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Working out the numbers…</p>}

      {!loading && data?.productsTruncated && !entitlementLoading && can('valuation') && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          {productTruncationNotice(data.products.length, data.productTotal)} — these figures only
          cover the first 500 products alphabetically.
        </p>
      )}

      {!loading && view && !entitlementLoading && can('valuation') && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={view.costComplete ? 'Value at cost' : 'Known value at cost'}
              value={money(view.totals.cost)}
              hint={
                view.costComplete
                  ? `${view.totals.units} units · ${view.stockedSkus} SKUs`
                  : `${view.noCost.length} stocked product${view.noCost.length === 1 ? '' : 's'} without a cost`
              }
            />
            <StatCard
              label={view.retailComplete ? 'Value at retail' : 'Known value at retail'}
              value={money(view.totals.retail)}
              hint={
                view.retailComplete
                  ? 'If everything sold at full price'
                  : `${view.noPrice.length} stocked product${view.noPrice.length === 1 ? '' : 's'} without a price`
              }
            />
            <StatCard
              label="Potential margin"
              value={view.complete ? money(view.totals.retail - view.totals.cost) : '—'}
              tone={view.complete ? 'ok' : 'default'}
              hint={
                view.complete
                  ? 'Retail minus cost, before fees and shipping'
                  : 'Needs a cost and a price on every stocked product'
              }
            />
            <StatCard
              label="Held for orders"
              value={view.totals.reserved}
              unit="units"
              hint={`${Math.max(view.totals.units - view.totals.reserved, 0)} units available to sell`}
            />
          </div>

          {!view.complete && (
            <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <div>
                <p className="font-medium">Incomplete valuation</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Some stocked products have no cost or no selling price recorded, so they are left out of the
                  figures rather than counted as free. A recorded cost of zero is real and is included.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {view.noCost.length > 0 && (
                    <>
                      No cost: {view.noCost.slice(0, 4).map((e) => e.product.name).join(', ')}
                      {view.noCost.length > 4 ? ` +${view.noCost.length - 4} more` : ''}.{' '}
                    </>
                  )}
                  {view.noPrice.length > 0 && (
                    <>
                      No price: {view.noPrice.slice(0, 4).map((e) => e.product.name).join(', ')}
                      {view.noPrice.length > 4 ? ` +${view.noPrice.length - 4} more` : ''}.
                    </>
                  )}{' '}
                  {view.totals.costUnknown + view.totals.retailUnknown > 0 && (
                    <>
                      {view.totals.costUnknown > 0 &&
                        `${view.totals.costUnknown} unit${view.totals.costUnknown === 1 ? '' : 's'} have no cost`}
                      {view.totals.costUnknown > 0 && view.totals.retailUnknown > 0 && ', '}
                      {view.totals.retailUnknown > 0 &&
                        `${view.totals.retailUnknown} unit${view.totals.retailUnknown === 1 ? '' : 's'} have no price`}
                      {' — those units sit outside these totals.'}
                    </>
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Value by location" hint="Each place with stock on hand.">
              {view.perLocation.length === 0 ? (
                <p className="px-4 py-10 text-center text-xs text-muted-foreground">
                  No stock is recorded yet.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {view.perLocation.map((row) => (
                    <div key={row.location.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{row.location.name}</p>
                        <p className="numeric text-[11px] text-muted-foreground">
                          {row.units} units · {money(row.retail)} retail
                        </p>
                      </div>
                      <p className="numeric shrink-0 text-sm font-semibold">{money(row.cost)}</p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              title="Every stocked product"
              hint={`${view.lines.length} line${view.lines.length === 1 ? '' : 's'}, ranked by cost value.`}
            >
              {view.lines.length === 0 ? (
                <p className="px-4 py-10 text-center text-xs text-muted-foreground">
                  Nothing stocked yet.
                </p>
              ) : (
                <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
                  {view.lines.map((entry) => (
                    <div key={entry.product.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{entry.product.name}</p>
                        <p className="numeric text-[11px] text-muted-foreground">
                          {entry.product.sku} · {entry.units}{' '}
                          {entry.costKnown ? `at ${money(entry.product.cost)} cost` : 'with no cost recorded'}
                          {entry.held > 0 ? ` · ${entry.held} held` : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="numeric text-sm font-semibold">
                          {entry.costKnown ? money(entry.cost) : '—'}
                        </p>
                        <p className="numeric text-[10px] text-muted-foreground">
                          {entry.priceKnown ? `${money(entry.retail)} retail` : 'no retail price'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
            <CircleDollarSign className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              Cost value uses each product's current unit cost, so receiving at a new price re-values the whole
              shelf. Held units are still counted here — they are on hand, just promised to an order. Missing
              money is never treated as zero; leave a field blank until the figure is known.
            </p>
          </div>
        </>
      )}
    </div>
  );
}