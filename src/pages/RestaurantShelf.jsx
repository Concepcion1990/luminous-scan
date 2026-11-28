import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Wine } from 'lucide-react';
import DoorCard from '@/components/restaurant/DoorCard';
import { Button } from '@/components/ui/button';
import { useBusiness } from '@/hooks/useBusiness';
import { toggleBarCounting } from '@/lib/barCounting';
import { RESTAURANT_HOME, shelfById, visibleDoors } from '@/lib/restaurantShelves';
import { t } from '@/lib/i18n';

/**
 * One shelf of the Restaurant corner (release 377, Nov 25,
 * 2026): the shelf's feature doors, drawn with the same card
 * the corner has always used, under the shelf's name, with
 * the way back to Today at the top. Every feature on a shelf
 * is exactly two taps from Restaurant home — home → shelf →
 * feature — and the doors keep the same routes, ticks and
 * behavior they had before the shelves existed.
 *
 * The Locations shelf is the one special case: it renders
 * only for owners with 2+ businesses (the route itself stays
 * behind the restaurant plan gate like every corner route,
 * and a single-business owner who types the address is
 * quietly sent back to Today — the shelf does not exist for
 * them). Its page lists the owner's businesses; each opens
 * its own corner. The all-locations rollup and commissary
 * mode join this shelf in later releases.
 */
export default function RestaurantShelf({ shelfId }) {
  const shelf = shelfById(shelfId);
  const { businesses, activeId, record, user, refresh, switchTo, isLoading } = useBusiness();
  const navigate = useNavigate();
  const [barBusy, setBarBusy] = useState(false);
  // Bar counting (release 379): the door stays hidden until
  // the owner turns it on — this shelf row is the owner's
  // switch while it is off, shown to the owner only.
  const barOffOwnerRow = shelf?.id === 'stock'
    && record?.bar_counting_enabled !== true
    && user?.id
    && record?.owner_id === user.id;
  const turnBarOn = async () => {
    setBarBusy(true);
    try {
      await toggleBarCounting(activeId, true);
      await refresh();
    } catch { /* the bar page names failures; the shelf stays quiet */ } finally { setBarBusy(false); }
  };

  const isLocations = shelf?.id === 'locations';
  // Only once the workspace read has settled: while it is
  // still loading the business list is empty, and a 2+
  // owner's shelf must not bounce on a half-read list.
  const locationsHidden = isLocations && !isLoading && businesses.length < 2;
  useEffect(() => {
    if (locationsHidden) {
      // Not this owner's shelf — back to Today, quietly, the
      // same way a plan-gated route bounces.
      navigate(RESTAURANT_HOME, { replace: true });
    }
  }, [locationsHidden, navigate]);
  if (!shelf) return null;
  if (locationsHidden) return null;

  const Icon = shelf.icon;

  const openBusiness = async (businessId) => {
    if (businessId !== activeId) await switchTo(businessId);
    navigate(RESTAURANT_HOME);
  };

  return (
    <div className="space-y-5">
      <Link
        to={RESTAURANT_HOME}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {t('restaurant.shelf.back')}
      </Link>

      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('restaurant.eyebrow')}
        </p>
        <h1 className="mt-1.5 flex items-center gap-2.5 text-2xl font-semibold sm:text-[28px]">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </span>
          {t(shelf.labelKey)}
        </h1>
      </div>

      {isLocations ? (
        <div className="space-y-3">
          {/* Plan release 380: the all-locations rollup door
              (with the cross-location push beside it on its
              page) — the Locations shelf's first feature. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleDoors(shelf, record?.bar_counting_enabled === true).map((door) => (
              <DoorCard key={`${door.to}-${door.titleKey}`} door={door} />
            ))}
          </div>
          <p className="max-w-xl text-sm text-muted-foreground">{t('restaurant.locations.intro')}</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {businesses.map((business) => (
              <div key={business.id} className="flex flex-col rounded-xl border border-border bg-card p-4">
                <span className="font-medium">{business.name}</span>
                {business.id === activeId ? (
                  <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="h-3.5 w-3.5 text-ok" /> {t('restaurant.locations.current')}
                  </span>
                ) : (
                  <span className="mt-auto pt-3">
                    <Button variant="outline" size="sm" onClick={() => openBusiness(business.id)}>
                      {t('restaurant.locations.open')}
                    </Button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleDoors(shelf, record?.bar_counting_enabled === true).map((door) => (
              <DoorCard key={`${door.to}-${door.titleKey}`} door={door} />
            ))}
          </div>
          {barOffOwnerRow ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3">
              <Wine className="h-4 w-4 text-muted-foreground" />
              <p className="flex-1 text-sm text-muted-foreground">{t('barCounting.offBody')}</p>
              <Button size="sm" variant="outline" onClick={turnBarOn} disabled={barBusy}>
                {t('barCounting.turnOnButton')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
