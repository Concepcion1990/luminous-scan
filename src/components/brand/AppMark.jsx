import { APP_NAME, APP_TAGLINE } from '@/lib/business';

/**
 * The permanent software identity. It is never affected by the merchant's
 * business name, tagline or logo.
 *
 * The mark is the official 3D Earth globe (owner's decision, Nov 13,
 * 2026): wherever the name Luminous StockHaven appears on a surface
 * that allows an image, the globe sits next to it, sized to match
 * the lettering. The web asset is public/globe-mark.svg, rendered
 * from the masters in ~/workspace/luminous-stockhaven/logo/.
 */
export default function AppMark({ compact = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <img
        src="/globe-mark.svg"
        alt=""
        aria-hidden="true"
        className={`shrink-0 object-contain ${compact ? 'h-5 w-5' : 'h-8 w-8'}`}
      />
      <div className="min-w-0 leading-tight">
        <p
          className={
            compact
              ? 'truncate font-mono text-[9px] uppercase tracking-[0.18em] text-primary-foreground/55'
              : 'truncate font-heading text-[13px] font-semibold tracking-tight'
          }
        >
          {APP_NAME}
        </p>
        {!compact && (
          <p className="text-[9.5px] leading-snug text-primary-foreground/45">{APP_TAGLINE}</p>
        )}
      </div>
    </div>
  );
}