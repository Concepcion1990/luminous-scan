import { useEffect, useState } from 'react';
import { Expand } from 'lucide-react';
import { Image } from '@/components/ui/image';
import { t } from '@/lib/i18n';


/** Every photo of a product: one large view plus a strip to move between them. */
export default function PhotoGallery({ photos = [], name = 'Product' }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [photos[0], photos.length]);

  if (!photos.length) return null;

  const safeIndex = Math.min(index, photos.length - 1);
  const current = photos[safeIndex];
  // Only http(s) photo URLs may be linked out: a stored javascript: (or
  // other non-web) URL must never reach an <a href>. Listings already
  // validate the same way (src/components/listings/ListingRow.jsx).
  const safeUrl = typeof current === 'string' && /^https?:\/\//i.test(current) ? current : '';
  const FullSize = safeUrl ? 'a' : 'div';
  const fullSizeProps = safeUrl
    ? { href: safeUrl, target: '_blank', rel: 'noreferrer', title: t('products.photoFullSizeTitle') }
    : { title: t('products.photoNoFullSize') };

  return (
    <div className="space-y-2">
      <FullSize
        {...fullSizeProps}
        className="group relative block overflow-hidden rounded-xl border border-border bg-muted"
      >
        <Image
          src={current}
          alt={t('products.photoAlt', { name, index: safeIndex + 1 })}
          fittingType="fill"
          className="aspect-[16/10] w-full object-cover"
        />
        <span className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-background/85 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-foreground opacity-0 transition-opacity group-hover:opacity-100">
          <Expand className="h-3 w-3" /> {t('products.photoFullSize')}
        </span>
      </FullSize>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {photos.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={t('products.photoShowAria', { index: i + 1 })}
            aria-pressed={i === safeIndex}
            className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
              i === safeIndex ? 'border-primary' : 'border-transparent hover:border-border'
            }`}
          >
            <Image src={url} alt="" fittingType="fill" className="h-full w-full object-cover" />
          </button>
        ))}
        <span className="numeric ml-auto shrink-0 pl-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {safeIndex + 1} / {photos.length}
        </span>
      </div>
    </div>
  );
}