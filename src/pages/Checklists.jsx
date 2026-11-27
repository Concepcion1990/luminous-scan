import { useCallback, useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/client';
import { Check, ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBusiness } from '@/hooks/useBusiness';
import { scoped } from '@/lib/scoped';
import { formatDateTime } from '@/lib/dates';
import { allRoles } from '@/lib/staff';
import {
  completeChecklistItem,
  createChecklistTemplate,
  deleteChecklistTemplate,
  fetchChecklistHistory,
  fetchChecklistTemplates,
  fetchChecklistToday,
  localRunDate,
  photoToProofDataUrl,
  uncompleteChecklistItem,
  updateChecklistTemplate,
} from '@/lib/checklists';
import { t } from '@/lib/i18n';

/**
 * Checklists (plan release 369, Nov 26, 2026): the general
 * checklist home for EVERY business on both plans — the
 * owner's Q1 ruling ("Do it for everyone"). The owner builds
 * templates (opening, closing, cleaning, anything else),
 * assigns them by role or by shift, and staff tick items off
 * on the phone, each tick recording who and when. Key items
 * can require proof — a photo, a scan, or a typed temperature
 * — before they can be ticked.
 *
 * Ticking off is plain staff work: no permission is asked.
 * Template management rides the owner-grant tick
 * `checklists.manage` (off by default): the server says who
 * may manage (canManage), and only those people see the
 * template furniture. Completion history below is the
 * manager's from-home check: what got done, by whom, and
 * what's missing.
 */
const PROOF_OPTIONS = ['none', 'photo', 'scan', 'temperature'];
const proofLabel = (proof) =>
  t(proof === 'photo' ? 'checklists.proofPhoto' : proof === 'scan' ? 'checklists.proofScan' : proof === 'temperature' ? 'checklists.proofTemperature' : 'checklists.proofNone');

function emptyItem() {
  return { id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: '', proof: 'none' };
}

export default function Checklists() {
  const { activeId } = useBusiness();
  const [today, setToday] = useState(null);
  const [history, setHistory] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState('');
  const [proofDrafts, setProofDrafts] = useState({});
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    if (!activeId) return;
    const [todayView, historyView, templateView, rolePage] = await Promise.all([
      fetchChecklistToday(activeId),
      fetchChecklistHistory(activeId),
      fetchChecklistTemplates(activeId),
      base44.entities.StaffRole.filter(scoped({}, activeId), { sort: 'name', limit: 100 }).catch(() => ({ items: [] })),
    ]);
    setToday(todayView);
    setHistory(historyView.history ?? []);
    setTemplates(templateView.templates ?? []);
    setCanManage(Boolean(todayView.canManage || templateView.canManage));
    setRoles(allRoles(rolePage.items ?? []));
    setLoading(false);
  }, [activeId]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const setProofDraft = (key, value) => setProofDrafts((drafts) => ({ ...drafts, [key]: value }));

  const tick = async (instance, item) => {
    setError('');
    const key = `${instance.id}:${item.id}`;
    let proofValue = null;
    if (item.proof === 'photo') {
      proofValue = proofDrafts[key] || null;
      if (!proofValue) {
        setError(t('checklists.proofNeeded'));
        return;
      }
    } else if (item.proof === 'scan' || item.proof === 'temperature') {
      proofValue = (proofDrafts[key] || '').trim();
      if (!proofValue) {
        setError(t('checklists.proofNeeded'));
        return;
      }
    }
    try {
      await completeChecklistItem(activeId, instance.id, item.id, proofValue);
      setProofDraft(key, '');
      await load();
    } catch {
      setError(t('checklists.proofNeeded'));
    }
  };

  const untick = async (instance, item) => {
    setError('');
    try {
      await uncompleteChecklistItem(activeId, instance.id, item.id);
      await load();
    } catch {
      setError(t('checklists.saveFailed'));
    }
  };

  const openNew = () => {
    setEditing('new');
    setForm({
      name: '',
      assign_type: 'everyone',
      assign_value: '',
      schedule: 'daily',
      items: [emptyItem()],
    });
    setFormError('');
  };

  const openEdit = (template) => {
    setEditing(template.id);
    setForm({
      name: template.name || '',
      assign_type: template.assign_type || 'everyone',
      assign_value: template.assign_value || '',
      schedule: template.schedule || 'daily',
      items: (template.items || []).map((item) => ({ ...item })),
    });
    setFormError('');
  };

  const saveTemplate = async () => {
    setFormError('');
    const payload = {
      ...form,
      items: (form.items || []).filter((item) => item.label.trim()),
      start_date: form.schedule === 'once' || form.schedule === 'weekly' ? localRunDate() : null,
      weekday: form.schedule === 'weekly' ? new Date().getDay() : null,
    };
    if (!payload.name.trim() || !payload.items.length) {
      setFormError(t('checklists.saveFailed'));
      return;
    }
    setSaving(true);
    try {
      if (editing === 'new') await createChecklistTemplate(activeId, payload);
      else await updateChecklistTemplate(activeId, editing, payload);
      setEditing(null);
      setFlash(t('checklists.saved'));
      await load();
    } catch {
      setFormError(t('checklists.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const removeTemplate = async (template) => {
    if (!window.confirm(t('checklists.deleteConfirm'))) return;
    try {
      await deleteChecklistTemplate(activeId, template.id);
      setFlash(t('checklists.saved'));
      await load();
    } catch {
      setError(t('checklists.saveFailed'));
    }
  };

  const addStarters = async () => {
    const starters = [
      { name: t('checklists.starterOpening'), items: ['checklists.starterOpeningItem1', 'checklists.starterOpeningItem2', 'checklists.starterOpeningItem3'] },
      { name: t('checklists.starterClosing'), items: ['checklists.starterClosingItem1', 'checklists.starterClosingItem2', 'checklists.starterClosingItem3'] },
      { name: t('checklists.starterCleaning'), items: ['checklists.starterCleaningItem1', 'checklists.starterCleaningItem2', 'checklists.starterCleaningItem3'] },
    ];
    try {
      for (const starter of starters) {
        await createChecklistTemplate(activeId, {
          name: starter.name,
          assign_type: 'everyone',
          assign_value: '',
          schedule: 'daily',
          items: starter.items.map((key, i) => ({ id: `item-${i + 1}`, label: t(key), proof: 'none' })),
        });
      }
      setFlash(t('checklists.saved'));
      await load();
    } catch {
      setError(t('checklists.saveFailed'));
    }
  };

  const renderInstance = (instance, { readOnly = false } = {}) => (
    <article key={instance.id} className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{instance.title}</h3>
        <span className="text-xs text-muted-foreground">
          {instance.complete
            ? t('checklists.allDone')
            : t('checklists.progress', { done: instance.done, total: instance.total })}
        </span>
      </div>
      {instance.assign_value ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{instance.assign_value}</p>
      ) : null}
      <div className="mt-3 space-y-2.5">
        {instance.items.map((item) => {
          const key = `${instance.id}:${item.id}`;
          const done = Boolean(item.completion);
          return (
            <div key={item.id} className="flex items-start gap-2.5">
              <Checkbox
                checked={done}
                disabled={readOnly}
                onCheckedChange={(on) => (on ? tick(instance, item) : untick(instance, item))}
                className="mt-0.5"
                aria-label={item.label}
              />
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${done ? 'text-muted-foreground line-through' : ''}`}>{item.label}</p>
                {done ? (
                  <p className="text-xs text-muted-foreground">
                    {t('checklists.doneBy', {
                      name: item.completion.by_name || '',
                      time: item.completion.at ? formatDateTime(item.completion.at) : '',
                    })}
                    {item.completion.proof_type === 'temperature' || item.completion.proof_type === 'scan'
                      ? ` · ${item.completion.proof_value || ''}`
                      : ''}
                  </p>
                ) : !readOnly && item.proof !== 'none' ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium">{proofLabel(item.proof)}</span>
                    {item.proof === 'photo' ? (
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="text-xs"
                        aria-label={t('checklists.proofPhotoHint')}
                        onChange={async (event) => {
                          const dataUrl = await photoToProofDataUrl(event.target.files?.[0]);
                          if (dataUrl) setProofDraft(key, dataUrl);
                        }}
                      />
                    ) : (
                      <Input
                        value={proofDrafts[key] || ''}
                        onChange={(event) => setProofDraft(key, event.target.value)}
                        placeholder={item.proof === 'scan' ? t('checklists.proofScanHint') : t('checklists.proofTempHint')}
                        inputMode={item.proof === 'temperature' ? 'decimal' : 'text'}
                        className="h-8 w-44 text-xs"
                      />
                    )}
                    {item.proof === 'photo' && proofDrafts[key] ? (
                      <img src={proofDrafts[key]} alt="" className="h-10 w-10 rounded object-cover" />
                    ) : null}
                  </div>
                ) : null}
                {done && item.completion.proof_type === 'photo' && item.completion.proof_value ? (
                  <img src={item.completion.proof_value} alt="" className="mt-1.5 h-14 w-14 rounded object-cover" />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );

  const pastDays = useMemo(() => history.filter((day) => day.date !== localRunDate() && day.instances.length), [history]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold sm:text-[28px]">{t('checklists.title')}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('checklists.subtitle')}</p>
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t('checklists.todayTitle')}</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
        ) : !today || today.instances.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">{t('checklists.todayEmpty')}</p>
            {canManage && templates.length === 0 ? (
              <Button className="mt-4" variant="outline" onClick={addStarters}>
                {t('checklists.addStarters')}
              </Button>
            ) : null}
          </div>
        ) : (
          today.instances.map((instance) => renderInstance(instance))
        )}
      </section>

      {canManage ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{t('checklists.templatesTitle')}</h2>
            <Button size="sm" onClick={openNew}>
              <Plus className="mr-1 h-4 w-4" /> {t('checklists.newTemplate')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('checklists.manageHint')}</p>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('checklists.templatesEmpty')}</p>
          ) : (
            <div className="space-y-2">
              {templates.map((template) => (
                <div key={template.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{template.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('checklists.itemCount', { count: template.items.length })} · {t(`checklists.schedule${template.schedule === 'weekly' ? 'Weekly' : template.schedule === 'once' ? 'Once' : 'Daily'}`)}
                      {template.assign_value ? ` · ${template.assign_value}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(template)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" /> {t('recipes.editButton')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeTemplate(template)}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> {t('recipes.deleteButton')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t('checklists.historyTitle')}</h2>
        {pastDays.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('checklists.historyEmpty')}</p>
        ) : (
          pastDays.map((day) => (
            <div key={day.date} className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">{day.date}</h3>
              {day.instances.map((instance) => renderInstance(instance, { readOnly: true }))}
            </div>
          ))
        )}
      </section>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? t('checklists.newTemplate') : t('checklists.editTemplate')}</DialogTitle>
          </DialogHeader>
          {form ? (
            <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
              <div className="space-y-1.5">
                <Label htmlFor="checklist-name">{t('checklists.templateName')}</Label>
                <Input
                  id="checklist-name"
                  value={form.name}
                  onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="checklist-assign">{t('checklists.assignLabel')}</Label>
                  <select
                    id="checklist-assign"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={form.assign_type}
                    onChange={(event) => setForm((c) => ({ ...c, assign_type: event.target.value, assign_value: '' }))}
                  >
                    <option value="everyone">{t('checklists.assignEveryone')}</option>
                    <option value="role">{t('checklists.assignRole')}</option>
                    <option value="shift">{t('checklists.assignShift')}</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="checklist-schedule">{t('checklists.scheduleLabel')}</Label>
                  <select
                    id="checklist-schedule"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={form.schedule}
                    onChange={(event) => setForm((c) => ({ ...c, schedule: event.target.value }))}
                  >
                    <option value="daily">{t('checklists.scheduleDaily')}</option>
                    <option value="weekly">{t('checklists.scheduleWeekly')}</option>
                    <option value="once">{t('checklists.scheduleOnce')}</option>
                  </select>
                </div>
              </div>
              {form.assign_type === 'role' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="checklist-role">{t('checklists.assignRole')}</Label>
                  <select
                    id="checklist-role"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={form.assign_value}
                    onChange={(event) => setForm((c) => ({ ...c, assign_value: event.target.value }))}
                  >
                    <option value="">—</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.name}>{role.name}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              {form.assign_type === 'shift' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="checklist-shift">{t('checklists.shiftName')}</Label>
                  <Input
                    id="checklist-shift"
                    value={form.assign_value}
                    onChange={(event) => setForm((c) => ({ ...c, assign_value: event.target.value }))}
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>{t('checklists.itemsLabel')}</Label>
                {form.items.map((item, index) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <Input
                      value={item.label}
                      placeholder={t('checklists.itemPlaceholder')}
                      onChange={(event) =>
                        setForm((c) => ({
                          ...c,
                          items: c.items.map((entry, i) => (i === index ? { ...entry, label: event.target.value } : entry)),
                        }))
                      }
                    />
                    <select
                      aria-label={t('checklists.proofLabel')}
                      className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={item.proof}
                      onChange={(event) =>
                        setForm((c) => ({
                          ...c,
                          items: c.items.map((entry, i) => (i === index ? { ...entry, proof: event.target.value } : entry)),
                        }))
                      }
                    >
                      {PROOF_OPTIONS.map((proof) => (
                        <option key={proof} value={proof}>{proofLabel(proof)}</option>
                      ))}
                    </select>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setForm((c) => ({ ...c, items: c.items.filter((_, i) => i !== index) }))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setForm((c) => ({ ...c, items: [...c.items, emptyItem()] }))}
                >
                  <Plus className="mr-1 h-4 w-4" /> {t('checklists.addItem')}
                </Button>
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('recipes.cancel')}
            </Button>
            <Button onClick={saveTemplate} disabled={saving}>
              {saving ? t('recipes.saving') : t('checklists.saveTemplate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
