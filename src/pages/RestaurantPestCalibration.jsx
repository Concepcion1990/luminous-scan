import { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/client';
import { Bug, Check, FileText, Plus, Thermometer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
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
import { scoped, withBusiness } from '@/lib/scoped';
import { formatDateTime } from '@/lib/dates';
import { attachPestReport, calibrationOutcome, pestReportFileUrl } from '@/lib/foodSafety';
import { t } from '@/lib/i18n';
import RestaurantCrumbs from '@/components/restaurant/RestaurantCrumbs';

/**
 * Pest-control log + thermometer calibration log (plan
 * Part 7, owner-ruled addition G-B, Nov 26, 2026): the
 * food-safety family's two new logs, on one page of the
 * Food Safety shelf. One line per pest-service visit —
 * date, company, technician, areas treated, findings,
 * next visit due — with the pest company's own report
 * filed with the visit the documents way. And the
 * ice-point checks: date, which thermometer, the reading,
 * initials — pass at 32 °F / 0 °C, adjusted otherwise —
 * the record that vouches for the temperature logs. Both
 * logs print inside the inspection-ready packet. Anyone
 * on the team can log: these are daily logs.
 */
const FILE_TYPES = [
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/rtf',
  'text/rtf',
  'application/vnd.oasis.opendocument.text',
  'image/png',
  'image/jpeg',
  'image/webp',
];
const FILE_TYPE_BY_EXTENSION = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
const FILE_ACCEPT = ['.pdf', '.txt', '.doc', '.docx', '.rtf', '.odt', '.png', '.jpg', '.jpeg', '.webp', ...FILE_TYPES].join(',');

function fileTypeOf(file) {
  if (file.type && FILE_TYPES.includes(file.type)) return file.type;
  const extension = String(file.name || '').split('.').pop()?.toLowerCase();
  return FILE_TYPE_BY_EXTENSION[extension] || null;
}

function readAsDataUrl(file, mime) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) return reject(new Error('read_failed'));
      resolve(`data:${mime};base64,${result.slice(comma + 1)}`);
    };
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

export default function RestaurantPestCalibration() {
  const { activeId } = useBusiness();
  const [visits, setVisits] = useState([]);
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [flash, setFlash] = useState(null);
  const [pestOpen, setPestOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);

  // Pest visit form
  const today = new Date().toISOString().slice(0, 10);
  const [visitDate, setVisitDate] = useState(today);
  const [company, setCompany] = useState('');
  const [technician, setTechnician] = useState('');
  const [areas, setAreas] = useState('');
  const [findings, setFindings] = useState('');
  const [nextVisit, setNextVisit] = useState('');
  const [reportFile, setReportFile] = useState(null);
  const [pestError, setPestError] = useState('');
  const [pestSaving, setPestSaving] = useState(false);
  const fileInputRef = useRef(null);

  // Calibration form
  const [thermometer, setThermometer] = useState('');
  const [reading, setReading] = useState('');
  const [unit, setUnit] = useState('F');
  const [initials, setInitials] = useState('');
  const [calError, setCalError] = useState('');
  const [calSaving, setCalSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [visitPage, checkPage] = await Promise.all([
        base44.entities.PestVisit.filter(scoped({}, activeId), { sort: '-created_date', limit: 300 }),
        base44.entities.CalibrationLog.filter(scoped({}, activeId), { sort: '-created_date', limit: 300 }),
      ]);
      setVisits(visitPage.items ?? []);
      setChecks(checkPage.items ?? []);
      setLoading(false);
    })();
  }, [activeId, reload]);

  const savePest = async () => {
    setPestError('');
    if (!company.trim()) {
      setPestError(t('apiErrors.pestCal.companyNeeded'));
      return;
    }
    setPestSaving(true);
    try {
      const created = await base44.entities.PestVisit.create(
        withBusiness(
          {
            visit_date: visitDate || '',
            company: company.trim(),
            technician: technician.trim(),
            areas_treated: areas.trim(),
            findings: findings.trim(),
            next_visit_on: nextVisit || '',
          },
          activeId,
        ),
      );
      if (reportFile && created?.id) {
        const mime = fileTypeOf(reportFile);
        if (!mime || reportFile.size > 25 * 1024 * 1024) {
          throw new Error(t('staff.documents.fileInvalid'));
        }
        const dataUrl = await readAsDataUrl(reportFile, mime);
        await attachPestReport(activeId, created.id, { dataUrl, filename: reportFile.name });
      }
      setPestOpen(false);
      setCompany('');
      setTechnician('');
      setAreas('');
      setFindings('');
      setNextVisit('');
      setReportFile(null);
      setFlash(t('pestCal.pestSaved', { company: company.trim() }));
      setReload((n) => n + 1);
    } catch (e) {
      setPestError(e.message || t('pestCal.saveFailed'));
    } finally {
      setPestSaving(false);
    }
  };

  const calOutcome = reading !== '' ? calibrationOutcome(Number(reading), unit) : null;

  const saveCal = async () => {
    setCalError('');
    if (!thermometer.trim()) {
      setCalError(t('apiErrors.pestCal.thermometerNeeded'));
      return;
    }
    if (reading === '' || !Number.isFinite(Number(reading)) || !initials.trim()) {
      setCalError(t('apiErrors.pestCal.invalid'));
      return;
    }
    setCalSaving(true);
    try {
      await base44.entities.CalibrationLog.create(
        withBusiness(
          {
            thermometer_name: thermometer.trim(),
            reading: Number(reading),
            unit,
            outcome: calOutcome,
            initials: initials.trim(),
          },
          activeId,
        ),
      );
      setCalOpen(false);
      setFlash(t('pestCal.calSaved', { thermometer: thermometer.trim() }));
      setThermometer('');
      setReading('');
      setInitials('');
      setReload((n) => n + 1);
    } catch (e) {
      setCalError(e.message || t('pestCal.saveFailed'));
    } finally {
      setCalSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <RestaurantCrumbs route="/restaurant/pest-calibration" />
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('restaurant.eyebrow')}
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold sm:text-[28px]">{t('pestCal.title')}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('pestCal.subtitle')}</p>
      </div>

      {flash && (
        <p className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {flash}
        </p>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Bug className="h-5 w-5" /> {t('pestCal.pestTitle')}
          </h2>
          <Button onClick={() => setPestOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> {t('pestCal.addPest')}
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
        ) : visits.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <p className="mx-auto max-w-md text-sm text-muted-foreground">{t('pestCal.pestEmpty')}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-3 py-2 font-medium">{t('pestCal.date')}</th>
                  <th className="px-3 py-2 font-medium">{t('pestCal.company')}</th>
                  <th className="px-3 py-2 font-medium">{t('pestCal.areas')}</th>
                  <th className="px-3 py-2 font-medium">{t('pestCal.findings')}</th>
                  <th className="px-3 py-2 font-medium">{t('pestCal.nextVisit')}</th>
                  <th className="px-3 py-2 font-medium">{t('pestCal.report')}</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((visit) => (
                  <tr key={visit.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2">{visit.visit_date || (visit.created_date ? formatDateTime(visit.created_date) : '')}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{visit.company}</span>
                      {visit.technician ? <span className="block text-xs text-muted-foreground">{visit.technician}</span> : null}
                    </td>
                    <td className="px-3 py-2">{visit.areas_treated}</td>
                    <td className="px-3 py-2">{visit.findings}</td>
                    <td className="px-3 py-2">{visit.next_visit_on || ''}</td>
                    <td className="px-3 py-2">
                      {visit.has_report ? (
                        <a className="inline-flex items-center gap-1 underline" href={pestReportFileUrl(activeId, visit.id)} target="_blank" rel="noreferrer">
                          <FileText className="h-4 w-4" /> {visit.report_filename || t('pestCal.report')}
                        </a>
                      ) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Thermometer className="h-5 w-5" /> {t('pestCal.calTitle')}
          </h2>
          <Button onClick={() => setCalOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> {t('pestCal.addCal')}
          </Button>
        </div>
        <p className="max-w-xl text-sm text-muted-foreground">{t('pestCal.iceNote')}</p>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('restaurant.loading')}</p>
        ) : checks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <p className="mx-auto max-w-md text-sm text-muted-foreground">{t('pestCal.calEmpty')}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-3 py-2 font-medium">{t('ops.tempLogs.colWhen')}</th>
                  <th className="px-3 py-2 font-medium">{t('pestCal.thermometer')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('ops.tempLogs.colReading')}</th>
                  <th className="px-3 py-2 font-medium">{t('pestCal.outcome')}</th>
                  <th className="px-3 py-2 font-medium">{t('pestCal.initials')}</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((check) => (
                  <tr key={check.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2">{check.created_date ? formatDateTime(check.created_date) : ''}</td>
                    <td className="px-3 py-2">{check.thermometer_name}</td>
                    <td className="px-3 py-2 text-right">{check.reading}°{check.unit || 'F'}</td>
                    <td className="px-3 py-2">
                      {check.outcome === 'pass' ? (
                        <span className="rounded-full bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">{t('pestCal.pass')}</span>
                      ) : (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{t('pestCal.adjusted')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{check.initials}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={pestOpen} onOpenChange={setPestOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('pestCal.pestTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('pestCal.date')}</Label>
                <Input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('pestCal.nextVisit')}</Label>
                <Input type="date" value={nextVisit} onChange={(e) => setNextVisit(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('pestCal.company')}</Label>
                <Input value={company} onChange={(e) => setCompany(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('pestCal.technician')}</Label>
                <Input value={technician} onChange={(e) => setTechnician(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('pestCal.areas')}</Label>
              <Textarea value={areas} onChange={(e) => setAreas(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('pestCal.findings')}</Label>
              <Textarea value={findings} onChange={(e) => setFindings(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('pestCal.report')}</Label>
              <Input
                ref={fileInputRef}
                type="file"
                accept={FILE_ACCEPT}
                onChange={(e) => setReportFile(e.target.files?.[0] || null)}
              />
            </div>
            {pestError && <p className="text-sm text-destructive">{pestError}</p>}
          </div>
          <DialogFooter>
            <Button onClick={savePest} disabled={pestSaving}>{t('pestCal.addPest')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={calOpen} onOpenChange={setCalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('pestCal.calTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('pestCal.iceNote')}</p>
            <div className="space-y-1.5">
              <Label>{t('pestCal.thermometer')}</Label>
              <Input value={thermometer} onChange={(e) => setThermometer(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{t('ops.tempLogs.colReading')}</Label>
                <Input type="number" step="0.1" value={reading} onChange={(e) => setReading(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>°F / °C</Label>
                <Select value={unit} onValueChange={setUnit}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="F">°F</SelectItem>
                    <SelectItem value="C">°C</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('pestCal.initials')}</Label>
                <Input value={initials} onChange={(e) => setInitials(e.target.value)} />
              </div>
            </div>
            {calOutcome && (
              <p className="text-sm font-medium">{calOutcome === 'pass' ? t('pestCal.pass') : t('pestCal.adjusted')}</p>
            )}
            {calError && <p className="text-sm text-destructive">{calError}</p>}
          </div>
          <DialogFooter>
            <Button onClick={saveCal} disabled={calSaving}>{t('pestCal.addCal')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
