import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
        <Field label="Report">
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

        <Field label="Group by">
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

        <Field label={report.snapshot ? 'Snapshot' : 'Period'}>
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
                <SelectItem value="now">Today, right now</SelectItem>
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
            <Field label="From">
              <Input
                type="date"
                value={value.from}
                onChange={(event) => onChange({ from: event.target.value })}
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={value.to}
                onChange={(event) => onChange({ to: event.target.value })}
              />
            </Field>
          </>
        )}

        <Field label="Location">
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
              <SelectItem value="all">All locations</SelectItem>
              {places.map(({ location, depth }) => (
                <SelectItem key={location.id} value={location.id}>
                  {'—'.repeat(depth)} {depth > 0 ? ' ' : ''}
                  {location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Category">
          <Select
            value={value.category || 'all'}
            onValueChange={(next) => onChange({ category: next === 'all' ? '' : next })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
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