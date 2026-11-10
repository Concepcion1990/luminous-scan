import { Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import useEntitlements from '@/hooks/useEntitlements';
import { permissionLabel } from '@/lib/staff';
import { t } from '@/lib/i18n';

/** Shown in place of a page the signed-in staff member's role does not include. */
export default function NoAccess({ permission }) {
  const { planKey } = useEntitlements();
  return (
    <div className="mx-auto max-w-md rounded-xl border border-border bg-card px-5 py-10 text-center">
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Lock className="h-4 w-4" />
      </div>
      <p className="mt-3 text-sm font-semibold">{t('staff.noAccess.title')}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {permission
          ? t('staff.noAccess.missingPermission', { permission: permissionLabel(permission, planKey) })
          : t('staff.noAccess.noArea')}{' '}
        {t('staff.noAccess.adminNote')}
      </p>
      <Link
        to="/"
        className="mt-4 inline-block rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        {t('staff.noAccess.back')}
      </Link>
    </div>
  );
}