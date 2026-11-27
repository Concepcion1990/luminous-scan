import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, SearchCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import { startMockInspection } from '@/lib/foodSafety';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

const ITEM_KEYS = [
  'foodSafety.mock.item1',
  'foodSafety.mock.item2',
  'foodSafety.mock.item3',
  'foodSafety.mock.item4',
  'foodSafety.mock.item5',
  'foodSafety.mock.item6',
  'foodSafety.mock.item7',
  'foodSafety.mock.item8',
];

/**
 * The mock-inspection self-check (plan release 370, Nov 26,
 * 2026): a guided checklist that walks what an inspector
 * looks at, running on the checklist engine (plan 369) —
 * starting one materialises today's instance of the
 * business's mock-inspection list with the items snapshot in
 * the reader's own language, and the team ticks it off on
 * the Checklists page like any other list, who and when
 * recorded on every tick.
 */
export default function RestaurantMockInspection() {
  const { activeId } = useBusiness();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setStarting(true);
    setError('');
    try {
      await startMockInspection(activeId, {
        name: t('foodSafety.mock.title'),
        items: ITEM_KEYS.map((key) => t(key)),
        date: new Date().toISOString().slice(0, 10),
      });
      setStarted(true);
    } catch (e) {
      setError(e.message || t('foodSafety.mock.startFailed'));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/mock-inspection" />
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('restaurant.eyebrow')}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('foodSafety.mock.title')}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('foodSafety.mock.subtitle')}</p>
      </div>

      <div className="rounded-xl border border-border p-4 sm:p-5">
        <div className="flex items-start gap-2.5">
          <SearchCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="max-w-2xl text-sm leading-relaxed">{t('foodSafety.mock.intro')}</p>
        </div>
        <ul className="mt-4 space-y-2">
          {ITEM_KEYS.map((key) => (
            <li key={key} className="flex items-start gap-2 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
        {error ? (
          <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p>
        ) : null}
        {started ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {t('foodSafety.mock.startedNote')}
            </p>
            <Button onClick={() => navigate('/checklists')}>{t('foodSafety.mock.openChecklists')}</Button>
          </div>
        ) : (
          <Button className="mt-4" onClick={start} disabled={starting}>
            {starting ? t('recipes.saving') : t('foodSafety.mock.startButton')}
          </Button>
        )}
      </div>
    </div>
  );
}
