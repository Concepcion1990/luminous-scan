import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/i18n';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { orderedLocations } from '@/lib/locations';
import { GROUPINGS, PERIODS, REPORT_TYPES, reportDefinition } from '@/lib/reports';

const Field = ({ label, children }) => (
  <div className="space-y-1.5">
    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
    {children}
  </div>
);

export default function ReportControls({ value, onChange, locations, categories }) {
  const report = reportDefinition(value.reportId);
  const places = orderedLocations(locations);

  const pickReport = (reportId) => {
    const next = reportDefinition(reportId);
    onChange({
      reportId,
      groupBy: next.groups.includes(value.groupBy) ? value.groupBy : next.defaultGroup,
    });
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Field label={t('reports.fieldReport')}>
          <Select value={value.reportId} onValueChange={pickReport}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORT_TYPES.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t('reports.fieldGroupBy')}>
          <Select value={value.groupBy} onValueChange={(groupBy) => onChange({ groupBy })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {report.groups.map((group) => (
                <SelectItem key={group} value={group}>
                  {GROUPINGS[group]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={report.snapshot ? t('reports.fieldSnapshot') : t('reports.fieldPeriod')}>
          <Select
            value={report.snapshot ? 'now' : value.period}
            onValueChange={(period) => onChange({ period })}
            disabled={report.snapshot}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {report.snapshot ? (
                <SelectItem value="now">{t('reports.snapshotNow')}</SelectItem>
              ) : (
                PERIODS.map((period) => (
                  <SelectItem key={period.id} value={period.id}>
                    {period.label}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </Field>

        {!report.snapshot && value.period === 'custom' && (
          <>
            <Field label={t('reports.fieldFrom')}>
              <Input
                type="date"
                value={value.from}
                onChange={(event) => onChange({ from: event.target.value })}
              />
            </Field>
            <Field label={t('reports.fieldTo')}>
              <Input
                type="date"
                value={value.to}
                onChange={(event) => onChange({ to: event.target.value })}
              />
            </Field>
          </>
        )}

        <Field label={t('reports.fieldLocation')}>
          <Select
            value={value.locationId || 'all'}
            onValueChange={(next) =>
              onChange({
                locationId: next === 'all' ? '' : next,
                locationName: places.find(({ location }) => location.id === next)?.location.name || '',
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('reports.allLocations')}</SelectItem>
              {places.map(({ location, depth }) => (
                <SelectItem key={location.id} value={location.id}>
                  {'—'.repeat(depth)} {depth > 0 ? ' ' : ''}
                  {location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t('reports.fieldCategory')}>
          <Select
            value={value.category || 'all'}
            onValueChange={(next) => onChange({ category: next === 'all' ? '' : next })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('reports.allCategories')}</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{report.hint}</p>
    </section>
  );
}