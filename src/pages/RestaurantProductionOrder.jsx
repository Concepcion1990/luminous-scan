import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ClipboardList, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ProductionOrderDoc from '@/components/print/ProductionOrderDoc';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';
import { useBusiness } from '@/hooks/useBusiness';
import { resolveDocStyle } from '@/lib/docStyle';
import { formatMoney } from '@/lib/inventory';
import {
  fetchProductionSources,
  makeProductionDrafts,
  planProductionOrder,
} from '@/lib/productionOrder';
import { t } from '@/lib/i18n';

/**
 * Order by production (plan release 378, Nov 26, 2026):
 * Business-only, Restaurant Corner, Stock & Ordering
 * shelf. A production plan — a batch run (a recipe, a
 * number of makes) or a booked catering event — turns
 * into an ingredient order draft by itself: needed minus
 * on-hand, rounded to pack sizes, grouped by supplier in
 * the order guide's shape. Making the drafts writes one
 * DRAFT purchase order per supplier into Purchasing for
 * the owner to confirm. The app never sends an order on
 * its own.
 */
export default function RestaurantProductionOrder() {
  const { activeId, record, profile } = useBusiness();
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('batch');
  const [recipeId, setRecipeId] = useState('');
  const [makes, setMakes] = useState('1');
  const [eventId, setEventId] = useState('');
  const [plan, setPlan] = useState(null);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    if (!activeId) return;
    const sources = await fetchProductionSources(activeId);
    setData(sources);
    if (!recipeId && sources.recipes?.length) setRecipeId(sources.recipes[0].id);
    if (!eventId && sources.events?.length) setEventId(sources.events[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const canOrder = Boolean(data?.canOrder);
  const recipes = data?.recipes || [];
  const events = data?.events || [];
  const money = (value) => formatMoney(value, record?.currency, 2);
  const source = kind === 'batch'
    ? { kind: 'batch', recipe_id: recipeId, makes: makes === '' ? 0 : Number(makes) }
    : { kind: 'event', event_id: eventId };

  const workOut = async () => {
    setBusy(true);
    setError('');
    setFlash('');
    try {
      const result = await planProductionOrder(activeId, source);
      setPlan(result.plan);
    } catch { setError(t('productionOrder.draftFailed')); setPlan(null); } finally { setBusy(false); }
  };

  const makeDrafts = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await makeProductionDrafts(activeId, source);
      setPlan(result.plan);
      const numbers = (result.drafts || []).map((draft) => draft.number).join(', ');
      setFlash(t('productionOrder.draftsMade', { numbers }));
    } catch { setError(t('productionOrder.draftFailed')); } finally { setBusy(false); }
  };

  const printPlan = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 50);
  };

  return (
    <div className="space-y-6">
      <div className="no-print">
        <RestaurantCrumbs route="/restaurant/production-order" />
      </div>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 flex items-center gap-2 text-2xl font-semibold sm:text-[28px]">
            <ClipboardList className="h-6 w-6" /> {t('productionOrder.title')}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('productionOrder.subtitle')}</p>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t('productionOrder.draftNote')}</p>
        </div>
        {plan ? (
          <Button variant="outline" onClick={printPlan}>
            <Printer className="mr-1.5 h-4 w-4" /> {t('productionOrder.printButton')}
          </Button>
        ) : null}
      </div>

      {flash ? (
        <p className="no-print flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      ) : null}
      {error ? <p className="no-print rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}

      {!data ? (
        <p className="no-print text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : recipes.length === 0 && events.length === 0 ? (
        <div className="no-print rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('productionOrder.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('productionOrder.emptyBody')}</p>
        </div>
      ) : (
        <section className="no-print space-y-3 rounded-xl border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('productionOrder.sourceLabel')}</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={kind}
                onChange={(e) => { setKind(e.target.value); setPlan(null); }}
              >
                <option value="batch">{t('productionOrder.sourceBatch')}</option>
                <option value="event">{t('productionOrder.sourceEvent')}</option>
              </select>
            </div>
            {kind === 'batch' ? (
              <>
                <div className="space-y-1">
                  <Label>{t('productionOrder.recipeLabel')}</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={recipeId}
                    onChange={(e) => setRecipeId(e.target.value)}
                  >
                    {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>{t('productionOrder.makesLabel')}</Label>
                  <Input type="number" min="1" step="1" value={makes} onChange={(e) => setMakes(e.target.value)} />
                </div>
              </>
            ) : (
              <div className="space-y-1">
                <Label>{t('productionOrder.eventLabel')}</Label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                >
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {t('productionOrder.eventSummary', { name: event.name, date: event.event_date })}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <Button onClick={workOut} disabled={busy}>{t('productionOrder.planButton')}</Button>
        </section>
      )}

      {plan ? (
        <section className="no-print space-y-3">
          <h2 className="text-base font-semibold">
            {plan.source?.kind === 'event'
              ? t('productionOrder.eventSummary', { name: plan.source?.name || '', date: plan.source?.event_date || '' })
              : t('productionOrder.batchSummary', { name: plan.source?.name || '', makes: plan.source?.makes || 0 })}
          </h2>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-3 py-2 font-medium">{t('productionOrder.colIngredient')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('productionOrder.colNeeded')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('productionOrder.colOnHand')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('productionOrder.colOrder')}</th>
                  <th className="px-3 py-2 font-medium">{t('productionOrder.colSupplier')}</th>
                </tr>
              </thead>
              <tbody>
                {(plan.lines || []).map((line) => (
                  <tr key={line.product_id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2">{line.product_name}</td>
                    <td className="px-3 py-2 text-right">{line.needed} {line.unit}</td>
                    <td className="px-3 py-2 text-right">{line.onHand}</td>
                    <td className="px-3 py-2 text-right font-medium">{line.orderQty > 0 ? line.orderQty : '—'}</td>
                    <td className="px-3 py-2">{line.supplier_name || t('guide.noSupplier')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.covered ? (
            <p className="text-sm text-muted-foreground">{t('productionOrder.coveredNote')}</p>
          ) : canOrder ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={makeDrafts} disabled={busy}>{t('productionOrder.makeDraftsButton')}</Button>
              <p className="text-xs text-muted-foreground">
                {(plan.groups || []).map((group) => `${group.supplier_name || t('guide.noSupplier')}: ${money(group.total)}`).join(' · ')}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {printing && plan ? (
        <div className="print-area hidden print:block">
          <ProductionOrderDoc plan={plan} business={record} docStyle={docStyle} />
        </div>
      ) : null}
    </div>
  );
}
