import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarHeart, Check, Printer, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import EventSheetDoc from '@/components/print/EventSheetDoc';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';
import { useBusiness } from '@/hooks/useBusiness';
import { resolveDocStyle } from '@/lib/docStyle';
import { formatMoney } from '@/lib/inventory';
import { listRecipes } from '@/lib/recipes';
import {
  createCateringEvent,
  deleteCateringEvent,
  fetchCateringBook,
  fetchEventPrep,
  updateCateringEvent,
} from '@/lib/catering';
import { t } from '@/lib/i18n';

/**
 * Catering & private events, the simple version (plan
 * release 375, Nov 26, 2026): Business-only, Restaurant
 * Corner, Floor & Guests shelf. The event book — date,
 * party size, a menu picked from the business's own dishes,
 * deposit taken, balance due — and the one-page event sheet
 * (BEO) the kitchen and floor work from, printed from the
 * Document Style Studio. The staff copy hides the money:
 * deposits and balances are owner-only, on screen and on
 * paper. The event's food pulls into prep (the Prep page
 * reads the same feed), so a big party never ambushes the
 * walk-in. No contracts, no e-signatures — deliberately.
 */
const BLANK = {
  name: '', event_date: '', event_time: '', party_size: '', contact_name: '',
  contact_phone: '', status: 'booked', notes: '', menu: [], event_total: '', deposit: '',
};

export default function RestaurantCatering() {
  const { activeId, record, profile } = useBusiness();
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);
  const [view, setView] = useState(null);
  const [recipes, setRecipes] = useState([]);
  const [form, setForm] = useState(null);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [printJob, setPrintJob] = useState(null);

  const load = useCallback(async () => {
    if (!activeId) return;
    const [book, recipeList] = await Promise.all([
      fetchCateringBook(activeId),
      listRecipes(activeId || ''),
    ]);
    setView(book);
    setRecipes(recipeList || []);
  }, [activeId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const isOwner = Boolean(view?.isOwner);
  const canWrite = Boolean(view?.canWrite);
  const events = view?.events || [];
  const money = (value) => formatMoney(value, record?.currency, 2);
  const statusLabel = (status) => t(`catering.status${status === 'done' ? 'Done' : status === 'cancelled' ? 'Cancelled' : 'Booked'}`);

  const startNew = () => { setForm({ ...BLANK }); setError(''); };
  const startEdit = (event) => {
    setForm({
      id: event.id,
      name: event.name || '',
      event_date: event.event_date || '',
      event_time: event.event_time || '',
      party_size: String(event.party_size || ''),
      contact_name: event.contact_name || '',
      contact_phone: event.contact_phone || '',
      status: event.status || 'booked',
      notes: event.notes || '',
      menu: (event.menu || []).map((line) => ({ recipe_id: line.recipe_id, servings: String(line.servings) })),
      event_total: event.event_total === undefined ? '' : String(event.event_total),
      deposit: event.deposit === undefined ? '' : String(event.deposit),
    });
    setError('');
  };

  const setField = (key, value) => setForm((cur) => ({ ...cur, [key]: value }));
  const setMenuLine = (index, patch) => setForm((cur) => ({
    ...cur,
    menu: cur.menu.map((line, i) => (i === index ? { ...line, ...patch } : line)),
  }));

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        name: form.name,
        event_date: form.event_date,
        event_time: form.event_time,
        party_size: form.party_size === '' ? 0 : Number(form.party_size),
        contact_name: form.contact_name,
        contact_phone: form.contact_phone,
        status: form.status,
        notes: form.notes,
        menu: form.menu
          .filter((line) => line.recipe_id && Number(line.servings) > 0)
          .map((line) => ({ recipe_id: line.recipe_id, servings: Number(line.servings) })),
      };
      if (isOwner) {
        body.event_total = form.event_total === '' ? 0 : Number(form.event_total);
        body.deposit = form.deposit === '' ? 0 : Number(form.deposit);
      }
      if (form.id) await updateCateringEvent(activeId, form.id, body);
      else await createCateringEvent(activeId, body);
      setForm(null);
      setFlash(t('catering.saved'));
      await load();
    } catch { setError(t('catering.saveFailed')); } finally { setSaving(false); }
  };

  const remove = async (event) => {
    try {
      await deleteCateringEvent(activeId, event.id);
      if (form?.id === event.id) setForm(null);
      await load();
    } catch { setError(t('catering.saveFailed')); }
  };

  const printSheet = async (event, staffCopy) => {
    let prep = null;
    try {
      const data = await fetchEventPrep(activeId, event.id);
      prep = data.prep;
    } catch { prep = null; }
    const named = {
      ...event,
      menu: (event.menu || []).map((line) => ({
        ...line,
        name: line.name || recipes.find((r) => r.id === line.recipe_id)?.name || '',
      })),
    };
    setPrintJob({ event: named, prep, staffCopy });
    setTimeout(() => { window.print(); setPrintJob(null); }, 50);
  };

  return (
    <div className="space-y-6">
      <div className="no-print">
        <RestaurantCrumbs route="/restaurant/catering" />
      </div>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 flex items-center gap-2 text-2xl font-semibold sm:text-[28px]">
            <CalendarHeart className="h-6 w-6" /> {t('catering.title')}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('catering.subtitle')}</p>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t('catering.ownerOnlyNote')}</p>
        </div>
        {canWrite ? (
          <Button onClick={startNew}>{t('catering.newEvent')}</Button>
        ) : null}
      </div>

      {flash ? (
        <p className="no-print flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      ) : null}
      {error ? <p className="no-print rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}

      {form ? (
        <section className="no-print space-y-3 rounded-xl border border-border p-4">
          <h2 className="font-medium">{form.id ? t('catering.editEvent') : t('catering.newEvent')}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('catering.nameLabel')}</Label>
              <Input value={form.name} onChange={(e) => setField('name', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('catering.contactLabel')}</Label>
              <Input value={form.contact_name} onChange={(e) => setField('contact_name', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('catering.dateLabel')}</Label>
              <Input type="date" value={form.event_date} onChange={(e) => setField('event_date', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('catering.timeLabel')}</Label>
              <Input type="time" value={form.event_time} onChange={(e) => setField('event_time', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('catering.partySizeLabel')}</Label>
              <Input type="number" min="1" step="1" value={form.party_size} onChange={(e) => setField('party_size', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('catering.phoneLabel')}</Label>
              <Input value={form.contact_phone} onChange={(e) => setField('contact_phone', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('catering.statusLabel')}</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.status}
                onChange={(e) => setField('status', e.target.value)}
              >
                <option value="booked">{t('catering.statusBooked')}</option>
                <option value="done">{t('catering.statusDone')}</option>
                <option value="cancelled">{t('catering.statusCancelled')}</option>
              </select>
            </div>
            {isOwner ? (
              <>
                <div className="space-y-1">
                  <Label>{t('catering.totalLabel')}</Label>
                  <Input type="number" min="0" step="0.01" value={form.event_total} onChange={(e) => setField('event_total', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>{t('catering.depositLabel')}</Label>
                  <Input type="number" min="0" step="0.01" value={form.deposit} onChange={(e) => setField('deposit', e.target.value)} />
                </div>
              </>
            ) : null}
            <div className="space-y-1 sm:col-span-2">
              <Label>{t('catering.notesLabel')}</Label>
              <Input value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t('catering.menuTitle')}</h3>
            {form.menu.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('catering.noDishes')}</p>
            ) : form.menu.map((line, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <select
                  className="min-w-48 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={line.recipe_id}
                  onChange={(e) => setMenuLine(index, { recipe_id: e.target.value })}
                >
                  <option value="" />
                  {recipes.map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>{recipe.name}</option>
                  ))}
                </select>
                <div className="space-y-1">
                  <Label>{t('catering.servingsLabel')}</Label>
                  <Input
                    type="number" min="0" step="1" className="w-28"
                    value={line.servings}
                    onChange={(e) => setMenuLine(index, { servings: e.target.value })}
                  />
                </div>
                <Button
                  variant="outline" size="sm"
                  onClick={() => setForm((cur) => ({ ...cur, menu: cur.menu.filter((_, i) => i !== index) }))}
                >
                  {t('catering.removeDish')}
                </Button>
              </div>
            ))}
            <Button
              variant="outline" size="sm"
              onClick={() => setForm((cur) => ({ ...cur, menu: [...cur.menu, { recipe_id: '', servings: '' }] }))}
            >
              {t('catering.addDish')}
            </Button>
          </div>

          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>{t('catering.saveEvent')}</Button>
            <Button variant="outline" onClick={() => setForm(null)}>{t('alerts.cancel')}</Button>
          </div>
        </section>
      ) : null}

      <section className="no-print space-y-3">
        <h2 className="text-base font-semibold">{t('catering.bookTitle')}</h2>
        {!view ? (
          <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
        ) : events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <CalendarHeart className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">{t('catering.emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('catering.emptyBody')}</p>
          </div>
        ) : (
          events.map((event) => (
            <div key={event.id} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{event.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t('catering.guestsLine', { count: event.party_size, date: event.event_date })}
                  {event.event_time ? ` · ${event.event_time}` : ''} · {statusLabel(event.status)}
                </p>
              </div>
              {(event.menu || []).length ? (
                <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                  {event.menu.map((line) => (
                    <li key={line.recipe_id} className="flex justify-between gap-3">
                      <span>{line.name}</span>
                      <span>{`${line.servings} ${t('catering.servingsLabel')}`}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">{t('catering.noDishes')}</p>
              )}
              {isOwner ? (
                <p className="mt-2 text-sm">
                  {`${t('catering.totalLabel')}: ${money(event.event_total)} · ${t('catering.depositLabel')}: ${money(event.deposit)} · ${t('catering.balanceLabel')}: ${money(event.balance_due)}`}
                </p>
              ) : null}
              {event.notes ? <p className="mt-1 text-sm text-muted-foreground">{event.notes}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {isOwner ? (
                  <Button size="sm" variant="outline" onClick={() => printSheet(event, false)}>
                    <Printer className="mr-1.5 h-4 w-4" /> {t('catering.printOwnerSheet')}
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => printSheet(event, true)}>
                  <Printer className="mr-1.5 h-4 w-4" /> {t('catering.printStaffSheet')}
                </Button>
                {canWrite ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => startEdit(event)}>{t('recipes.editButton')}</Button>
                    <Button size="sm" variant="outline" onClick={() => remove(event)}>
                      <Trash2 className="mr-1.5 h-4 w-4" /> {t('catering.deleteEvent')}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ))
        )}
      </section>

      {printJob ? (
        <div className="print-area hidden print:block">
          <EventSheetDoc
            event={printJob.event}
            prep={printJob.prep}
            staffCopy={printJob.staffCopy}
            business={record}
            docStyle={docStyle}
          />
        </div>
      ) : null}
    </div>
  );
}
