import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import GuestMenuDoc from '@/components/print/GuestMenuDoc';
import { resolveDocStyle } from '@/lib/docStyle';
import { t } from '@/lib/i18n';

/**
 * The guest menu — the guest's side (plan release 371, Nov
 * 26, 2026). A public page: no account, no sign-in, nothing
 * of StockHaven's internals. The server shapes the answer
 * from the owner's publication alone (only the dishes the
 * owner chose, their prices, and the allergen matrix's
 * flags), and this page renders the same Studio document
 * the owner previews — PREVIEW = PRINT. Plan 399's online
 * ordering will stand on this page; no ordering exists here.
 */
export default function GuestMenuPublic() {
  const { slug } = useParams();
  const [menu, setMenu] = useState(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/public/menu/${encodeURIComponent(slug || '')}`);
        if (!res.ok) { setState('notfound'); return; }
        setMenu(await res.json());
        setState('ready');
      } catch {
        setState('failed');
      }
    })();
  }, [slug]);

  const docStyle = useMemo(
    () => resolveDocStyle(menu ? { doc_style: menu.docStyle, brand_color: menu.brandColor } : null),
    [menu],
  );
  const business = useMemo(
    () => (menu ? { name: menu.businessName, currency: menu.currency, brand_color: menu.brandColor, logo_url: menu.logoUrl } : null),
    [menu],
  );

  if (state === 'loading') return <p className="mx-auto max-w-xl px-4 py-16 text-sm text-muted-foreground">{t('restaurant.loading')}</p>;
  if (state === 'notfound') return <p className="mx-auto max-w-xl px-4 py-16 text-center text-base">{t('guestMenu.notFound')}</p>;
  if (state === 'failed' || !menu) return <p className="mx-auto max-w-xl px-4 py-16 text-center text-base">{t('guestMenu.loadFailed')}</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <div className="no-print flex justify-end">
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" /> {t('guestMenu.printButton')}
        </Button>
      </div>
      {menu.items?.length ? (
        <GuestMenuDoc items={menu.items} business={business} docStyle={docStyle} />
      ) : (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm font-medium">{t('guestMenu.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('guestMenu.emptyBody')}</p>
        </div>
      )}
    </div>
  );
}
