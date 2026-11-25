import { Link } from 'react-router-dom';
import { t } from '@/lib/i18n';

/**
 * One feature door, drawn the same way everywhere it appears
 * (release 377): the card the Restaurant hub has carried
 * since release 361, now shared by the shelf pages and the
 * Today page's shelf grid, so a door looks like itself
 * wherever the owner meets it.
 */
export default function DoorCard({ door }) {
  const Icon = door.icon;
  return (
    <Link
      to={door.to}
      className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 hover:bg-muted/40"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{t(door.titleKey)}</span>
        <span className="block text-xs text-muted-foreground">{t(door.bodyKey)}</span>
      </span>
    </Link>
  );
}
