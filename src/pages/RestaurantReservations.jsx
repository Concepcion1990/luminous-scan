import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CalendarCheck, Check, Printer, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ReservationListDoc from '@/components/print/ReservationListDoc';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';
import { useBusiness } from '@/hooks/useBusiness';
import { resolveDocStyle } from '@/lib/docStyle';
import { formatMoney } from '@/lib/inventory';
import {
  createReservation,
  createWaitlistEntry,
  deleteReservation,
  fetchReservationBook,
  fetchWaitlist,
  notifyWaitlistReady,
  sendReservationsDigest,
  updateReservation,
  updateWaitlistEntry,
} from '@/lib/reservations';
import { t } from '@/lib/i18n';

/**
 * Reservations & waitlist (plan release 376 + riders,
 * Nov 26, 2026): Business-only, Restaurant Corner, Floor
 * & Guests shelf. The reservation BOOK — date and time,
 * party name and size, phone, a table or section in the
 * owner's own words, where it came from, its status, its
 * notes — in day and week views, with today's list on the
 * Today page and a one-tap digest to the whole team
 * through team messaging. Below the book, tonight's
 * WAITLIST: the living queue with the wait each party was
 * quoted, and the one-tap "your table is ready" word.
 *
 * Honest boundaries, in the shape: a book, not a live
 * floor — no minute-to-minute table state, no online
 * booking. Taking reservations is HOST work (owner,
 * manager, or the owner's host tick). Guest reminders go
 * ONLY to guests who said yes (Q6): by email, live, and
 * by text behind the texting keyset — while that keyset
 * is absent the page says texting is not available yet
 * and no text is ever marked sent. The deposit line is a
 * record of money already taken, never a payment.
 */
const localDate = (d = new Date()) => d.toLocaleDateString('en-CA');
const addDays = (dateStr, days) => {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
};

const BLANK_BOOKING = {
  res_date: '', res_time: '', party_name: '', party_size: '', phone: '', email: '',
  table_label: '', source: 'phone', status: 'booked', notes: '',
  deposit_amount: '', deposit_how: '', reminder_opt_in: false,
};
const BLANK_ENTRY = { party_name: '', party_size: '', phone: '', email: '', quoted_wait_minutes: '' };

export default function RestaurantReservations() {
  const { activeId, record, profile } = useBusiness();
  const docStyle = useMemo(() => resolveDocStyle(profile), [profile]);
  const [book, setBook] = useState(null);
  const [queue, setQueue] = useState(null);
  const [viewMode, setViewMode] = useState('day');
  const [date, setDate] = useState(() => localDate());
  const [form, setForm] = useState(null);
  const [entryForm, setEntryForm] = useState(null);
  const [flash, setFlash] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [printJob, setPrintJob] = useState(null);

  const range = useMemo(() => (
    viewMode === 'day'
      ? { from: date, to: date }
      : { from: date, to: addDays(date, 6) }
  ), [viewMode, date]);

  const load = useCallback(async () => {
    if (!activeId) return;
    const [bookData, queueData] = await Promise.all([
      fetchReservationBook(activeId, range.from, range.to),
      fetchWaitlist(activeId),
    ]);
    setBook(bookData);
    setQueue(queueData);
  }, [activeId, range]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const canHost = Boolean(book?.canHost);
  const textAvailable = Boolean(book?.textAvailable);
  const reservations = book?.reservations || [];
  const entries = queue?.entries || [];
  const waiting = entries.filter((e) => e.status === 'waiting');
  const money = (value) => formatMoney(value, record?.currency, 2);
  const statusLabel = (status) => t(`reservations.status${status === 'seated' ? 'Seated' : status === 'no-show' ? 'NoShow' : status === 'cancelled' ? 'Cancelled' : 'Booked'}`);
  const waitlistStatusLabel = (status) => (status === 'dropped'
    ? t('waitlist.statusDropped')
    : status === 'waiting' ? t('waitlist.statusWaiting') : statusLabel(status));

  const days = useMemo(() => {
    if (viewMode === 'day') return [date];
    return Array.from({ length: 7 }, (_, i) => addDays(date, i));
  }, [viewMode, date]);

  /* ------------------------------------------------ the book */

  const startNew = () => { setForm({ ...BLANK_BOOKING, res_date: date }); setError(''); };
  const startEdit = (r) => {
    setForm({
      id: r.id,
      res_date: r.res_date || '',
      res_time: r.res_time || '',
      party_name: r.party_name || '',
      party_size: String(r.party_size || ''),
      phone: r.phone || '',
      email: r.email || '',
      table_label: r.table_label || '',
      source: r.source || 'phone',
      status: r.status || 'booked',
      notes: r.notes || '',
      deposit_amount: r.deposit_amount ? String(r.deposit_amount) : '',
      deposit_how: r.deposit_how || '',
      reminder_opt_in: Boolean(r.reminder_opt_in),
    });
    setError('');
  };
  const setField = (key, value) => setForm((cur) => ({ ...cur, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        res_date: form.res_date,
        res_time: form.res_time,
        party_name: form.party_name,
        party_size: form.party_size === '' ? 0 : Number(form.party_size),
        phone: form.phone,
        email: form.email,
        table_label: form.table_label,
        source: form.source,
        status: form.status,
        notes: form.notes,
        deposit_amount: form.deposit_amount === '' ? 0 : Number(form.deposit_amount),
        deposit_how: form.deposit_how,
        reminder_opt_in: Boolean(form.reminder_opt_in),
      };
      if (form.id) await updateReservation(activeId, form.id, body);
      else await createReservation(activeId, body);
      setForm(null);
      setFlash(t('reservations.saved'));
      await load();
    } catch { setError(t('reservations.saveFailed')); } finally { setSaving(false); }
  };

  const setStatus = async (r, status) => {
    try {
      await updateReservation(activeId, r.id, { ...r, status });
      await load();
    } catch { setError(t('reservations.saveFailed')); }
  };

  const remove = async (r) => {
    try {
      await deleteReservation(activeId, r.id);
      if (form?.id === r.id) setForm(null);
      await load();
    } catch { setError(t('reservations.saveFailed')); }
  };

  const digest = async () => {
    try {
      await sendReservationsDigest(activeId, localDate());
      setFlash(t('reservations.digestSent'));
    } catch { setError(t('reservations.saveFailed')); }
  };

  const printDay = (day) => {
    setPrintJob({ date: day, reservations: reservations.filter((r) => r.res_date === day) });
    setTimeout(() => { window.print(); setPrintJob(null); }, 50);
  };

  /* ------------------------------------------------ the queue */

  const saveEntry = async () => {
    setSaving(true);
    try {
      await createWaitlistEntry(activeId, {
        party_name: entryForm.party_name,
        party_size: entryForm.party_size === '' ? 0 : Number(entryForm.party_size),
        phone: entryForm.phone,
        email: entryForm.email,
        quoted_wait_minutes: entryForm.quoted_wait_minutes === '' ? 0 : Number(entryForm.quoted_wait_minutes),
        status: 'waiting',
      });
      setEntryForm(null);
      setFlash(t('waitlist.saved'));
      await load();
    } catch { setError(t('waitlist.saveFailed')); } finally { setSaving(false); }
  };

  const setEntryStatus = async (entry, status) => {
    try {
      await updateWaitlistEntry(activeId, entry.id, { ...entry, status });
      await load();
    } catch { setError(t('waitlist.saveFailed')); }
  };

  const tellReady = async (entry) => {
    try {
      const result = await notifyWaitlistReady(activeId, entry.id);
      if (result.outcome?.text === 'sent') setFlash(t('waitlist.readySentText'));
      else if (result.outcome?.email === 'sent') setFlash(t('waitlist.readySentEmail'));
      else setFlash(t('waitlist.readyNotAvailable'));
      await load();
    } catch { setError(t('waitlist.saveFailed')); }
  };

  const bookingRow = (r) => (
    <div key={r.id} className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {r.res_time ? `${r.res_time} · ` : ''}{r.party_name}
          {r.table_label ? <span className="text-muted-foreground">{` · ${r.table_label}`}</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('reservations.guestsLine', { count: r.party_size, date: r.res_date })}
          {` · ${statusLabel(r.status)} · ${r.source === 'walk-in' ? t('reservations.sourceWalkin') : t('reservations.sourcePhone')}`}
        </p>
      </div>
      {r.notes ? <p className="mt-1 text-sm text-muted-foreground">{r.notes}</p> : null}
      <p className="mt-1 text-xs text-muted-foreground">
        {r.reminder_opt_in
          ? `${t('reservations.remindersOn')}${r.reminder_email_sent_at || r.reminder_text_sent_at ? ` · ${t('reservations.reminderSent')}` : ''}`
          : t('reservations.remindersOff')}
        {Number(r.deposit_amount) > 0
          ? ` · ${t('reservations.depositLabel')}: ${money(r.deposit_amount)}${r.deposit_how ? ` (${r.deposit_how})` : ''}`
          : ''}
      </p>
      {canHost ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.status === 'booked' ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setStatus(r, 'seated')}>{t('reservations.statusSeated')}</Button>
              <Button size="sm" variant="outline" onClick={() => setStatus(r, 'no-show')}>{t('reservations.statusNoShow')}</Button>
              <Button size="sm" variant="outline" onClick={() => setStatus(r, 'cancelled')}>{t('reservations.statusCancelled')}</Button>
            </>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => startEdit(r)}>{t('recipes.editButton')}</Button>
          <Button size="sm" variant="outline" onClick={() => remove(r)}>
            <Trash2 className="mr-1.5 h-4 w-4" /> {t('reservations.deleteBooking')}
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="no-print">
        <RestaurantCrumbs route="/restaurant/reservations" />
      </div>
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('restaurant.eyebrow')}
          </p>
          <h1 className="mt-1.5 flex items-center gap-2 text-2xl font-semibold sm:text-[28px]">
            <CalendarCheck className="h-6 w-6" /> {t('reservations.title')}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('reservations.subtitle')}</p>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t('reservations.bookNote')}</p>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t('reservations.hostNote')}</p>
          {!textAvailable ? (
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">{t('reservations.textNotAvailable')}</p>
          ) : null}
        </div>
        {canHost ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={digest}>
              <Send className="mr-1.5 h-4 w-4" /> {t('reservations.digestButton')}
            </Button>
            <Button onClick={startNew}>{t('reservations.newBooking')}</Button>
          </div>
        ) : null}
      </div>

      {flash ? (
        <p className="no-print flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      ) : null}
      {error ? <p className="no-print rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">{error}</p> : null}

      <div className="no-print flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>{t('reservations.dateLabel')}</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button variant={viewMode === 'day' ? 'default' : 'outline'} onClick={() => setViewMode('day')}>{t('reservations.dayView')}</Button>
          <Button variant={viewMode === 'week' ? 'default' : 'outline'} onClick={() => setViewMode('week')}>{t('reservations.weekView')}</Button>
          <Button variant="outline" onClick={() => printDay(date)}>
            <Printer className="mr-1.5 h-4 w-4" /> {t('reservations.printButton')}
          </Button>
        </div>
      </div>

      {form ? (
        <section className="no-print space-y-3 rounded-xl border border-border p-4">
          <h2 className="font-medium">{form.id ? t('reservations.editBooking') : t('reservations.newBooking')}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{t('reservations.nameLabel')}</Label>
              <Input value={form.party_name} onChange={(e) => setField('party_name', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('reservations.tableLabel')}</Label>
              <Input value={form.table_label} onChange={(e) => setField('table_label', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('reservations.dateLabel')}</Label>
              <Input type="date" value={form.res_date} onChange={(e) => setField('res_date', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('reservations.timeLabel')}</Label>
              <Input type="time" value={form.res_time} onChange={(e) => setField('res_time', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('reservations.partySizeLabel')}</Label>
              <Input type="number" min="1" step="1" value={form.party_size} onChange={(e) => setField('party_size', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('reservations.sourceLabel')}</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.source}
                onChange={(e) => setField('source', e.target.value)}
              >
                <option value="phone">{t('reservations.sourcePhone')}</option>
                <option value="walk-in">{t('reservations.sourceWalkin')}</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t('reservations.phoneLabel')}</Label>
              <Input value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('reservations.emailLabel')}</Label>
              <Input value={form.email} onChange={(e) => setField('email', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('reservations.statusLabel')}</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.status}
                onChange={(e) => setField('status', e.target.value)}
              >
                <option value="booked">{t('reservations.statusBooked')}</option>
                <option value="seated">{t('reservations.statusSeated')}</option>
                <option value="no-show">{t('reservations.statusNoShow')}</option>
                <option value="cancelled">{t('reservations.statusCancelled')}</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t('reservations.depositLabel')}</Label>
              <Input type="number" min="0" step="0.01" value={form.deposit_amount} onChange={(e) => setField('deposit_amount', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('reservations.depositHowLabel')}</Label>
              <Input value={form.deposit_how} onChange={(e) => setField('deposit_how', e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>{t('reservations.notesLabel')}</Label>
              <Input value={form.notes} onChange={(e) => setField('notes', e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('reservations.depositNote')}</p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={Boolean(form.reminder_opt_in)}
              onChange={(e) => setField('reminder_opt_in', e.target.checked)}
            />
            <span>
              {t('reservations.reminderAsk')}
              <span className="block text-xs text-muted-foreground">{t('reservations.reminderHint')}</span>
            </span>
          </label>
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>{t('reservations.saveBooking')}</Button>
            <Button variant="outline" onClick={() => setForm(null)}>{t('alerts.cancel')}</Button>
          </div>
        </section>
      ) : null}

      <section className="no-print space-y-3">
        {!book ? (
          <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
        ) : reservations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <CalendarCheck className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">{t('reservations.emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('reservations.emptyBody')}</p>
          </div>
        ) : (
          days.map((day) => {
            const dayRows = reservations.filter((r) => r.res_date === day);
            if (viewMode === 'week' && !dayRows.length) return null;
            return (
              <div key={day} className="space-y-3">
                {viewMode === 'week' ? <h2 className="text-base font-semibold">{day}</h2> : null}
                {dayRows.map(bookingRow)}
              </div>
            );
          })
        )}
      </section>

      <section className="no-print space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Bell className="h-5 w-5" /> {t('waitlist.title')}
            </h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('waitlist.subtitle')}</p>
          </div>
          {canHost ? (
            <Button variant="outline" onClick={() => { setEntryForm({ ...BLANK_ENTRY }); setError(''); }}>
              {t('waitlist.addButton')}
            </Button>
          ) : null}
        </div>

        {entryForm ? (
          <div className="space-y-3 rounded-xl border border-border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('reservations.nameLabel')}</Label>
                <Input value={entryForm.party_name} onChange={(e) => setEntryForm((c) => ({ ...c, party_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('reservations.partySizeLabel')}</Label>
                <Input type="number" min="1" step="1" value={entryForm.party_size} onChange={(e) => setEntryForm((c) => ({ ...c, party_size: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('reservations.phoneLabel')}</Label>
                <Input value={entryForm.phone} onChange={(e) => setEntryForm((c) => ({ ...c, phone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('reservations.emailLabel')}</Label>
                <Input value={entryForm.email} onChange={(e) => setEntryForm((c) => ({ ...c, email: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>{t('waitlist.quotedLabel')}</Label>
                <Input type="number" min="0" step="1" value={entryForm.quoted_wait_minutes} onChange={(e) => setEntryForm((c) => ({ ...c, quoted_wait_minutes: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={saveEntry} disabled={saving}>{t('waitlist.addButton')}</Button>
              <Button variant="outline" onClick={() => setEntryForm(null)}>{t('alerts.cancel')}</Button>
            </div>
          </div>
        ) : null}

        {!queue ? (
          <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <p className="text-sm font-medium">{t('waitlist.emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('waitlist.emptyBody')}</p>
          </div>
        ) : (
          <>
            {waiting.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{entry.party_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('waitlist.partyLine', { count: entry.party_size, minutes: entry.quoted_wait_minutes })}
                  </p>
                </div>
                {canHost ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => tellReady(entry)}>
                      <Bell className="mr-1.5 h-4 w-4" /> {t('waitlist.readyButton')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEntryStatus(entry, 'seated')}>{t('reservations.statusSeated')}</Button>
                    <Button size="sm" variant="outline" onClick={() => setEntryStatus(entry, 'no-show')}>{t('reservations.statusNoShow')}</Button>
                    <Button size="sm" variant="outline" onClick={() => setEntryStatus(entry, 'dropped')}>{t('waitlist.statusDropped')}</Button>
                  </div>
                ) : null}
              </div>
            ))}
            {entries.filter((e) => e.status !== 'waiting').map((entry) => (
              <div key={entry.id} className="rounded-xl border border-border p-4 opacity-70">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{entry.party_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {`${waitlistStatusLabel(entry.status)} · ${t('waitlist.partyLine', { count: entry.party_size, minutes: entry.quoted_wait_minutes })}`}
                    {entry.ready_channel ? ` · ${entry.ready_channel === 'text' ? t('waitlist.readySentText') : t('waitlist.readySentEmail')}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      {printJob ? (
        <div className="print-area hidden print:block">
          <ReservationListDoc
            date={printJob.date}
            reservations={printJob.reservations}
            business={record}
            docStyle={docStyle}
          />
        </div>
      ) : null}
    </div>
  );
}
