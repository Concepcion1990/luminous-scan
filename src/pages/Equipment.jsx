import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Camera, Check, Pencil, Plus, Printer, Trash2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBusiness } from '@/hooks/useBusiness';
import { formatDateTime } from '@/lib/dates';
import { formatMoney } from '@/lib/inventory';
import { resolveDocStyle } from '@/lib/docStyle';
import {
  completeUpkeep,
  createMachine,
  createUpkeep,
  deleteMachine,
  deleteUpkeep,
  fetchEquipmentOverview,
  fetchMachine,
  photoToProofDataUrl,
  recordRepair,
  reportBreakdown,
  updateMachine,
} from '@/lib/equipment';
import EquipmentDoc from '@/components/print/EquipmentDoc';
import { t } from '@/lib/i18n';

/**
 * Equipment records (plan release 372, Nov 26, 2026): the
 * general home for every business that has machines — the
 * owner's Q3 ruling ("do the same thing for every
 * business"), BOTH plans. A page per machine: bought when,
 * warranty end, who services it, and the identifying
 * details the owner wants kept. Upkeep schedules carry due
 * reminders (the Due section below, worst first). The
 * breakdown flow: staff report against the machine with a
 * photo — reporting rides the owner-grant tick
 * `equipment.report` for staff, the owner and managers
 * always hold the door — and repair, cost and outcome join
 * the machine's history. Money (what a machine cost, what
 * a repair cost) is owner/manager territory: the server
 * strips it for everyone else, so it simply never renders
 * here for them.
 */
const emptyMachineForm = () => ({
  name: '', kind: '', make_model: '', serial_number: '', location_name: '',
  purchased_date: '', purchase_price: '', warranty_end: '',
  service_name: '', service_phone: '', notes: '',
});

export default function Equipment() {
  const { activeId, record, profile } = useBusiness();
  const [overview, setOverview] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(null);
  const [error, setError] = useState('');
  const [machineForm, setMachineForm] = useState(null);
  const [editingMachineId, setEditingMachineId] = useState(null);
  const [upkeepForm, setUpkeepForm] = useState(null);
  const [breakdownForm, setBreakdownForm] = useState(null);
  const [repairForm, setRepairForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);

  const load = useCallback(async () => {
    if (!activeId) return;
    const view = await fetchEquipmentOverview(activeId);
    setOverview(view);
    if (selectedId) {
      setDetail(await fetchMachine(activeId, selectedId).catch(() => null));
    }
    setLoading(false);
  }, [activeId, selectedId]);

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, [load]);

  const openMachine = async (machineId) => {
    setSelectedId(machineId);
    setDetail(await fetchMachine(activeId, machineId).catch(() => null));
  };

  const saveMachine = async () => {
    if (!machineForm.name.trim()) return;
    setSaving(true);
    try {
      const payload = { ...machineForm, purchase_price: machineForm.purchase_price === '' ? null : machineForm.purchase_price };
      if (editingMachineId) await updateMachine(activeId, editingMachineId, payload);
      else await createMachine(activeId, payload);
      setMachineForm(null);
      setEditingMachineId(null);
      setFlash(t('equipment.saved'));
      await load();
    } catch {
      setError(t('equipment.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const removeMachine = async (machine) => {
    if (!window.confirm(t('equipment.deleteConfirm'))) return;
    try {
      await deleteMachine(activeId, machine.id);
      setSelectedId(null);
      setDetail(null);
      setFlash(t('equipment.saved'));
      await load();
    } catch {
      setError(t('equipment.saveFailed'));
    }
  };

  const saveUpkeep = async () => {
    if (!upkeepForm.title.trim() || !detail) return;
    setSaving(true);
    try {
      await createUpkeep(activeId, detail.machine.id, {
        title: upkeepForm.title,
        cycle_days: Number(upkeepForm.cycle_days) || 30,
        last_done_date: upkeepForm.last_done_date || null,
      });
      setUpkeepForm(null);
      setFlash(t('equipment.saved'));
      await load();
    } catch {
      setError(t('equipment.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const markDone = async (task) => {
    try {
      await completeUpkeep(activeId, task.id);
      setFlash(t('equipment.saved'));
      await load();
    } catch {
      setError(t('equipment.saveFailed'));
    }
  };

  const removeUpkeep = async (task) => {
    try {
      await deleteUpkeep(activeId, task.id);
      await load();
    } catch {
      setError(t('equipment.saveFailed'));
    }
  };

  const onBreakdownPhoto = async (file) => {
    const dataUrl = await photoToProofDataUrl(file);
    if (dataUrl) setBreakdownForm((form) => ({ ...form, photo: dataUrl }));
  };

  const submitBreakdown = async () => {
    if (!breakdownForm.description.trim() || !detail) return;
    setSaving(true);
    try {
      await reportBreakdown(activeId, detail.machine.id, {
        description: breakdownForm.description,
        photo: breakdownForm.photo || null,
      });
      setBreakdownForm(null);
      setFlash(t('equipment.saved'));
      await load();
    } catch {
      setError(t('equipment.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const submitRepair = async () => {
    if (!repairForm.description.trim() || !detail) return;
    setSaving(true);
    try {
      await recordRepair(activeId, detail.machine.id, {
        description: repairForm.description,
        cost: repairForm.cost === '' ? null : repairForm.cost,
        outcome: repairForm.outcome,
        breakdown_id: repairForm.breakdown_id || null,
      });
      setRepairForm(null);
      setFlash(t('equipment.saved'));
      await load();
    } catch {
      setError(t('equipment.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const machines = overview?.machines || [];
  const due = overview?.due || [];
  const canManage = Boolean(overview?.canManage || detail?.canManage);
  const canReport = Boolean(overview?.canReport || detail?.canReport);
  const machine = detail?.machine || null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="no-print">
        <h1 className="text-2xl font-semibold">{t('equipment.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('equipment.subtitle')}</p>
        {canManage ? <p className="mt-2 text-xs text-muted-foreground">{t('equipment.manageHint')}</p> : null}
      </header>

      {flash ? <p className="no-print rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">{flash}</p> : null}
      {error ? <p className="no-print rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}

      {!selectedId ? (
        <div className="no-print space-y-6">
          <section className="rounded-xl border border-border p-4">
            <h2 className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" /> {t('equipment.dueTitle')}
              {overview?.openBreakdowns ? (
                <span className="text-xs text-muted-foreground">{t('equipment.openBreakdowns', { count: overview.openBreakdowns })}</span>
              ) : null}
            </h2>
            {due.length ? (
              <ul className="mt-2 space-y-1.5">
                {due.map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{t('equipment.dueLine', { task: task.title, machine: task.machine_name })}</span>
                    <span className={task.due_state === 'overdue' ? 'text-destructive' : 'text-warn'}>
                      {task.due_state === 'overdue' ? t('equipment.overdue') : t('equipment.dueSoon')}
                      {task.next_due_date ? ` · ${task.next_due_date}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t('equipment.allClear')}</p>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">{t('equipment.machinesTitle')}</h2>
              {canManage ? (
                <Button size="sm" onClick={() => { setEditingMachineId(null); setMachineForm(emptyMachineForm()); }}>
                  <Plus className="mr-1.5 h-4 w-4" /> {t('equipment.newMachine')}
                </Button>
              ) : null}
            </div>
            {!loading && machines.length === 0 ? (
              <div className="mt-3 rounded-xl border border-border p-4">
                <p className="font-medium">{t('equipment.emptyTitle')}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('equipment.emptyBody')}</p>
              </div>
            ) : null}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {machines.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => openMachine(m.id)}
                  className="rounded-xl border border-border p-4 text-left hover:bg-muted/50"
                >
                  <p className="font-medium">{m.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[m.kind, m.make_model, m.location_name].filter(Boolean).join(' · ')}
                  </p>
                  {m.warranty_end ? (
                    <p className="mt-1 text-xs text-muted-foreground">{t('equipment.warrantyUntil', { date: m.warranty_end })}</p>
                  ) : null}
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="no-print">
            <Button variant="ghost" size="sm" onClick={() => { setSelectedId(null); setDetail(null); }}>
              <ArrowLeft className="mr-1.5 h-4 w-4" /> {t('equipment.backButton')}
            </Button>
          </div>
          {machine ? (
            <>
              <section className="no-print rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">{machine.name}</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {[machine.kind, machine.make_model, machine.serial_number, machine.location_name].filter(Boolean).join(' · ')}
                    </p>
                    {machine.purchased_date ? <p className="mt-1 text-sm">{t('equipment.boughtOn', { date: machine.purchased_date })}</p> : null}
                    {machine.purchase_price != null ? (
                      <p className="mt-1 text-sm">{`${t('equipment.priceLabel')}: ${formatMoney(machine.purchase_price, record?.currency, 2)}`}</p>
                    ) : null}
                    {machine.warranty_end ? <p className="mt-1 text-sm">{t('equipment.warrantyUntil', { date: machine.warranty_end })}</p> : null}
                    {machine.service_name ? (
                      <p className="mt-1 text-sm">{t('equipment.servicedBy', { name: machine.service_name })}{machine.service_phone ? ` · ${machine.service_phone}` : ''}</p>
                    ) : null}
                    {machine.notes ? <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{machine.notes}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => window.print()}>
                      <Printer className="mr-1.5 h-4 w-4" /> {t('equipment.printButton')}
                    </Button>
                    {canManage ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingMachineId(machine.id);
                            setMachineForm({
                              name: machine.name || '', kind: machine.kind || '', make_model: machine.make_model || '',
                              serial_number: machine.serial_number || '', location_name: machine.location_name || '',
                              purchased_date: machine.purchased_date || '',
                              purchase_price: machine.purchase_price ?? '', warranty_end: machine.warranty_end || '',
                              service_name: machine.service_name || '', service_phone: machine.service_phone || '',
                              notes: machine.notes || '',
                            });
                          }}
                        >
                          <Pencil className="mr-1.5 h-4 w-4" /> {t('equipment.editMachine')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => removeMachine(machine)}>
                          <Trash2 className="mr-1.5 h-4 w-4" /> {t('equipment.deleteMachine')}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {canReport ? (
                    <Button size="sm" onClick={() => setBreakdownForm({ description: '', photo: null })}>
                      <AlertTriangle className="mr-1.5 h-4 w-4" /> {t('equipment.reportBreakdown')}
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button size="sm" variant="outline" onClick={() => setRepairForm({ description: '', cost: '', outcome: '', breakdown_id: '' })}>
                      <Wrench className="mr-1.5 h-4 w-4" /> {t('equipment.recordRepair')}
                    </Button>
                  ) : null}
                </div>
              </section>

              <section className="no-print rounded-xl border border-border p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">{t('equipment.upkeepTitle')}</h3>
                  {canManage ? (
                    <Button size="sm" variant="outline" onClick={() => setUpkeepForm({ title: '', cycle_days: 30, last_done_date: '' })}>
                      <Plus className="mr-1.5 h-4 w-4" /> {t('equipment.newUpkeep')}
                    </Button>
                  ) : null}
                </div>
                <ul className="mt-2 space-y-2">
                  {(detail.upkeep || []).map((task) => (
                    <li key={task.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>
                        {task.title}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {task.last_done_date ? `${t('equipment.lastDoneLabel')}: ${task.last_done_date} · ` : ''}
                          {task.next_due_date ? t('equipment.nextDueLabel', { date: task.next_due_date }) : ''}
                        </span>
                        {task.due_state !== 'ok' ? (
                          <span className={task.due_state === 'overdue' ? 'ml-2 text-xs text-destructive' : 'ml-2 text-xs text-warn'}>
                            {task.due_state === 'overdue' ? t('equipment.overdue') : t('equipment.dueSoon')}
                          </span>
                        ) : null}
                      </span>
                      {canManage ? (
                        <span className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => markDone(task)}>
                            <Check className="mr-1 h-3.5 w-3.5" /> {t('equipment.markDone')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => removeUpkeep(task)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="no-print rounded-xl border border-border p-4">
                <h3 className="font-medium">{t('equipment.historyTitle')}</h3>
                {(detail.events || []).length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">{t('equipment.noHistory')}</p>
                ) : (
                  <ul className="mt-2 space-y-3">
                    {(detail.events || []).map((event) => (
                      <li key={event.id} className="border-b border-border pb-3 text-sm last:border-0">
                        <p className="font-medium">
                          {event.kind === 'breakdown' ? t('equipment.reportBreakdown') : t('equipment.recordRepair')}
                          {event.kind === 'breakdown' ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {event.status === 'fixed' ? t('equipment.statusFixed') : t('equipment.statusOpen')}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 whitespace-pre-line">{event.description}</p>
                        {event.photo ? <img src={event.photo} alt="" className="mt-2 h-28 w-28 rounded object-cover" /> : null}
                        {event.outcome ? <p className="mt-0.5 text-muted-foreground">{event.outcome}</p> : null}
                        {event.cost != null ? (
                          <p className="mt-0.5">{`${t('equipment.costLabel')}: ${formatMoney(event.cost, record?.currency, 2)}`}</p>
                        ) : null}
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {event.kind === 'breakdown'
                            ? t('equipment.reportedBy', { name: event.reported_by_name || '', time: event.created_at ? formatDateTime(event.created_at) : '' })
                            : t('equipment.repairBy', { name: event.reported_by_name || '', time: event.created_at ? formatDateTime(event.created_at) : '' })}
                        </p>
                        {canManage && event.kind === 'breakdown' && event.status !== 'fixed' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => setRepairForm({ description: '', cost: '', outcome: '', breakdown_id: event.id })}
                          >
                            <Wrench className="mr-1.5 h-4 w-4" /> {t('equipment.recordRepair')}
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <EquipmentDoc machine={machine} upkeep={detail.upkeep || []} events={detail.events || []} business={record} docStyle={docStyle} />
              </section>
            </>
          ) : null}
        </div>
      )}

      <Dialog open={Boolean(machineForm)} onOpenChange={(open) => { if (!open) setMachineForm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingMachineId ? t('equipment.editMachine') : t('equipment.newMachine')}</DialogTitle>
          </DialogHeader>
          {machineForm ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['name', 'equipment.nameLabel', 'text'],
                ['kind', 'equipment.kindLabel', 'text'],
                ['make_model', 'equipment.makeModelLabel', 'text'],
                ['serial_number', 'equipment.serialLabel', 'text'],
                ['location_name', 'equipment.locationLabel', 'text'],
                ['purchased_date', 'equipment.boughtLabel', 'date'],
                ['purchase_price', 'equipment.priceLabel', 'number'],
                ['warranty_end', 'equipment.warrantyLabel', 'date'],
                ['service_name', 'equipment.serviceNameLabel', 'text'],
                ['service_phone', 'equipment.servicePhoneLabel', 'text'],
              ].map(([field, labelKey, type]) => (
                <div key={field} className="space-y-1">
                  <Label>{t(labelKey)}</Label>
                  <Input
                    type={type}
                    value={machineForm[field] ?? ''}
                    onChange={(e) => setMachineForm((form) => ({ ...form, [field]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="space-y-1 sm:col-span-2">
                <Label>{t('equipment.notesLabel')}</Label>
                <Input
                  value={machineForm.notes}
                  onChange={(e) => setMachineForm((form) => ({ ...form, notes: e.target.value }))}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={saveMachine} disabled={saving}>{t('equipment.saveMachine')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(upkeepForm)} onOpenChange={(open) => { if (!open) setUpkeepForm(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('equipment.newUpkeep')}</DialogTitle></DialogHeader>
          {upkeepForm ? (
            <div className="grid gap-3">
              <div className="space-y-1">
                <Label>{t('equipment.upkeepNameLabel')}</Label>
                <Input value={upkeepForm.title} onChange={(e) => setUpkeepForm((f) => ({ ...f, title: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('equipment.cycleLabel')}</Label>
                <Input type="number" min="1" value={upkeepForm.cycle_days} onChange={(e) => setUpkeepForm((f) => ({ ...f, cycle_days: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('equipment.lastDoneLabel')}</Label>
                <Input type="date" value={upkeepForm.last_done_date} onChange={(e) => setUpkeepForm((f) => ({ ...f, last_done_date: e.target.value }))} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={saveUpkeep} disabled={saving}>{t('equipment.saveMachine')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(breakdownForm)} onOpenChange={(open) => { if (!open) setBreakdownForm(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('equipment.reportBreakdown')}</DialogTitle></DialogHeader>
          {breakdownForm ? (
            <div className="grid gap-3">
              <div className="space-y-1">
                <Label>{t('equipment.breakdownWhatLabel')}</Label>
                <Input value={breakdownForm.description} onChange={(e) => setBreakdownForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('equipment.photoHint')}</Label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <Camera className="h-4 w-4" />
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => onBreakdownPhoto(e.target.files?.[0])} />
                  {breakdownForm.photo ? t('equipment.saved') : t('equipment.photoHint')}
                </label>
                {breakdownForm.photo ? <img src={breakdownForm.photo} alt="" className="h-28 w-28 rounded object-cover" /> : null}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={submitBreakdown} disabled={saving}>{t('equipment.submitReport')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(repairForm)} onOpenChange={(open) => { if (!open) setRepairForm(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('equipment.recordRepair')}</DialogTitle></DialogHeader>
          {repairForm ? (
            <div className="grid gap-3">
              <div className="space-y-1">
                <Label>{t('equipment.repairWhatLabel')}</Label>
                <Input value={repairForm.description} onChange={(e) => setRepairForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('equipment.costLabel')}</Label>
                <Input type="number" min="0" step="0.01" value={repairForm.cost} onChange={(e) => setRepairForm((f) => ({ ...f, cost: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('equipment.outcomeLabel')}</Label>
                <Input value={repairForm.outcome} onChange={(e) => setRepairForm((f) => ({ ...f, outcome: e.target.value }))} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={submitRepair} disabled={saving}>{t('equipment.saveRepair')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
