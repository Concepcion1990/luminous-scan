/**
 * A person's face (Nov 21, 2026): their APPROVED profile photo
 * when they have one, their initials when they don't. There is
 * no third state on any shared surface — a photo still waiting
 * for the owner's approval is never rendered here, by law.
 */
import { initialsOf, profilePhotoFileUrl } from '@/lib/profilePhotos';
import { cn } from '@/lib/utils';

export default function ProfileAvatar({ businessId, personKey, name, hasPhoto, className }) {
  if (hasPhoto && businessId && personKey) {
    return (
      <img
        src={profilePhotoFileUrl(businessId, personKey)}
        alt=""
        aria-hidden="true"
        className={cn('shrink-0 rounded-full object-cover', className || 'h-8 w-8')}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground',
        className || 'h-8 w-8 text-xs',
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
