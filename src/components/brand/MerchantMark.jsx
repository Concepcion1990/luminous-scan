import { Store } from 'lucide-react';
import { Image } from '@/components/ui/image';

/** The signed-in merchant's own identity, editable in Business Settings. */
export default function MerchantMark({ profile, showTagline = false }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {profile.logo_url ? (
        <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-primary-foreground/15">
          <Image
            src={profile.logo_url}
            alt={profile.name}
            fittingType="fit"
            className="h-full w-full object-contain p-0.5"
          />
        </span>
      ) : (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary-foreground/15">
          <Store className="h-4 w-4 text-primary-foreground/70" />
        </span>
      )}
      <div className="min-w-0 leading-tight">
        <p className="truncate font-heading text-[13px] font-semibold tracking-tight">{profile.name}</p>
        {showTagline && (
          <p className="truncate text-[10px] leading-snug text-primary-foreground/50">
            {profile.tagline || 'Your workspace'}
          </p>
        )}
      </div>
    </div>
  );
}