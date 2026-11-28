import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, MapPin, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import RollupDoc from '@/components/print/RollupDoc';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';
import { useBusiness } from '@/hooks/useBusiness';
import { resolveDocStyle } from '@/lib/docStyle';
import { formatMoney } from '@/lib/inventory';
import { fetchLocationsRollup, pushPrices, pushRecipe } from '@/lib/locationsRollup';
import { t } from '@/lib/i18n';

/**
 * All locations on one page (plan release 380, Nov 26,
 * 2026): Business-only, Restaurant Corner, Locations shelf
 * — a shelf that only exists for owners with 2+ businesses.
 *
 * The rollup is reporting over data that already exists:
 * food cost %, stock value, waste this week and what's
 * low, side by side across the owner's locations, so the
 * weak spot shows itself. Beside it, the cross-location
 * push (the Part 7 rider): copy a recipe, or this
 * location's prices and costs, to the owner's other
 * locations — matched by SKU first, then by name, with
 * anything unmatched named in the result, never silently
 * dropped. Owner-only throughout.
 */
export default function RestaurantLocationsRollup() {
  const { activeId, record, profile } = useBusiness();
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);
  const money = (value) => formatMoney(value, record?.currency, 2);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [recipeId, setRecipeId] = useState('');
  const [targets, setTargets] = useState({});
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    if (!activeId) return;
    try {
      const result = await fetchLocationsRollup(activeId);
      setData(result);
      if (!recipeId && result.source?.recipes?.length) setRecipeId(result.source.recipes[0].id);
    } catch { setLoadError(t('locationsRollup.loadFailed')); }
  }, [activeId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const rows = data?.businesses || [];
  const others = rows.filter((row) => row.business_id !== activeId);
  const recipes = data?.source?.recipes || [];
  const pickedTargets = others.filter((row) => targets[row.business_id]).map((row) => row.business_id);
  const totals = rows.reduce(
    (acc, row) => ({
      stockValue: acc.stockValue + (Number(row.stockValue) || 0),
      wasteValue: acc.wasteValue + (Number(row.waste?.value) || 0),
      lowCount: acc.lowCount + (Number(row.lowCount) || 0),
    }),
    { stockValue: 0, wasteValue: 0, lowCount: 0 },
  );

  const describeResults = (kind, outcome) => {
    const lines = [];
    for (const result of outcome.results || []) {
      if (result.status === 'skipped_plan') {
        lines.push(t('locationsRollup.resultSkippedPlan', { business: result.business_name }));
      } else if (kind === 'recipe') {
        lines.push(t(result.status === 'updated'
          ? 'locationsRollup.resultUpdated'
          : 'locationsRollup.resultCreated', { business: result.business_name }));
        if (!result.dishMatched) {
          lines.push(t('locationsRollup.dishUnmatched', { business: result.business_name }));
        }
        if (result.dropped?.length) {
          lines.push(t('locationsRollup.resultDropped', {
            business: result.business_name,
            names: result.dropped.join(', '),
          }));
        }
      } else {
        lines.push(t('locationsRollup.resultPrices', {
          business: result.business_name,
          updated: result.updated,
          skipped: result.skipped,
        }));
      }
    }
    return lines;
  };

  const runPush = async (kind) => {
    setError('');
    setResults([]);
    if (!pickedTargets.length) { setError(t('locationsRollup.noTargets')); return; }
    if (kind === 'recipe' && !recipeId) { setError(t('locationsRollup.pushFailed')); return; }
    setBusy(true);
    try {
      const outcome = kind === 'recipe'
        ? await pushRecipe(activeId, recipeId, pickedTargets)
        : await pushPrices(activeId, pickedTargets);
      setResults(describeResults(kind, outcome));
    } catch { setError(t('locationsRollup.pushFailed')); } finally { setBusy(false); }
  };

  const printRollup = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 50);
  };

  return (
    <div className="space-y-6">
      <div className="no-print">
        <RestaurantCrumbs route="/restaurant/locations-rollup" />
      </div>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 flex items-center gap-2 text-2xl font-semibold sm:text-[28px]">
            <MapPin className="h-6 w-6" /> {t('locationsRollup.title')}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('locationsRollup.subtitle')}</p>
        </div>
        {rows.length >= 2 ? (
          <Button variant="outline" onClick={printRollup}>
            <Printer className="mr-1.5 h-4 w-4" /> {t('locationsRollup.printButton')}
          </Button>
        ) : null}
      </div>

      {loadError ? <p className="no-print rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{loadError}</p> : null}

      {!data ? (
        loadError ? null : <p className="no-print text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : rows.length < 2 ? (
        <div className="no-print rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <MapPin className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('locationsRollup.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('locationsRollup.emptyBody')}</p>
        </div>
      ) : (
        <>
          <section className="no-print overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 font-medium">{t('locationsRollup.colLocation')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('locationsRollup.colFoodCost')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('locationsRollup.colStockValue')}</th>
                  <th className="px-4 py-3 text-right font-medium">{t('locationsRollup.colWaste')}</th>
                  <th className="px-4 py-3 font-medium">{t('locationsRollup.colLow')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.business_id} className="border-b border-border/60 align-top">
                    <td className="px-4 py-3 font-medium">{row.name}</td>
                    <td className="px-4 py-3 text-right">
                      {row.foodCostPct === null || row.foodCostPct === undefined
                        ? <span className="text-muted-foreground">{t('locationsRollup.foodCostNone')}</span>
                        : `${row.foodCostPct}%`}
                    </td>
                    <td className="px-4 py-3 text-right">{money(row.stockValue)}</td>
                    <td className="px-4 py-3 text-right">{money(row.waste?.value)}</td>
                    <td className="px-4 py-3">
                      {row.lowCount > 0 ? (
                        <>
                          <span className="font-medium">{row.lowCount}</span>
                          <span className="block text-xs text-muted-foreground">
                            {row.low.map((item) => item.name).join(', ')}
                          </span>
                        </>
                      ) : <span className="text-muted-foreground">{t('locationsRollup.lowNone')}</span>}
                    </td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="px-4 py-3">{t('locationsRollup.totalsLabel')}</td>
                  <td className="px-4 py-3 text-right">—</td>
                  <td className="px-4 py-3 text-right">{money(totals.stockValue)}</td>
                  <td className="px-4 py-3 text-right">{money(totals.wasteValue)}</td>
                  <td className="px-4 py-3">{totals.lowCount}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <p className="no-print text-xs text-muted-foreground">{t('locationsRollup.weekNote')}</p>

          <section className="no-print space-y-4 rounded-xl border border-border p-4">
            <div>
              <h2 className="text-base font-semibold">{t('locationsRollup.pushTitle')}</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('locationsRollup.pushBody')}</p>
            </div>
            <div className="space-y-1">
              <Label>{t('locationsRollup.targetsLabel')}</Label>
              <div className="flex flex-wrap gap-3">
                {others.map((row) => (
                  <label key={row.business_id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={Boolean(targets[row.business_id])}
                      onChange={(e) => setTargets((prev) => ({ ...prev, [row.business_id]: e.target.checked }))}
                    />
                    {row.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label>{t('locationsRollup.pushRecipeLabel')}</Label>
                <select
                  className="block rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={recipeId}
                  onChange={(e) => setRecipeId(e.target.value)}
                >
                  {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
                </select>
              </div>
              <Button onClick={() => runPush('recipe')} disabled={busy || !recipes.length}>
                {t('locationsRollup.pushRecipeButton')}
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label>{t('locationsRollup.pushPricesLabel')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('locationsRollup.pushPricesBody', { count: data.source?.pricedProducts || 0 })}
                </p>
              </div>
              <Button variant="outline" onClick={() => runPush('prices')} disabled={busy}>
                {t('locationsRollup.pushPricesButton')}
              </Button>
            </div>
            {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
            {results.length ? (
              <ul className="space-y-1 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
                {results.map((line, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {line}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </>
      )}

      {printing && rows.length >= 2 ? (
        <div className="print-area hidden print:block">
          <RollupDoc rows={rows} business={record} docStyle={docStyle} />
        </div>
      ) : null}
    </div>
  );
}
