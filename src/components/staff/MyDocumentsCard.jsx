import { useCallback, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { getWorkforceContext, listMyDocuments } from '@/lib/workforce';
import MyDocumentsDialog from './MyDocumentsDialog';

/**
 * My documents (the staff-documents self-door, Nov 24, 2026) —
 * the Payroll page's personal card, beside "Your details on
 * file" and the member's own pay stubs: the places a person
 * already finds their own things. It renders for anyone with
 * a staff row in this business (the workforce context's
 * my_staff_id) — no tick, no grant: the file it opens is the
 * caller's OWN, bound server-side to their own row, read-only.
 * For anyone without a staff row here it renders NOTHING.
 */
export default function MyDocumentsCard() {
  const { activeId } = useBusiness();
  const [mine, setMine] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!activeId) return;
    try {
      const context = await getWorkforceContext(activeId);
      if (!context.my_staff_id) {
        setLoaded(true);
        return;
      }
      const data = await listMyDocuments(activeId);
      setMine(data ?? { documents: [] });
    } catch {
      // A failed load hides the card rather than breaking the page.
      setMine(null);
    } finally {
      setLoaded(true);
    }
  }, [activeId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!loaded || !mine) return null;
  const count = mine.documents?.length ?? 0;

  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-2.5">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{t('staff.documents.mineTitle')}</h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {t('staff.documents.mineDesc')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {count > 0
              ? t('staff.documents.fileCount', { count })
              : t('staff.documents.mineEmpty')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          {t('staff.documents.openFile')}
        </Button>
      </div>

      {open && (
        <MyDocumentsDialog
          open={open}
          onOpenChange={(next) => { if (!next) setOpen(false); }}
          businessId={activeId}
        />
      )}
    </section>
  );
}
