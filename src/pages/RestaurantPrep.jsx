import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, NotebookPen, Play, Printer } from 'lucide-react';
import BatchDialog from '@/components/restaurant/BatchDialog';
import PrepSheetDoc from '@/components/print/PrepSheetDoc';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import useStaffAccess from '@/hooks/useStaffAccess';
import { scoped } from '@/lib/scoped';
import { resolveDocStyle } from '@/lib/docStyle';
import { formatDateTime } from '@/lib/dates';
import { listPars, listRecipes } from '@/lib/recipes';
import { prepRows } from '@/lib/restaurantOps';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * Prep (release 361, Nov 23, 2026). Two halves: batch
 * production — run a recipe a number of times and the
 * server produces its prep product and takes the whole
 * recipe off the shelf — and the prep sheet, which reads
 * the pars and says, per dish, how many makes bring it back
 * up to par and what those makes pull. The sheet prints as
 * a Studio document. Running a batch rides the
 * restaurant.build tick.
 */
export default function RestaurantPrep() {
  const { activeId, record, profile } = useBusiness();
  const { can: canStaff } = useStaffAccess();
  const [runs, setRuns] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [pars, setPars] = useState([]);
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [flash, setFlash] = useState(null);
  const [printing, setPrinting] = useState(false);

  const canBuild = canStaff('restaurant.build');
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);

  useEffect(() => {
    (async () => {
      const [runPage, recipeList, parList, productPage, locPage, levelPage] = await Promise.all([
        base44.entities.BatchRun.filter(scoped({}, activeId), { sort: '-created_date', limit: 200 }),
        listRecipes(activeId || ''),
        listPars(activeId || ''),
        base44.entities.Product.filter(scoped({}, activeId), { sort: 'name', limit: 500 }),
        base44.entities.Location.filter(scoped({}, activeId), { sort: 'name', limit: 100 }),
        base44.entities.StockLevel.filter(scoped({}, activeId), { limit: 2000 }),
      ]);
      setRuns(runPage.items ?? []);
      setRecipes(recipeList);
      setPars(parList);
      setProducts(productPage.items ?? []);
      setLocations(locPage.items ?? []);
      setLevels(levelPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  const rows = useMemo(
    () => prepRows(pars, recipes, products, levels),
    [pars, recipes, products, levels]
  );

  const printSheet = () => {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 50);
  };

  return (
    <div className="space-y-6">
      <div className="no-print">
        <RestaurantCrumbs route="/restaurant/prep" />
      </div>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('prep.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('prep.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!rows.length} onClick={printSheet}>
            <Printer className="mr-1.5 h-4 w-4" /> {t('prep.printButton')}
          </Button>
          {canBuild ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Play className="mr-1.5 h-4 w-4" /> {t('batch.runButton')}
            </Button>
          ) : null}
        </div>
      </div>

      {flash && (
        <p className="no-print flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}

      <div className="no-print space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="text-base font-semibold">{t('batch.runsTitle')}</h2>
              {runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('batch.runsEmpty')}</p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left">
                        <th className="px-3 py-2 font-medium">{t('batch.colWhen')}</th>
                        <th className="px-3 py-2 font-medium">{t('batch.colRecipe')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('batch.colMakes')}</th>
                        <th className="px-3 py-2 font-medium">{t('batch.colProduced')}</th>
                        <th className="px-3 py-2 text-right font-medium">{t('batch.colOutput')}</th>
                        <th className="px-3 py-2 font-medium">{t('batch.colLocation')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((run) => (
                        <tr key={run.id} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-2">{run.created_date ? formatDateTime(run.created_date) : ''}</td>
                          <td className="px-3 py-2">{run.recipe_name}</td>
                          <td className="px-3 py-2 text-right">{run.makes}</td>
                          <td className="px-3 py-2">{run.product_name}</td>
                          <td className="px-3 py-2 text-right">{run.output_qty ?? '—'}</td>
                          <td className="px-3 py-2">{run.location_name || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-base font-semibold">{t('prep.sheetTitle')}</h2>
              {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
                  <NotebookPen className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">{t('prep.emptyTitle')}</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('prep.emptyBody')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {rows.map((row) => (
                    <div key={row.recipe.id} className="rounded-xl border border-border p-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-medium">{row.recipe.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('prep.buildLine', { buildTo: row.buildTo, onHand: row.onHand, makes: row.makes })}
                        </p>
                      </div>
                      {row.makes > 0 ? (
                        <ul className="mt-2 grid gap-x-6 gap-y-0.5 text-sm text-muted-foreground sm:grid-cols-2">
                          {row.ingredients.map((ingredient) => (
                            <li key={ingredient.product_id} className="flex justify-between gap-3">
                              <span>{ingredient.name}</span>
                              <span>{ingredient.quantity} {ingredient.unit}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-sm text-muted-foreground">{t('prep.atPar')}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {printing && rows.length ? (
        <div className="print-area hidden print:block">
          <PrepSheetDoc rows={rows} business={record} docStyle={docStyle} />
        </div>
      ) : null}

      <BatchDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        recipes={recipes}
        locations={locations}
        onSaved={(text) => {
          setFlash(text);
          setReload((n) => n + 1);
        }}
      />
    </div>
  );
}
