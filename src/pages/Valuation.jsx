import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleDollarSign, Download, FileSpreadsheet, Loader2, Lock, TriangleAlert } from 'lucide-react';
import { t } from '@/lib/i18n';
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
        title: t('valuation.exported'),
        description: t(truncated ? 'valuation.exportedRowsTruncated' : 'valuation.exportedRows', {
          count,
          s: count === 1 ? '' : 's',
          filename,
        }),
      });
    } catch {
      toast({
        title: t('valuation.exportFailed'),
        description: t('valuation.exportFailedDesc'),
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
            {t('valuation.eyebrow', { name: profile.name })}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('valuation.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('valuation.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => runExport('xlsx')} disabled={Boolean(exporting) || !activeId}>
            {exporting === 'xlsx' ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            )}
            {exporting === 'xlsx' ? t('valuation.buildingFile') : t('valuation.downloadExcel')}
          </Button>
          <Button variant="outline" onClick={() => runExport('csv')} disabled={Boolean(exporting) || !activeId}>
            {exporting === 'csv' ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            {exporting === 'csv' ? t('valuation.buildingFile') : t('valuation.downloadCsv')}
          </Button>
        </div>
      </div>

      {!entitlementLoading && !can('valuation') && (
        <div className="mx-auto max-w-xl py-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="mt-4 text-xl font-semibold">{t('valuation.lockedTitle')}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {t('valuation.lockedDesc')}
          </p>
          <Button asChild className="mt-5">
            <Link to="/upgrade">{t('valuation.seeBusiness')}</Link>
          </Button>
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">{t('valuation.workingOut')}</p>}

      {!loading && data?.productsTruncated && !entitlementLoading && can('valuation') && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
          {t('valuation.truncationNote', {
            notice: productTruncationNotice(data.products.length, data.productTotal),
          })}
        </p>
      )}

      {!loading && view && !entitlementLoading && can('valuation') && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={view.costComplete ? t('valuation.valueAtCost') : t('valuation.knownValueAtCost')}
              value={money(view.totals.cost)}
              hint={
                view.costComplete
                  ? t('valuation.costCompleteHint', { units: view.totals.units, skus: view.stockedSkus })
                  : t('valuation.withoutCost', {
                      count: view.noCost.length,
                      s: view.noCost.length === 1 ? '' : 's',
                    })
              }
            />
            <StatCard
              label={view.retailComplete ? t('valuation.valueAtRetail') : t('valuation.knownValueAtRetail')}
              value={money(view.totals.retail)}
              hint={
                view.retailComplete
                  ? t('valuation.retailCompleteHint')
                  : t('valuation.withoutPrice', {
                      count: view.noPrice.length,
                      s: view.noPrice.length === 1 ? '' : 's',
                    })
              }
            />
            <StatCard
              label={t('valuation.potentialMargin')}
              value={view.complete ? money(view.totals.retail - view.totals.cost) : '—'}
              tone={view.complete ? 'ok' : 'default'}
              hint={
                view.complete ? t('valuation.marginHint') : t('valuation.marginIncompleteHint')
              }
            />
            <StatCard
              label={t('valuation.heldForOrders')}
              value={view.totals.reserved}
              unit="units"
              hint={t('valuation.availableToSell', {
                count: Math.max(view.totals.units - view.totals.reserved, 0),
              })}
            />
          </div>

          {!view.complete && (
            <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <div>
                <p className="font-medium">{t('valuation.incompleteTitle')}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('valuation.incompleteDesc')}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {view.noCost.length > 0 && (
                    <>
                      {view.noCost.length > 4
                        ? t('valuation.noCostMore', {
                            names: view.noCost.slice(0, 4).map((e) => e.product.name).join(', '),
                            count: view.noCost.length - 4,
                          })
                        : t('valuation.noCost', {
                            names: view.noCost.slice(0, 4).map((e) => e.product.name).join(', '),
                          })}{' '}
                    </>
                  )}
                  {view.noPrice.length > 0 && (
                    <>
                      {view.noPrice.length > 4
                        ? t('valuation.noPriceMore', {
                            names: view.noPrice.slice(0, 4).map((e) => e.product.name).join(', '),
                            count: view.noPrice.length - 4,
                          })
                        : t('valuation.noPrice', {
                            names: view.noPrice.slice(0, 4).map((e) => e.product.name).join(', '),
                          })}
                    </>
                  )}{' '}
                  {view.totals.costUnknown + view.totals.retailUnknown > 0 && (
                    <>
                      {view.totals.costUnknown > 0 && view.totals.retailUnknown > 0
                        ? t('valuation.unitsNoCostAndPrice', {
                            costUnits: view.totals.costUnknown,
                            cs: view.totals.costUnknown === 1 ? '' : 's',
                            priceUnits: view.totals.retailUnknown,
                            ps: view.totals.retailUnknown === 1 ? '' : 's',
                          })
                        : view.totals.costUnknown > 0
                          ? t('valuation.unitsNoCostOnly', {
                              count: view.totals.costUnknown,
                              s: view.totals.costUnknown === 1 ? '' : 's',
                            })
                          : t('valuation.unitsNoPriceOnly', {
                              count: view.totals.retailUnknown,
                              s: view.totals.retailUnknown === 1 ? '' : 's',
                            })}
                    </>
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={t('valuation.byLocation')} hint={t('valuation.byLocationHint')}>
              {view.perLocation.length === 0 ? (
                <p className="px-4 py-10 text-center text-xs text-muted-foreground">
                  {t('valuation.noStockYet')}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {view.perLocation.map((row) => (
                    <div key={row.location.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{row.location.name}</p>
                        <p className="numeric text-[11px] text-muted-foreground">
                          {t('valuation.locationRow', { units: row.units, retail: money(row.retail) })}
                        </p>
                      </div>
                      <p className="numeric shrink-0 text-sm font-semibold">{money(row.cost)}</p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel
              title={t('valuation.everyProduct')}
              hint={t('valuation.everyProductHint', {
                count: view.lines.length,
                s: view.lines.length === 1 ? '' : 's',
              })}
            >
              {view.lines.length === 0 ? (
                <p className="px-4 py-10 text-center text-xs text-muted-foreground">
                  {t('valuation.nothingStocked')}
                </p>
              ) : (
                <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
                  {view.lines.map((entry) => (
                    <div key={entry.product.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{entry.product.name}</p>
                        <p className="numeric text-[11px] text-muted-foreground">
                          {entry.costKnown
                            ? t('valuation.productCost', {
                                sku: entry.product.sku,
                                units: entry.units,
                                cost: money(entry.product.cost),
                              })
                            : t('valuation.productNoCost', {
                                sku: entry.product.sku,
                                units: entry.units,
                              })}
                          {entry.held > 0 ? t('valuation.productHeld', { held: entry.held }) : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="numeric text-sm font-semibold">
                          {entry.costKnown ? money(entry.cost) : '—'}
                        </p>
                        <p className="numeric text-[10px] text-muted-foreground">
                          {entry.priceKnown
                            ? t('valuation.retailValue', { value: money(entry.retail) })
                            : t('valuation.noRetailPrice')}
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
            <p>{t('valuation.footnote')}</p>
          </div>
        </>
      )}
    </div>
  );
}