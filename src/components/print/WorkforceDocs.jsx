import { t } from '@/lib/i18n';
import { formatBusinessDate, formatHhmm, formatTimeOnly } from '@/lib/dates';
import { weekdayLabel } from '@/lib/workforce';
import { docRootClass, docRootStyle } from '@/lib/docStyle';
import { DecoFooter, DecoHeader, DocFrame, PrintedAt } from './DocChrome';
import DocHeader from './DocHeader';

/**
 * The Workforce papers (the prints build, Nov 25, 2026): the
 * weekly staff schedule and the timesheet, printed from the
 * Workforce page as Studio documents. Each sheet shows exactly
 * what its screen shows — the schedule prints the people the
 * viewer can already see (the tab's candidates), the timesheet
 * prints the loaded clock entries — printing never widens
 * anyone's view of the record.
 */

const TH = 'border-b border-black pb-1 text-left font-mono text-[6.5pt] uppercase tracking-wide';
const TD = 'py-1 align-top text-[9pt]';

function Sheet({ business, docStyle, title, subtitle, children }) {
  return (
    <div
      className={`print-label print-page-break doc-root w-[180mm] bg-white p-2 text-black ${docRootClass(docStyle)}`}
      style={docRootStyle(docStyle, business?.brand_color)}
    >
      <DocFrame style={docStyle} brandColor={business?.brand_color} />
        <DecoHeader style={docStyle} className="mb-2" />
        <DocHeader business={business} title={title} subtitle={subtitle} style={docStyle} />
        {children}
        <DecoFooter style={docStyle} />
        <PrintedAt />
    </div>
  );
}

/** The weekly schedule: one row per person, one column per day. */
export function ScheduleDoc({ people = [], schedules = [], business, docStyle }) {
  const byPerson = new Map();
  for (const row of schedules) {
    if (!byPerson.has(row.staff_member_id)) byPerson.set(row.staff_member_id, new Map());
    byPerson.get(row.staff_member_id).set(Number(row.weekday), row);
  }
  const days = [0, 1, 2, 3, 4, 5, 6];
  return (
    <Sheet business={business} docStyle={docStyle} title={t('workforce.schedule.title')}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${TH} w-[22%]`}>{t('workforce.schedule.person')}</th>
            {days.map((day) => (
              <th key={day} className={TH}>{weekdayLabel(day)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((person) => {
            const week = byPerson.get(person.id);
            return (
              <tr key={person.id} className="border-b border-black/15">
                <td className={TD}>
                  <span className="font-semibold">{person.full_name}</span>
                  {person.role_name ? <span className="block text-[8pt]">{person.role_name}</span> : null}
                </td>
                {days.map((day) => {
                  const shift = week?.get(day);
                  return (
                    <td key={day} className={TD}>
                      {shift
                        ? `${formatHhmm(shift.start_time)} – ${formatHhmm(shift.end_time)}`
                        : t('workforce.schedule.off')}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Sheet>
  );
}

/** The timesheet: the loaded clock entries, breaks and flags included. */
export function TimesheetDoc({ entries = [], peopleById = {}, showNames = true, business, docStyle }) {
  const duration = (entry) => {
    if (!entry.clock_in_at || !entry.clock_out_at) return '';
    const breakMs = (entry.breaks || []).reduce((sum, rest) => {
      if (!rest.out_at || !rest.in_at) return sum;
      return sum + (new Date(rest.in_at).getTime() - new Date(rest.out_at).getTime());
    }, 0);
    const ms = Math.max(0, new Date(entry.clock_out_at).getTime() - new Date(entry.clock_in_at).getTime() - breakMs);
    const totalMinutes = Math.round(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const locale = undefined;
    const hourText = new Intl.NumberFormat(locale, { style: 'unit', unit: 'hour', unitDisplay: 'short' }).format(hours);
    if (!minutes) return hourText;
    const minuteText = new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'short' }).format(minutes);
    return `${hourText} ${minuteText}`;
  };
  const breakMinutes = (entry) => Math.round((entry.breaks || []).reduce((sum, rest) => {
    if (!rest.out_at || !rest.in_at) return sum;
    return sum + (new Date(rest.in_at).getTime() - new Date(rest.out_at).getTime()) / 60000;
  }, 0));
  const notes = (entry) => {
    const parts = [];
    if (entry.called_in) parts.push(t('workforce.entries.calledIn'));
    if (entry.unscheduled) parts.push(t('workforce.entries.unscheduled'));
    if (entry.missed_clock_out) parts.push(t('workforce.entries.missedClockOut'));
    if (entry.early_departure) parts.push(t('workforce.entries.early'));
    if (entry.early_note) parts.push(entry.early_note);
    return parts.join(' · ');
  };
  return (
    <Sheet business={business} docStyle={docStyle} title={t('print.timesheetTitle')}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {showNames ? <th className={`${TH} w-[18%]`}>{t('workforce.schedule.person')}</th> : null}
            <th className={TH}>{t('print.transferDate')}</th>
            <th className={TH}>{t('workforce.schedule.start')}</th>
            <th className={TH}>{t('workforce.schedule.end')}</th>
            <th className={TH}>{t('payroll.hours.breaks')}</th>
            <th className={TH}>{t('print.colHours')}</th>
            <th className={`${TH} w-[22%]`}>{t('print.colNotes')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-black/15">
              {showNames ? (
                <td className={`${TD} font-semibold`}>{peopleById[entry.staff_member_id]?.full_name || ''}</td>
              ) : null}
              <td className={TD}>{entry.clock_in_at ? formatBusinessDate(entry.clock_in_at, business) : ''}</td>
              <td className={TD}>{entry.clock_in_at ? formatTimeOnly(entry.clock_in_at) : '—'}</td>
              <td className={TD}>{entry.clock_out_at ? formatTimeOnly(entry.clock_out_at) : '—'}</td>
              <td className={TD}>{breakMinutes(entry) || '—'}</td>
              <td className={TD}>{duration(entry)}</td>
              <td className={TD}>{notes(entry)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Sheet>
  );
}
