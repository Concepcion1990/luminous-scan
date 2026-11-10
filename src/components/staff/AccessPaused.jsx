import { LogOut, ShieldAlert } from 'lucide-react';
import { base44 } from '@/api/client';
import { Button } from '@/components/ui/button';

const COPY = {
  suspended: {
    title: 'Your access is paused',
    body: 'An administrator has suspended this staff account for the active business. Ask them to set you back to active, then sign in again.',
  },
  pending: {
    title: 'Your invitation is not active yet',
    body: 'This business has an invitation for your email that has not been activated. Ask the owner to set your staff status to active. Nothing here is visible until then.',
  },
  'no-seat': {
    title: 'This business is not open to your login',
    body: 'Your account has no staff seat for this business, so its stock stays closed. Ask the owner to add you in Staff & roles.',
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
      <p className="mt-3 text-sm font-semibold">{copy.title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {copy.body}
      </p>
      <Button className="mt-4" variant="outline" onClick={() => base44.auth.logout('/login')}>
        <LogOut className="mr-1.5 h-4 w-4" /> Sign out
      </Button>
    </div>
  );
}