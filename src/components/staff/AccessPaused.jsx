import { LogOut, ShieldAlert } from 'lucide-react';
import { base44 } from '@/api/client';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

const COPY = {
  suspended: {
    titleKey: 'staff.access.suspendedTitle',
    bodyKey: 'staff.access.suspendedBody',
  },
  pending: {
    titleKey: 'staff.access.pendingTitle',
    bodyKey: 'staff.access.pendingBody',
  },
  'no-seat': {
    titleKey: 'staff.access.noSeatTitle',
    bodyKey: 'staff.access.noSeatBody',
  },
};

/** Shown instead of the app when the signed-in person has no active seat. */
export default function AccessPaused({ reason = 'suspended' }) {
  const copy = COPY[reason] || COPY.suspended;
  return (
    <div className="mx-auto max-w-md rounded-xl border border-warn/30 bg-warn/10 px-5 py-10 text-center">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-warn/20 text-warn">
        <ShieldAlert className="h-4 w-4" />
      </div>
      <p className="mt-3 text-sm font-semibold">{t(copy.titleKey)}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {t(copy.bodyKey)}
      </p>
      <Button className="mt-4" variant="outline" onClick={() => base44.auth.logout('/login')}>
        <LogOut className="mr-1.5 h-4 w-4" /> {t('staff.access.signOut')}
      </Button>
    </div>
  );
}