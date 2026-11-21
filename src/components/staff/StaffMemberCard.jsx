import { useState } from 'react';
import { base44 } from '@/api/client';
import { KeyRound, Mail, MailPlus, MapPin, Pencil, Trash2, UserCog } from 'lucide-react';
import { permissionSummary, statusMeta } from '@/lib/staff';
import { profilePhotoFileUrl } from '@/lib/profilePhotos';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

function initials(name = '') {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || '?'
  );
}

export default function StaffMemberCard({ member, locations = [], planKey = 'business', businessId = null, hasPhoto = false, isOwner = false, readOnly = false, onEdit, onRemove, onSendReset }) {
  const { toast } = useToast();
  const [resending, setResending] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const status = statusMeta(member.status);
  // Count only what the plan may offer: an Essentials Manager member with
  // the preset's 17 stored keys reads "14 permissions", never "17", and
  // the Buying area never appears (Finding 7).
  const summary = permissionSummary(member.permissions, planKey);
  const granted = summary.reduce((total, group) => total + group.granted, 0);
  const areas = summary.filter((group) => group.granted > 0);
  // The live location name wins, so a renamed store reads correctly on old records.
  const storeName =
    locations.find((location) => location.id === member.location_id)?.name ||
    member.location_name ||
    '';

  // Finding 24: an invitation is sent only when the member is created, so
  // a lost invite email left no recovery but delete-and-re-add. Resend it
  // the same way the create path does (StaffMemberDialog sends
  // base44.users.inviteUser on create); the member stays Invited until the
  // owner sets them Active, exactly as the create toast says.
  const resendInvite = async () => {
    if (!member.email || resending) return;
    setResending(true);
    try {
      await base44.users.inviteUser(member.email, member.app_role || 'user');
      toast({
        title: t('staff.member.inviteResent'),
        description: t('staff.member.inviteResentDesc', {
          email: member.email,
          role: member.role_name || t('staff.member.roleFallback'),
        }),
      });
    } catch (error) {
      toast({
        title: t('staff.member.inviteFailed'),
        description:
          error?.message || t('staff.member.inviteFailedDesc'),
        variant: 'destructive',
      });
    } finally {
      setResending(false);
    }
  };

  // Owner-only: send the standard password reset to the member's
  // account email (they have an account once they are no longer a
  // pending invite — an invite has no password to reset). The page
  // handler confirms first and toasts the outcome.
  const sendReset = async () => {
    if (sendingReset || !onSendReset) return;
    setSendingReset(true);
    try {
      await onSendReset(member);
    } finally {
      setSendingReset(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        {hasPhoto && businessId ? (
          // The member's APPROVED profile photo (Nov 21, 2026) —
          // the page passes hasPhoto only for approved keys, so a
          // waiting photo can never render here.
          <img
            src={profilePhotoFileUrl(businessId, member.id)}
            alt=""
            aria-hidden="true"
            className="h-10 w-10 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {initials(member.full_name)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{member.full_name}</p>
          {/* The email line renders only when the payload carries
              it: roster-only viewers never receive other members'
              addresses (owner's email-exposure rule, Nov 21, 2026). */}
          {member.email ? (
            <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
              <Mail className="h-3 w-3 shrink-0" /> {member.email}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary">
          <UserCog className="h-3 w-3" /> {member.role_name || t('staff.member.noRole')}
        </span>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${status.tone}`}>
          {status.label}
        </span>
        {member.app_role === 'admin' && (
          <span className="rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10px] font-medium">
            {t('staff.member.administrator')}
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          <MapPin className="h-3 w-3" /> {storeName || t('staff.member.noStore')}
        </span>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        <span className="numeric font-medium text-foreground">{granted}</span>{' '}{t('staff.member.permissions')}
        {areas.length > 0 ? t('staff.member.areas', { areas: areas.map((group) => group.area).join(', ') }) : ''}
      </p>

      {member.notes && (
        <p className="mt-2 border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground">
          {member.notes}
        </p>
      )}

      {/* The action row is manage furniture: a read-only roster
          viewer (the owner's staff.roster tick, Nov 19, 2026)
          sees the card without it — no dangling doors. */}
      {!readOnly && (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onEdit(member)}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> {t('staff.member.edit')}
        </Button>
        {member.status === 'invited' && (
          <Button size="sm" variant="outline" onClick={resendInvite} disabled={resending}>
            <MailPlus className="mr-1.5 h-3.5 w-3.5" /> {resending ? t('staff.member.sending') : t('staff.member.resendInvite')}
          </Button>
        )}
        {isOwner && member.status !== 'invited' && (
          <Button size="sm" variant="outline" onClick={sendReset} disabled={sendingReset}>
            <KeyRound className="mr-1.5 h-3.5 w-3.5" /> {sendingReset ? t('staff.member.sending') : t('staff.member.sendReset')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => onRemove(member)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> {t('staff.member.remove')}
        </Button>
      </div>
      )}
    </div>
  );
}