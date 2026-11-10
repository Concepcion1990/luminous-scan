import { ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LISTING_CHANNELS, LISTING_STATUSES } from '@/lib/listings';
import { formatMoney } from '@/lib/inventory';

const PILL = {
  green: 'bg-ok/12 text-ok',
  blue: 'bg-secondary text-foreground',
  yellow: 'bg-warn/15 text-warn',
  purple: 'bg-accent/15 text-accent-foreground',
  pink: 'bg-destructive/10 text-destructive',
  gray: 'bg-muted text-muted-foreground',
};

export default function ListingRow({ listing, currency, onEdit, onDelete }) {
  const channel = LISTING_CHANNELS[listing.channel] || LISTING_CHANNELS.other;
  const status = LISTING_STATUSES[listing.status] || LISTING_STATUSES.draft;
  const url = listing.url && /^https?:\/\//i.test(listing.url) ? listing.url : '';

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium">{listing.product_name || 'Product'}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{listing.sku}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${PILL[channel.tone]}`}>
            {channel.label}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${PILL[status.tone]}`}>
            {status.label}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {[
            listing.quantity_listed != null ? `${listing.quantity_listed} listed` : '',
            listing.external_id,
            listing.listed_on ? `listed ${listing.listed_on}` : '',
            listing.last_checked ? `checked ${listing.last_checked}` : '',
            listing.notes,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium underline underline-offset-2"
          >
            Open listing <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <span className="numeric mr-1 text-sm font-semibold">
          {listing.price != null ? formatMoney(listing.price, currency, 2) : '—'}
        </span>
        <Button size="icon" variant="ghost" onClick={onEdit} aria-label={`Edit ${listing.product_name}`}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="text-muted-foreground"
          onClick={onDelete}
          aria-label={`Delete ${listing.product_name}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}