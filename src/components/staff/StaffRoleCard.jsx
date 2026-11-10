import { Pencil, Trash2, Users } from 'lucide-react';
import { permissionSummary } from '@/lib/staff';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

/** One role: what it grants, and how many staff members sit on it. */
export default function StaffRoleCard({ role, memberCount = 0, builtIn = false, planKey = 'business', onEdit, onDelete }) {
  // The summary is filtered to what the plan may offer: on Essentials a
  // Manager card reads "Stock 3/3" with no Buying chip, never "Stock 4/4"
  // and "Buying 2/2" for permissions the plan cannot open (Finding 7).
  const areas = permissionSummary(role.permissions, planKey).filter((group) => group.granted > 0);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{role.name}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {role.description || t('staff.roleCard.noDescription')}
          </p>
        </div>
        {builtIn ? (
          <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {t('staff.roleCard.builtIn')}
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {areas.length > 0 ? (
          areas.map((group) => (
            <span
              key={group.area}
              className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {group.area} {group.granted}/{group.total}
            </span>
          ))
        ) : (
          <span className="text-[10px] text-muted-foreground">{t('staff.roleCard.noPermissions')}</span>
        )}
      </div>

      <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Users className="h-3 w-3" />
        <span className="numeric">{memberCount}</span>{' '}{memberCount === 1 ? t('staff.roleCard.member') : t('staff.roleCard.members')}
      </p>

      {!builtIn && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onEdit(role)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> {t('staff.roleCard.edit')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(role)}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> {t('staff.roleCard.delete')}
          </Button>
        </div>
      )}
    </div>
  );
}