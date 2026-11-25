import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { RESTAURANT_HOME, homeShelfForRoute } from '@/lib/restaurantShelves';
import { t } from '@/lib/i18n';

/**
 * The way back, on every feature page in the corner
 * (release 377): Today → the page's shelf → here. Two links,
 * small and quiet, so being inside a feature never strands
 * the owner — the shelf it lives on and the Today page are
 * always one tap each. The shelf comes from the one model
 * (src/lib/restaurantShelves.js), never restated per page.
 */
export default function RestaurantCrumbs({ route }) {
  const shelf = homeShelfForRoute(route);
  if (!shelf) return null;
  return (
    <nav aria-label={t('restaurant.eyebrow')} className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <Link to={RESTAURANT_HOME} className="hover:text-foreground hover:underline">
        {t('restaurant.today.title')}
      </Link>
      <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
      <Link to={shelf.route} className="hover:text-foreground hover:underline">
        {t(shelf.labelKey)}
      </Link>
    </nav>
  );
}
