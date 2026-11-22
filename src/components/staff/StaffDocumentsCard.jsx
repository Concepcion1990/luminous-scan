import { useCallback, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { getWorkforceContext, listDocumentMembers } from '@/lib/workforce';
import StaffDocumentsDialog from './StaffDocumentsDialog';

/**
 * Staff documents (the staff documents build, Nov 21, 2026) —
 * the Staff page's documents card. It renders ONLY for a
 * documents admin: the owner, or a manager holding the
 * staff.documents tick (the workforce context's documents_admin
 * boolean; the server re-checks every read and write). For
 * everyone else it renders NOTHING — no locked row, no teaser:
 * without the tick, this area does not exist.
 *
 * Each row is one person's file: their name, how much paperwork
 * is on file, and the door into it. A ticked manager's list
 * holds staff-level members only — a manager's own documents
 * stay with the owner alone (the server shapes the list; this
 * card renders what it is given).
 */
export default function StaffDocumentsCard() {
  const { activeId } = useBusiness();
  const [ctx, setCtx] = useState(null);
  const [members, setMembers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [openMember, setOpenMember] = useState(null);

  const load = useCallback(async () => {
    if (!activeId) return;
    try {
      const context = await getWorkforceContext(activeId);
      setCtx(context);
      if (!context.documents_admin) {
        setLoaded(true);
        return;
      }
      const data = await listDocumentMembers(activeId);
      setMembers(data?.members ?? []);
    } catch {
      // A failed load hides the card rather than breaking the page.
      setCtx(null);
    } finally {
      setLoaded(true);
    }
  }, [activeId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!loaded || !ctx?.documents_admin) return null;

  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-2.5">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold">{t('staff.documents.title')}</h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            {t('staff.documents.desc')}
          </p>
        </div>
      </div>

      {members.length === 0 ? null : (
        <ul className="divide-y divide-border">
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.full_name}</p>
                <p className="text-xs text-muted-foreground">
                  {member.doc_count > 0
                    ? t('staff.documents.fileCount', { count: member.doc_count })
                    : t('staff.documents.noneOnFile')}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setOpenMember(member)}>
                {t('staff.documents.open')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {openMember && (
        <StaffDocumentsDialog
          open={Boolean(openMember)}
          onOpenChange={(next) => { if (!next) setOpenMember(null); }}
          businessId={activeId}
          member={openMember}
          isOwner={Boolean(ctx.is_owner)}
          onChanged={load}
        />
      )}
    </section>
  );
}
