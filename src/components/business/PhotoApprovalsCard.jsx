import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import { apiRequest } from '@/api/client';
import { useBusiness } from '@/hooks/useBusiness';
import SettingsCard from './SettingsCard';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import {
  profilePhotoPendingUrl,
  profilePhotosBase,
  usePendingProfilePhotos,
} from '@/lib/profilePhotos';
import { getLocale, t } from '@/lib/i18n';

/**
 * Photos waiting for the owner's word (Nov 21, 2026) — the
 * Staff page's approval card. Approval is the OWNER's alone:
 * this card renders only for the owner, and the server refuses
 * every other hand regardless. Until the owner approves, the
 * photo shows nowhere in the app. Renders nothing when nobody
 * is waiting.
 */
export default function PhotoApprovalsCard({ isOwner }) {
  const { activeId } = useBusiness();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busyKey, setBusyKey] = useState(null);
  const pendingQuery = usePendingProfilePhotos(activeId, isOwner);
  const pending = pendingQuery.data?.pending || [];

  if (!isOwner || !pending.length) return null;

  const decide = async (personKey, verdict) => {
    setBusyKey(personKey);
    try {
      await apiRequest(`${profilePhotosBase(activeId)}/${personKey}/${verdict}`, {
        method: 'POST',
        body: {},
      });
      queryClient.invalidateQueries({ queryKey: ['profile-photos', activeId] });
      toast({
        title: t(verdict === 'approve' ? 'profile.approvedToast' : 'profile.declinedToast'),
      });
    } catch (error) {
      toast({ title: error?.message || t('profile.toastFailed'), variant: 'destructive' });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <SettingsCard
      title={t('profile.approvalsTitle')}
      description={t('profile.approvalsDesc')}
    >
      <ul className="space-y-3">
        {pending.map((entry) => (
          <li
            key={entry.staff_id}
            className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:flex-wrap sm:items-center"
          >
            {/* Phone widths stack (Nov 21, 2026): the photo and
                name keep their own row, the details sit under the
                name, and the two buttons go full-width below —
                the row layout crushed the name to a sliver and
                stacked the date a word at a time. From sm up the
                card is the original single row. */}
            <div className="flex min-w-0 items-center gap-3 sm:flex-1">
              <img
                src={profilePhotoPendingUrl(activeId, entry.staff_id)}
                alt=""
                aria-hidden="true"
                className="h-14 w-14 shrink-0 rounded-full object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{entry.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.role_name ? `${entry.role_name} · ` : ''}
                  {t('profile.submittedOn', {
                    date: new Date(entry.pending_at).toLocaleDateString(getLocale(), {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    }),
                  })}
                </p>
              </div>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <Button
                type="button"
                size="sm"
                className="flex-1 sm:flex-none"
                disabled={busyKey === entry.staff_id}
                onClick={() => decide(entry.staff_id, 'approve')}
              >
                {busyKey === entry.staff_id ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
                )}
                {t('profile.approve')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex-1 sm:flex-none"
                disabled={busyKey === entry.staff_id}
                onClick={() => decide(entry.staff_id, 'decline')}
              >
                <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t('profile.decline')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
