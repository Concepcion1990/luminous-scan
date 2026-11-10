import { Package } from 'lucide-react';
import { Image } from '@/components/ui/image';

/** The catalog's cover photograph, with a quiet placeholder when none is loaded. */
export default function ProductThumb({ product, className = 'h-10 w-10' }) {
  const url = product.photo_urls?.[0];

  return (
    <div className={`${className} shrink-0 overflow-hidden rounded-lg border border-border bg-muted`}>
      {url ? (
        <Image
          src={url}
          alt={product.name}
          fittingType="fill"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-muted-foreground/50">
          <Package className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}