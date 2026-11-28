import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Printer, Wine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import BarCountDoc from '@/components/print/BarCountDoc';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';
import { useBusiness } from '@/hooks/useBusiness';
import { resolveDocStyle } from '@/lib/docStyle';
import { bottleFill, fetchBarCounting, partialCounted, saveBarCount, toggleBarCounting } from '@/lib/barCounting';
import { t } from '@/lib/i18n';

/**
 * Bar counting (plan release 379, Nov 26, 2026): Business-
 * only, Restaurant Corner, Stock & Ordering shelf — and
 * hidden until the owner turns it on for the business
 * (anti-clutter rule 3; this page is the switch's home).
 *
 * Open bottles are counted in tenths: slide to how full
 * the bottle looks on its picture. Kegs are recorded the
 * same way. Counts are organized by storage area, and
 * saving one writes an ordinary count session — review
 * and apply run on the Counts page, and the applied
 * differences feed the theoretical-vs-actual variance.
 * No hardware: the Bluetooth-scale version is out of
 * scope by the plan's own ruling.
 */

/** The bottle picture the slider fills: a bottle outline
 *  whose liquid rises with the tenths; a keg draws as a
 *  barrel. Purely the counter's visual — the number is
 *  the slider's. */
function BottlePicture({ kind, tenths }) {
  const fill = bottleFill(tenths);
  if (kind === 'keg') {
    const y = 58 - fill * 44;
    return (
      <svg viewBox="0 0 48 64" className="h-16 w-12" aria-hidden="true">
        <rect x="10" y="10" width="28" height="48" rx="9" className="fill-none stroke-current" strokeWidth="2" />
        <rect x="13" y={y} width="22" height={58 - y - 3 > 0 ? 58 - y - 3 : 0} rx="6" className="fill-amber-500/70" />
        <line x1="10" y1="24" x2="38" y2="24" className="stroke-current" strokeWidth="1.5" />
        <line x1="10" y1="44" x2="38" y2="44" className="stroke-current" strokeWidth="1.5" />
      </svg>
    );
  }
  const y = 60 - fill * 34;
  return (
    <svg viewBox="0 0 48 64" className="h-16 w-12" aria-hidden="true">
      <path d="M20 4 h8 v12 c6 3 8 7 8 13 v29 a4 4 0 0 1 -4 4 h-16 a4 4 0 0 1 -4 -4 v-29 c0 -6 2 -10 8 -13 z" className="fill-none stroke-current" strokeWidth="2" />
      <path d={`M14 ${Math.max(y, 30)} h20 v28 a2 2 0 0 1 -2 2 h-16 a2 2 0 0 1 -2 -2 z`} className="fill-amber-500/70" />
    </svg>
  );
}

export default function RestaurantBarCounting() {
  const { activeId, record, profile } = useBusiness();
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);
  const [data, setData] = useState(null);
  const [areaId, setAreaId] = useState('');
  const [entries, setEntries] = useState({});
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    if (!activeId) return;
    const result = await fetchBarCounting(activeId);
    setData(result);
    if (!areaId && result.areas?.length) setAreaId(result.areas[0].id);
  }, [activeId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const isOwner = Boolean(data?.isOwner);
  const canCount = Boolean(data?.canCount);
  const areas = data?.areas || [];
  const area = areas.find((a) => a.id === areaId) || null;

  const setEntry = (productId, patch) => {
    setEntries((prev) => ({
      ...prev,
      [productId]: { kind: 'bottle', full_units: '', partial_tenths: 0, ...prev[productId], ...patch },
    }));
  };

  const flip = async (enabled) => {
    setBusy(true);
    setError('');
    try {
      await toggleBarCounting(activeId, enabled);
      await load();
    } catch { setError(t('barCounting.saveFailed')); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!area) return;
    const lines = Object.entries(entries)
      .filter(([, entry]) => entry.full_units !== '' && entry.full_units !== null && entry.full_units !== undefined)
      .map(([productId, entry]) => ({
        product_id: productId,
        kind: entry.kind === 'keg' ? 'keg' : 'bottle',
        full_units: Number(entry.full_units),
        partial_tenths: Number(entry.partial_tenths) || 0,
      }));
    setBusy(true);
    setError('');
    setFlash('');
    try {
      const result = await saveBarCount(activeId, { location_id: area.id, lines });
      setFlash(t('barCounting.savedNote', { number: result.number }));
      setEntries({});
    } catch { setError(t('barCounting.saveFailed')); } finally { setBusy(false); }
  };

  const printSheet = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 50);
  };

  return (
    <div className="space-y-6">
      <div className="no-print">
        <RestaurantCrumbs route="/restaurant/bar-counting" />
      </div>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 flex items-center gap-2 text-2xl font-semibold sm:text-[28px]">
            <Wine className="h-6 w-6" /> {t('barCounting.title')}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('barCounting.subtitle')}</p>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t('barCounting.varianceNote')}</p>
        </div>
        {data?.enabled && area ? (
          <Button variant="outline" onClick={printSheet}>
            <Printer className="mr-1.5 h-4 w-4" /> {t('barCounting.printButton')}
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
      ) : !data.enabled ? (
        <div className="no-print rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <Wine className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('barCounting.offTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('barCounting.offBody')}</p>
          {isOwner ? (
            <Button className="mt-4" onClick={() => flip(true)} disabled={busy}>{t('barCounting.turnOnButton')}</Button>
          ) : (
            <p className="mx-auto mt-3 max-w-md text-xs text-muted-foreground">{t('barCounting.ownerOnlyNote')}</p>
          )}
        </div>
      ) : (
        <>
          <div className="no-print flex flex-wrap items-center gap-3">
            <div className="space-y-1">
              <Label>{t('barCounting.areaLabel')}</Label>
              <select
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={areaId}
                onChange={(e) => { setAreaId(e.target.value); setEntries({}); }}
              >
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            {isOwner ? (
              <Button variant="outline" onClick={() => flip(false)} disabled={busy}>{t('barCounting.turnOffButton')}</Button>
            ) : null}
            <p className="text-xs text-muted-foreground">{t('barCounting.enabledNote')}</p>
          </div>

          {!area || area.lines.length === 0 ? (
            <div className="no-print rounded-xl border border-dashed border-border px-4 py-10 text-center">
              <Wine className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">{t('barCounting.emptyTitle')}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('barCounting.emptyBody')}</p>
            </div>
          ) : (
            <section className="no-print space-y-3">
              {area.lines.map((line) => {
                const entry = entries[line.product_id] || { kind: 'bottle', full_units: '', partial_tenths: 0 };
                const counted = entry.full_units === '' ? null : partialCounted(entry.full_units, entry.partial_tenths);
                return (
                  <div key={line.product_id} className="flex flex-wrap items-center gap-4 rounded-xl border border-border p-4">
                    <div className="text-muted-foreground">
                      <BottlePicture kind={entry.kind} tenths={entry.partial_tenths} />
                    </div>
                    <div className="min-w-40 flex-1">
                      <p className="font-medium">{line.product_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t('barCounting.expectedLabel')}: {line.expected}
                      </p>
                      <div className="mt-2 flex gap-1.5">
                        {['bottle', 'keg'].map((kind) => (
                          <Button
                            key={kind}
                            size="sm"
                            variant={entry.kind === kind ? 'default' : 'outline'}
                            onClick={() => setEntry(line.product_id, { kind })}
                          >
                            {kind === 'keg' ? t('barCounting.kindKeg') : t('barCounting.kindBottle')}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>{t('barCounting.fullLabel')}</Label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        className="w-24"
                        value={entry.full_units}
                        onChange={(e) => setEntry(line.product_id, { full_units: e.target.value })}
                      />
                    </div>
                    <div className="w-44 space-y-1">
                      <Label>{t('barCounting.partialLabel')}: {entry.partial_tenths}/10</Label>
                      <input
                        type="range"
                        min="0"
                        max="9"
                        step="1"
                        className="w-full"
                        value={entry.partial_tenths}
                        onChange={(e) => setEntry(line.product_id, { partial_tenths: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('barCounting.countedLabel')}</Label>
                      <p className="py-2 text-sm font-medium">{counted === null ? '—' : counted}</p>
                    </div>
                  </div>
                );
              })}
              {canCount ? (
                <Button onClick={save} disabled={busy}>{t('barCounting.saveButton')}</Button>
              ) : null}
            </section>
          )}
        </>
      )}

      {printing && area ? (
        <div className="print-area hidden print:block">
          <BarCountDoc area={area} entries={entries} business={record} docStyle={docStyle} />
        </div>
      ) : null}
    </div>
  );
}
