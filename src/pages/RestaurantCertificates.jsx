import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBusiness } from '@/hooks/useBusiness';
import { formatBusinessDate } from '@/lib/dates';
import { CERT_CLASSES, addFoodCert, listFoodCerts, listMyFoodCerts, removeFoodCert } from '@/lib/foodSafety';
import { getWorkforceContext, listDocumentMembers } from '@/lib/workforce';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * Food-handler certificate tracking (plan release 370, Nov
 * 26, 2026 + the round-2 rider widening the classes):
 * per-person certificate expiry dates, with a warning before
 * a certificate expires. The tracking rides the
 * staff-documents machinery (release 340): the shelf answers
 * to the owner or a manager holding the staff.documents
 * tick, a manager's own certificates are the owner's alone,
 * and everyone else sees only their OWN certificates here,
 * read-only — the subject's-own-door pattern.
 */
export default function RestaurantCertificates() {
  const { activeId, record } = useBusiness();
  const [ctx, setCtx] = useState(null);
  const [certs, setCerts] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [certClass, setCertClass] = useState('food_handler');
  const [classLabel, setClassLabel] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    if (!activeId) return;
    setLoading(true);
    try {
      const context = await getWorkforceContext(activeId);
      setCtx(context);
      if (context.documents_admin) {
        const [certData, memberData] = await Promise.all([
          listFoodCerts(activeId),
          listDocumentMembers(activeId),
        ]);
        setCerts(certData?.certs ?? []);
        setMembers(memberData?.members ?? []);
      } else {
        const mine = await listMyFoodCerts(activeId).catch(() => null);
        setCerts(mine?.certs ?? []);
        setMembers([]);
      }
    } catch {
      setCerts([]);
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => { load(); }, [load]);

  const isAdmin = Boolean(ctx?.documents_admin);
  const isOwner = Boolean(ctx?.is_owner);

  const save = async () => {
    setError('');
    if (!memberId) {
      setError(t('foodSafety.certs.needMember'));
      return;
    }
    if (!expiresOn) {
      setError(t('foodSafety.certs.needExpiry'));
      return;
    }
    setSaving(true);
    try {
      const data = await addFoodCert(activeId, memberId, {
        cert_class: certClass,
        class_label: classLabel.trim(),
        issued_on: issuedOn || null,
        expires_on: expiresOn,
      });
      setCerts(data?.certs ?? []);
      setDialogOpen(false);
    } catch (e) {
      setError(e.message || t('foodSafety.certs.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    try {
      const data = await removeFoodCert(activeId, removing.id);
      setCerts(data?.certs ?? []);
      setRemoving(null);
    } catch {
      setRemoving(null);
    }
  };

  const statusBadge = (cert) => {
    if (cert.status === 'expired') {
      return <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{t('foodSafety.certs.statusExpired')}</span>;
    }
    if (cert.status === 'expiring') {
      return (
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          {t('foodSafety.certs.statusExpiring')}
          {typeof cert.days_left === 'number' ? ` · ${t('foodSafety.certs.daysLeft', { days: cert.days_left, s: cert.days_left === 1 ? '' : 's' })}` : ''}
        </span>
      );
    }
    if (cert.status === 'ok') {
      return <span className="rounded-full bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">{t('foodSafety.certs.statusOk')}</span>;
    }
    return null;
  };

  return (
    <div className="space-y-5">
      <RestaurantCrumbs route="/restaurant/certificates" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('foodSafety.certs.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('foodSafety.certs.subtitle')}</p>
        </div>
        {isAdmin && (
          <Button onClick={() => { setError(''); setDialogOpen(true); }}>
            <Plus className="mr-1.5 h-4 w-4" /> {t('foodSafety.certs.newButton')}
          </Button>
        )}
      </div>

      {!isAdmin && !loading && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('foodSafety.certs.gatedNote')}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
      ) : certs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
          <BadgeCheck className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">{t('foodSafety.certs.emptyTitle')}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('foodSafety.certs.emptyBody')}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="px-3 py-2 font-medium">{t('foodSafety.certs.colPerson')}</th>
                <th className="px-3 py-2 font-medium">{t('foodSafety.certs.classLabel')}</th>
                <th className="px-3 py-2 font-medium">{t('foodSafety.certs.expiresLabel')}</th>
                <th className="px-3 py-2 font-medium">{t('foodSafety.certs.colStatus')}</th>
                {isOwner && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {certs.map((cert) => (
                <tr key={cert.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2 font-medium">{cert.member_name}</td>
                  <td className="px-3 py-2">
                    {cert.cert_class === 'other' && cert.class_label
                      ? cert.class_label
                      : t(`foodSafety.certs.class.${cert.cert_class}`)}
                  </td>
                  <td className="px-3 py-2">{cert.expires_on ? formatBusinessDate(cert.expires_on, record) : ''}</td>
                  <td className="px-3 py-2">{statusBadge(cert)}</td>
                  {isOwner && (
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setRemoving(cert)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('foodSafety.certs.newButton')}</DialogTitle>
            <DialogDescription>{t('foodSafety.certs.dialogIntro')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('foodSafety.certs.memberLabel')}</Label>
              <Select value={memberId || 'none'} onValueChange={(v) => setMemberId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('foodSafety.certs.memberPick')}</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('foodSafety.certs.classLabel')}</Label>
              <Select value={certClass} onValueChange={setCertClass}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CERT_CLASSES.map((c) => (
                    <SelectItem key={c} value={c}>{t(`foodSafety.certs.class.${c}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {certClass === 'other' && (
              <div className="space-y-1.5">
                <Label>{t('foodSafety.certs.classNameLabel')}</Label>
                <Input value={classLabel} onChange={(e) => setClassLabel(e.target.value)} />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('foodSafety.certs.issuedLabel')}</Label>
                <Input type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('foodSafety.certs.expiresLabel')}</Label>
                <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
              </div>
            </div>
            {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('recipes.cancel')}</Button>
            <Button onClick={save} disabled={saving}>{saving ? t('recipes.saving') : t('foodSafety.certs.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(removing)} onOpenChange={(next) => { if (!next) setRemoving(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('foodSafety.certs.removeTitle')}</DialogTitle>
            <DialogDescription>{t('foodSafety.certs.removeBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>{t('recipes.cancel')}</Button>
            <Button variant="destructive" onClick={confirmRemove}>{t('staff.documents.remove')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
